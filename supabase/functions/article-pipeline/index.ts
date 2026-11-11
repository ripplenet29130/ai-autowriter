// 記事作成の新方式（v2）: 記事作成を工程ごとに分けて実行する Edge Function
// 仕様: docs/article-pipeline-v2-spec-2026-11-11.md
//
// 呼び出し（POST JSON）:
// - { action: 'create', keyword, title?, wordpressConfigId?, aiConfigId?, settings? }  管理者のみ。ジョブを作って動かし始める
// - { action: 'tick', jobId? }   サービスロールのみ（毎分の定期実行と自分自身からの呼び出し）。次の 1 工程だけ進める
// - { action: 'retry', jobId }   失敗したジョブを、失敗した工程からやり直す
// - { action: 'cancel', jobId }  ジョブを止める
import { createClient } from 'npm:@supabase/supabase-js@2';
import { requireAuthenticatedCaller } from '../_shared/auth.ts';
import { corsHeaders } from '../_shared/cors.ts';
import { countGeneratedChars } from '../../../src/shared/articleGenerationCore.ts';
import { formatLengthPlanLabel } from '../../../src/shared/articleLengthPlan.ts';
import {
  appendReferencesSection,
  buildReferencesMarkdown,
  hasUsableFacts,
  selectReferenceSources,
} from '../../../src/shared/factSheetCore.ts';
import {
  countCriticalIssues,
  countMinorIssues,
  countUnverified,
  hasCorrectionArtifacts,
} from '../../../src/shared/geminiFactCheck.ts';
import { CRITIQUE_ISSUE_TYPES, summarizeCritique } from '../../../src/shared/editorialReviewCore.ts';
import { normalizeAiModel, normalizeQualityMode, resolveWritingModel } from '../../../src/shared/aiModelCatalog.ts';
import { USD_TO_JPY } from '../../../src/shared/aiUsage.ts';
import { GenerationRun } from '../scheduler-executor/_run.ts';
import { publishToWordPress } from '../scheduler-executor/_wordpress.ts';
import { extractExcerpt, inferLengthCategory } from '../scheduler-executor/_content-format.ts';
import { sendChatworkNotifications } from '../scheduler-executor/_notifications.ts';
import { validateGeneratedArticleCompleteness } from '../scheduler-executor/_generation.ts';
import type { AIConfig, WordPressConfig } from '../scheduler-executor/_shared.ts';
import {
  isStepName,
  normalizeJobSettings,
  STEP_HANDLERS,
  STEP_LABELS,
  tidyContent,
  type JobSettings,
  type JobState,
  type StepName,
} from './_steps.ts';

declare const EdgeRuntime: { waitUntil(promise: Promise<unknown>): void };

// 1 工程にかけてよい時間（無料プランの上限 150 秒から余裕を取る）とロックの長さ
const STEP_TIME_BUDGET_MS = 125_000;
const LOCK_SECONDS = 170;
const MAX_STEP_ATTEMPTS = 3;

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

const errorText = (error: unknown) => (error instanceof Error ? error.message : String(error || '不明なエラー'));

function serviceClient() {
  return createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
}

// 次の工程を進めるよう自分自身を呼ぶ（応答はすぐ返る。失敗しても毎分の定期実行が拾う）
async function kick(jobId?: string): Promise<void> {
  try {
    await fetch(`${Deno.env.get('SUPABASE_URL')}/functions/v1/article-pipeline`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')}`,
      },
      body: JSON.stringify({ action: 'tick', jobId }),
      signal: AbortSignal.timeout(8000),
    });
  } catch (error) {
    console.warn('[article-pipeline] kick failed; the cron job will pick it up:', errorText(error));
  }
}

async function isAdmin(supabase: any, userId: string): Promise<boolean> {
  const { data } = await supabase.from('profiles').select('role').eq('user_id', userId).maybeSingle();
  return data?.role === 'admin';
}

// --- 設定の読み込み ---

async function loadGeminiConfig(supabase: any, job: any): Promise<AIConfig> {
  let config: any = null;
  if (job.ai_config_id) {
    const { data } = await supabase.from('ai_configs').select('*').eq('id', job.ai_config_id).maybeSingle();
    if (data && String(data.provider || '').toLowerCase() === 'gemini' && data.api_key) config = data;
  }
  if (!config && job.user_id) {
    const { data } = await supabase
      .from('ai_configs')
      .select('*')
      .eq('user_id', job.user_id)
      .eq('provider', 'gemini')
      .order('is_active', { ascending: false })
      .order('created_at', { ascending: false })
      .limit(1);
    config = (data || []).find((row: any) => row.api_key) || null;
  }
  if (!config && job.account_id) {
    const { data } = await supabase
      .from('ai_configs')
      .select('*')
      .eq('account_id', job.account_id)
      .eq('provider', 'gemini')
      .order('is_active', { ascending: false })
      .limit(1);
    config = (data || []).find((row: any) => row.api_key) || null;
  }
  if (!config) {
    throw new Error('Gemini の AI 設定（API キー）が見つかりません。新方式は Gemini の Google 検索を使うため、Gemini の設定が必要です');
  }
  return { ...config, model: normalizeAiModel('gemini', config.model) } as AIConfig;
}

async function loadWordPressConfig(supabase: any, id: string | null): Promise<WordPressConfig | null> {
  if (!id) return null;
  const { data } = await supabase.from('wordpress_configs').select('*').eq('id', id).maybeSingle();
  return (data as WordPressConfig) || null;
}

async function loadChatwork(supabase: any, job: any, schedule: any | null): Promise<{ token: string | null; rooms: string }> {
  const settings = new Map<string, string>();
  const readSettings = async (match: Record<string, string> | null) => {
    let query = supabase.from('app_settings').select('key, value').in('key', ['chatwork_api_token', 'chatwork_room_id', 'fact_check_alert_chatwork_room_id']);
    query = match ? query.match(match) : query.is('user_id', null);
    const { data } = await query;
    for (const row of data || []) if (row.value && !settings.has(row.key)) settings.set(row.key, String(row.value));
  };
  if (job.user_id) await readSettings({ user_id: job.user_id });
  if (job.account_id) await readSettings({ account_id: job.account_id });
  await readSettings(null);
  const rooms = String(
    schedule?.fact_check_alert_chatwork_room_id
    || schedule?.chatwork_room_id
    || settings.get('fact_check_alert_chatwork_room_id')
    || settings.get('chatwork_room_id')
    || '',
  ).trim();
  return { token: settings.get('chatwork_api_token') || null, rooms };
}

// --- ジョブの保存 ---

async function recordStep(supabase: any, row: Record<string, unknown>): Promise<void> {
  const { error } = await supabase.from('article_job_steps').insert(row);
  if (error) console.warn('[article-pipeline] failed to record step:', error.message);
}

function mergeCost(previous: any, step: StepName, usage: any): Record<string, any> {
  const cost = { ...(previous || {}) };
  const byStep = { ...(cost.by_step || {}) };
  const usd = Number(usage?.total_estimated_usd || 0);
  byStep[step] = Number(byStep[step] || 0) + usd;
  const totalUsd = Number(cost.total_usd || 0) + usd;
  return {
    ...cost,
    by_step: byStep,
    total_usd: totalUsd,
    total_jpy: Math.round(totalUsd * USD_TO_JPY),
    grounded_requests: Number(cost.grounded_requests || 0) + Number(usage?.grounded_requests || 0),
  };
}

// 失敗したらやり直し。3 回失敗したらジョブを失敗にする
async function handleStepFailure(supabase: any, job: any, step: StepName, error: unknown): Promise<void> {
  const message = errorText(error);
  const attempts = Number(job.step_attempts || 0);
  if (attempts >= MAX_STEP_ATTEMPTS) {
    await supabase.from('article_jobs').update({
      status: 'failed',
      error: `${STEP_LABELS[step]}で ${attempts} 回失敗しました: ${message}`,
      locked_until: null,
      updated_at: new Date().toISOString(),
    }).eq('id', job.id).neq('status', 'cancelled');
    await reportJobFailure(supabase, job, `${STEP_LABELS[step]}で失敗しました: ${message}`);
    return;
  }
  // 少し待ってから毎分の定期実行がやり直す（429 などの一時的な失敗を想定）
  await supabase.from('article_jobs').update({
    error: `${STEP_LABELS[step]}で失敗（${attempts}回目）: ${message}`,
    locked_until: new Date(Date.now() + 30_000).toISOString(),
    updated_at: new Date().toISOString(),
  }).eq('id', job.id).neq('status', 'cancelled');
}

async function reportJobFailure(supabase: any, job: any, reason: string): Promise<void> {
  const schedule = job.schedule_id
    ? (await supabase.from('schedule_settings').select('*').eq('id', job.schedule_id).maybeSingle()).data
    : null;
  if (job.execution_history_id) {
    await supabase.from('execution_history').update({
      status: 'failed',
      error_message: `新方式: ${reason}`.slice(0, 1000),
    }).eq('id', job.execution_history_id);
  }
  const chatwork = await loadChatwork(supabase, job, schedule);
  if (chatwork.token && chatwork.rooms) {
    const template = [
      '記事作成（新方式）が失敗しました',
      'キーワード: {keyword}',
      `理由: ${reason}`,
      `ジョブ: ${job.id}`,
    ].join('\n');
    await sendChatworkNotifications(chatwork.token, chatwork.rooms, template, job.title || '', '', job.keyword, '失敗')
      .catch((error) => console.warn('[article-pipeline] failure notification failed:', errorText(error)));
  }
}

// --- 9. 仕上げと投稿（DB・WordPress・通知を使うためここで行う） ---

async function finalizeJob(supabase: any, job: any, state: JobState, settings: JobSettings, content: string): Promise<{
  content: string;
  verdict: Record<string, unknown>;
  quality: Record<string, unknown>;
  postId: string | null;
  postUrl: string | null;
  output: Record<string, unknown>;
}> {
  const title = state.title || job.fixed_title || job.keyword;
  let finalContent = tidyContent(String(content || '').replace(/\[\[(.+?)\]\]/g, '$1'), title);
  try {
    validateGeneratedArticleCompleteness(finalContent, state.outline!, state.lengthPlan?.targetChars || settings.targetWordCount);
  } catch (error) {
    state.notes = [...(state.notes || []), `本文の確認で注意: ${errorText(error)}`];
  }

  // 公開判定（仕様書 7 章）
  const results = state.factCheck?.results || [];
  const critical = countCriticalIssues(results);
  const unverified = countUnverified(results);
  const draftReasons: string[] = [];
  const warnings: string[] = [];
  if (critical > 0) draftReasons.push(`誤り（確信度 70% 以上）が ${critical} 件残っています`);
  if (hasCorrectionArtifacts(finalContent)) draftReasons.push('本文に修正用の文言（「（修正: 」など）が残っています');
  if (!state.factCheck || state.factCheck.error) draftReasons.push(`ファクトチェックが失敗しました${state.factCheck?.error ? `（${state.factCheck.error.slice(0, 120)}）` : ''}`);
  if (unverified >= 5) warnings.push(`確認できなかった主張が ${unverified} 件あります`);
  // テスト期間中は常に下書き（環境変数 ARTICLE_PIPELINE_ALLOW_PUBLISH=true のときだけ公開できる）
  const publishAllowed = Deno.env.get('ARTICLE_PIPELINE_ALLOW_PUBLISH') === 'true';
  const postStatus = settings.postStatus === 'publish' && publishAllowed && draftReasons.length === 0 ? 'publish' : 'draft';

  let referencesCount = 0;
  if (settings.appendReferences && hasUsableFacts(state.factSheet)) {
    const references = buildReferencesMarkdown(state.factSheet);
    if (references) {
      finalContent = appendReferencesSection(finalContent, references);
      referencesCount = selectReferenceSources(state.factSheet).length;
    }
  }

  // WordPress へ投稿（投稿先が無いジョブは記事だけ保存する）
  const wpConfig = await loadWordPressConfig(supabase, job.wordpress_config_id);
  let postId: string | null = null;
  let postUrl: string | null = null;
  let publishError: string | null = null;
  if (wpConfig) {
    try {
      postId = await publishToWordPress(wpConfig, title, finalContent, postStatus);
      postUrl = postId ? `${String(wpConfig.url).replace(/\/$/, '')}/?p=${postId}` : null;
    } catch (error) {
      publishError = errorText(error);
    }
  }

  // 記事一覧にも残す（今の自動投稿と同じ articles テーブル）
  const chars = countGeneratedChars(finalContent);
  const { error: articleError } = await supabase.from('articles').insert({
    account_id: job.account_id || wpConfig?.account_id || null,
    user_id: job.user_id || wpConfig?.user_id || null,
    title,
    content: finalContent,
    excerpt: extractExcerpt(finalContent),
    keywords: state.sectionKeywords || [job.keyword],
    category: wpConfig?.category || '',
    status: postId ? (postStatus === 'publish' ? 'published' : 'draft') : 'draft',
    tone: settings.tone,
    length: inferLengthCategory(chars),
    ai_provider: 'gemini',
    ai_model: 'article-pipeline-v2',
    published_at: postId && postStatus === 'publish' ? new Date().toISOString() : null,
    wordpress_post_id: postId ?? '',
    wordpress_config_id: wpConfig?.id ?? null,
    reading_time: Math.max(1, Math.round(chars / 500)),
    word_count: chars,
    trend_data: {},
  });
  if (articleError) console.warn('[article-pipeline] failed to save article snapshot:', articleError.message);

  const cost = job.cost || {};
  const quality = {
    pipeline: 'v2',
    length_plan: state.lengthPlan || null,
    length_label: formatLengthPlanLabel(state.lengthPlan),
    final_chars: chars,
    length_adjustment: state.lengthAdjustment || '不要',
    write_mode: state.writeMode,
    editorial_review: state.reviewStatus || '未実行',
    editorial_critique: state.critique || null,
    fact_sheet: state.factSheet
      ? { facts: state.factSheet.facts, sources: state.factSheet.sources.map(({ id, title: t, url }) => ({ id, title: t, url })) }
      : null,
    fact_sheet_error: state.factSheet ? '' : (state.factSheetNote || ''),
    fact_check: state.factCheck
      ? {
        checked: state.factCheck.itemsChecked,
        searched: state.factCheck.searchedClaims,
        skipped: state.factCheck.skippedSearchClaims,
        rounds: state.factCheck.rounds,
        auto_fix_applied: state.factCheck.autoFixApplied,
        critical,
        minor: countMinorIssues(results),
        unverified,
      }
      : null,
    references_count: referencesCount,
    notes: state.notes || [],
    research: state.research
      ? { search_intent: state.research.searchIntent, competitors: state.research.competitors.length, search_used: state.research.searchUsed }
      : null,
  };
  const verdict = { post_status: postStatus, draft_reasons: draftReasons, warnings, publish_error: publishError };

  // スケジュールから作られたジョブなら、実行履歴を完了にする（executed_at は変えない: 実行間隔の判定に使うため）
  if (job.execution_history_id) {
    await supabase.from('execution_history').update({
      status: postId ? 'success' : 'failed',
      article_title: title,
      wordpress_post_id: postId ?? '',
      error_message: postId ? null : `新方式: ${publishError || 'WordPress の投稿先がありません'}`,
      cost_breakdown: { pipeline: 'v2', job_id: job.id, quality, total_estimated_usd: Number(cost.total_usd || 0) },
      estimated_cost_usd: Number(cost.total_usd || 0),
    }).eq('id', job.execution_history_id);
  }

  // 通知
  const schedule = job.schedule_id
    ? (await supabase.from('schedule_settings').select('*').eq('id', job.schedule_id).maybeSingle()).data
    : null;
  const chatwork = await loadChatwork(supabase, job, schedule);
  if (chatwork.token && chatwork.rooms) {
    const critique = state.critique;
    const lines = [
      '記事作成（新方式）の結果',
      'タイトル: {title}',
      'キーワード: {keyword}',
      '投稿URL: {url}',
      '投稿状態: {status}',
      '',
      '【品質】',
      `文字数: ${formatLengthPlanLabel(state.lengthPlan)} → 完成 ${chars}字`,
      state.lengthAdjustment && state.lengthAdjustment !== '不要' ? `文字数の調整: ${state.lengthAdjustment}` : '',
      `根拠メモ: ${state.factSheet ? `事実${state.factSheet.facts.length}件・出典${state.factSheet.sources.length}件` : `なし（${state.factSheetNote || '作成できませんでした'}）`}`,
      `見直し: ${state.reviewStatus || '未実行'}`,
      critique ? `見直しの批評: ${summarizeCritique(critique)}` : '',
      ...(critique?.issues.slice(0, 3).map((issue) => `・[${CRITIQUE_ISSUE_TYPES[issue.type]}] ${issue.section}: ${issue.problem}`) || []),
      state.factCheck
        ? `ファクトチェック: ${state.factCheck.itemsChecked}件確認（検索${state.factCheck.searchedClaims}件）・重大な指摘${critical}件・軽微${countMinorIssues(results)}件・確認できず${unverified}件・自動修正${state.factCheck.autoFixApplied ? 'あり' : 'なし'}`
        : 'ファクトチェック: 未実行',
      draftReasons.length ? `下書きの理由: ${draftReasons.join(' / ')}` : '',
      warnings.length ? `注意: ${warnings.join(' / ')}` : '',
      publishError ? `投稿エラー: ${publishError}` : '',
      `推定費用: 約${Math.max(1, Number(cost.total_jpy || 0))}円（有料キー換算）`,
    ].filter((line) => line !== '');
    await sendChatworkNotifications(
      chatwork.token,
      chatwork.rooms,
      lines.join('\n'),
      title,
      postUrl || '(投稿URLなし)',
      job.keyword,
      postStatus === 'publish' ? '公開' : '下書き',
    ).catch((error) => console.warn('[article-pipeline] notification failed:', errorText(error)));
  }

  return {
    content: finalContent,
    verdict,
    quality,
    postId,
    postUrl,
    output: { postStatus, postId, postUrl, draftReasons, warnings, publishError, chars, referencesCount },
  };
}

// --- 1 工程を進める ---

async function processJob(supabase: any, job: any): Promise<void> {
  const step: StepName = isStepName(job.current_step) ? job.current_step : 'research';
  const attempts = Number(job.step_attempts || 0) + 1;
  job.step_attempts = attempts;
  await supabase.from('article_jobs').update({ step_attempts: attempts, updated_at: new Date().toISOString() }).eq('id', job.id);
  if (attempts > MAX_STEP_ATTEMPTS) {
    await handleStepFailure(supabase, { ...job, step_attempts: attempts - 1 }, step, new Error('やり直しの上限に達しました'));
    return;
  }

  const startedAt = new Date().toISOString();
  const settings = normalizeJobSettings(job.settings);
  const state: JobState = (job.state && typeof job.state === 'object') ? job.state : {};
  let run: GenerationRun | null = null;

  try {
    const aiConfig = await loadGeminiConfig(supabase, job);
    const qualityMode = normalizeQualityMode(settings.qualityMode);
    run = new GenerationRun(Date.now(), STEP_TIME_BUDGET_MS, aiConfig.api_key, aiConfig.model, resolveWritingModel('gemini', aiConfig.model, qualityMode));
    const runConfig: AIConfig = { ...aiConfig, run };

    let result: { state: JobState; next: StepName | 'done'; content?: string; title?: string; output: Record<string, unknown> };
    let extra: Record<string, unknown> = {};
    if (step === 'finalize') {
      const finalized = await finalizeJob(supabase, job, state, settings, String(job.content || ''));
      result = { state, next: 'done', content: finalized.content, output: finalized.output };
      extra = {
        verdict: finalized.verdict,
        quality: finalized.quality,
        wordpress_post_id: finalized.postId,
        wordpress_url: finalized.postUrl,
        completed_at: new Date().toISOString(),
      };
    } else {
      const handler = STEP_HANDLERS[step];
      if (!handler) throw new Error(`未知の工程です: ${step}`);
      result = await handler({
        keyword: job.keyword,
        fixedTitle: job.fixed_title || null,
        settings,
        state,
        content: String(job.content || ''),
        run,
        aiConfig: runConfig,
      });
    }

    const usage = run.tracker.hasData ? run.tracker.summarize() : null;
    await recordStep(supabase, {
      job_id: job.id,
      step,
      attempt: attempts,
      status: 'completed',
      output: { ...result.output, notes: run.notes },
      provider: 'gemini',
      model: run.effectiveWriterModel,
      tokens: usage,
      search_count: Number(usage?.grounded_requests || 0),
      started_at: startedAt,
      finished_at: new Date().toISOString(),
    });

    const done = result.next === 'done';
    const { error } = await supabase.from('article_jobs').update({
      state: result.state,
      current_step: done ? 'finalize' : result.next,
      status: done ? 'completed' : 'running',
      step_attempts: 0,
      locked_until: null,
      error: null,
      title: result.title ?? result.state.title ?? job.title ?? null,
      content: result.content ?? job.content ?? null,
      length_plan: result.state.lengthPlan ?? job.length_plan ?? null,
      cost: mergeCost(job.cost, step, usage),
      updated_at: new Date().toISOString(),
      ...extra,
    }).eq('id', job.id).neq('status', 'cancelled');
    if (error) throw new Error(`ジョブの保存に失敗しました: ${error.message}`);

    if (!done) await kick(job.id);
  } catch (error) {
    console.error(`[article-pipeline] step ${step} failed for job ${job.id}:`, error);
    const usage = run?.tracker.hasData ? run.tracker.summarize() : null;
    await recordStep(supabase, {
      job_id: job.id,
      step,
      attempt: attempts,
      status: 'failed',
      output: { notes: run?.notes || [] },
      provider: 'gemini',
      model: run?.effectiveWriterModel || null,
      tokens: usage,
      search_count: Number(usage?.grounded_requests || 0),
      started_at: startedAt,
      finished_at: new Date().toISOString(),
      error: errorText(error).slice(0, 2000),
    });
    if (usage) {
      await supabase.from('article_jobs').update({ cost: mergeCost(job.cost, step, usage) }).eq('id', job.id);
      job.cost = mergeCost(job.cost, step, usage);
    }
    await handleStepFailure(supabase, job, step, error);
  }
}

// --- HTTP ---

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405);

  const caller = await requireAuthenticatedCaller(req);
  if ('errorResponse' in caller) return caller.errorResponse;

  let body: any = {};
  try {
    body = await req.json();
  } catch {
    return json({ error: 'JSON の本文が必要です' }, 400);
  }
  const action = String(body?.action || '');
  const supabase = serviceClient();

  try {
    if (action === 'tick') {
      if (caller.kind !== 'service_role') return json({ error: 'forbidden' }, 403);
      const { data, error } = await supabase.rpc('claim_article_job', {
        p_lock_seconds: LOCK_SECONDS,
        p_job_id: body?.jobId || null,
      });
      if (error) throw error;
      const job = Array.isArray(data) ? data[0] : data;
      if (!job) return json({ ok: true, claimed: false }, 202);
      // 応答はすぐ返し、工程は裏で進める（呼び出し元を待たせない）
      EdgeRuntime.waitUntil(processJob(supabase, job));
      return json({ ok: true, claimed: true, jobId: job.id, step: job.current_step }, 202);
    }

    // ここから先は画面からの操作（テスト期間中は管理者だけ）
    if (caller.kind === 'user' && !(await isAdmin(supabase, caller.userId))) {
      return json({ error: '新方式（テスト）は管理者だけが使えます' }, 403);
    }

    if (action === 'create') {
      const keyword = String(body?.keyword || '').trim();
      if (!keyword) return json({ error: 'キーワードを入力してください' }, 400);
      const userId = caller.kind === 'user' ? caller.userId : (body?.userId || null);
      const { data: profile } = userId
        ? await supabase.from('profiles').select('account_id').eq('user_id', userId).maybeSingle()
        : { data: null };
      const { data: job, error } = await supabase.from('article_jobs').insert({
        user_id: userId,
        account_id: profile?.account_id ?? null,
        keyword,
        fixed_title: String(body?.title || '').trim() || null,
        wordpress_config_id: body?.wordpressConfigId || null,
        ai_config_id: body?.aiConfigId || null,
        settings: normalizeJobSettings(body?.settings || {}),
      }).select('id').single();
      if (error) throw error;
      await kick(job.id);
      return json({ ok: true, jobId: job.id });
    }

    if (action === 'retry' || action === 'cancel') {
      const jobId = String(body?.jobId || '');
      if (!jobId) return json({ error: 'jobId が必要です' }, 400);
      const update = action === 'retry'
        ? { status: 'queued', step_attempts: 0, locked_until: null, error: null, updated_at: new Date().toISOString() }
        : { status: 'cancelled', locked_until: null, updated_at: new Date().toISOString() };
      const { error } = await supabase.from('article_jobs').update(update).eq('id', jobId);
      if (error) throw error;
      if (action === 'retry') await kick(jobId);
      return json({ ok: true });
    }

    return json({ error: `未知の操作です: ${action}` }, 400);
  } catch (error) {
    console.error('[article-pipeline] request failed:', error);
    return json({ error: errorText(error) }, 500);
  }
});
