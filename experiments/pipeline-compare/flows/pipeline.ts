// 新方式（article-pipeline）の工程を、この PC の上で順番に動かす（DB・WordPress・通知は使わない）
// - 工程ごとに新しい GenerationRun（125 秒）を作り、本番の 1 工程 = 1 回の実行と同じ条件で動かす
// - 120 秒を超えた工程は「注意」に出す（本番では 1 工程が 150 秒の上限に収まる必要がある）
import { getDefaultAiModel, resolveWritingModel } from '../../../src/shared/aiModelCatalog.ts';
import { USD_TO_JPY, type AiUsageSummary, type ModelUsageSummary } from '../../../src/shared/aiUsage.ts';
import { summarizeCritique } from '../../../src/shared/editorialReviewCore.ts';
import { GenerationRun } from '../../../supabase/functions/scheduler-executor/_run.ts';
import type { AIConfig } from '../../../supabase/functions/scheduler-executor/_shared.ts';
import {
  baseModelForStep,
  normalizeJobSettings,
  STEP_HANDLERS,
  STEP_LABELS,
  type JobState,
  type StepResult,
  type StepName,
} from '../../../supabase/functions/article-pipeline/_steps.ts';
import { buildWideReferencesMarkdown } from '../../../supabase/functions/article-pipeline/_wideResearch.ts';
import { externalCallersForStep, geminiModelsForStep } from '../../../supabase/functions/article-pipeline/_roleCallers.ts';
import { AI_ROLES, describeAiRoleValues } from '../../../src/shared/aiRoleSettings.ts';
import { env, requireEnv, StepTimer } from '../lib/env.ts';
import { finalizeArticle } from '../lib/finalize.ts';
import type { FlowResult } from '../lib/types.ts';

const STEP_LIMIT_MS = 120_000;

export function mergeUsage(total: AiUsageSummary | null, add: AiUsageSummary | null): AiUsageSummary | null {
  if (!add) return total;
  if (!total) return add;
  const models = new Map<string, ModelUsageSummary>();
  for (const m of [...total.models, ...add.models]) {
    const current = models.get(m.model);
    models.set(m.model, current
      ? {
        ...current,
        calls: current.calls + m.calls,
        input_tokens: current.input_tokens + m.input_tokens,
        output_tokens: current.output_tokens + m.output_tokens,
        thoughts_tokens: current.thoughts_tokens + m.thoughts_tokens,
        estimated_usd: current.estimated_usd + m.estimated_usd,
      }
      : { ...m });
  }
  const totalUsd = total.total_estimated_usd + add.total_estimated_usd;
  return {
    models: [...models.values()],
    grounded_requests: total.grounded_requests + add.grounded_requests,
    search_queries: total.search_queries + add.search_queries,
    grounding_estimated_usd: total.grounding_estimated_usd + add.grounding_estimated_usd,
    total_estimated_usd: totalUsd,
    total_estimated_jpy: Math.round(totalUsd * USD_TO_JPY),
    note: total.note,
  };
}

export async function runPipelineFlow(params: { keyword: string; targetWordCount?: number }): Promise<FlowResult> {
  const keyword = params.keyword;
  const geminiKey = requireEnv('GEMINI_API_KEY');
  const baseModel = env('GEMINI_MODEL', getDefaultAiModel('gemini'));
  const writerModel = env('GEMINI_WRITER_MODEL') || resolveWritingModel('gemini', baseModel, 'high');
  const settings = normalizeJobSettings({
    lengthMode: params.targetWordCount ? 'fixed' : 'auto',
    targetWordCount: params.targetWordCount,
    tone: 'professional',
    qualityMode: 'high',
    appendReferences: true,
    // --style steps で以前の書き方（工程を分けて批評・書き直し）を試せる
    writingStyle: Deno.env.get('PIPELINE_WRITING_STYLE') === 'steps' ? 'steps' : 'oneshot',
    // --writer / --checker で ChatGPT・Claude を試せる（キーは OPENAI_API_KEY / ANTHROPIC_API_KEY）
    aiRoles: Object.fromEntries(
      AI_ROLES.map((role) => [role.id, Deno.env.get(`PIPELINE_AI_${role.id.toUpperCase()}`)]).filter(([, v]) => v),
    ),
  });
  const timer = new StepTimer();
  const warnings: string[] = [];
  const notes: string[] = [];
  let usage: AiUsageSummary | null = null;
  let state: JobState = {};
  let content = '';
  let step: StepName = 'research';
  let effectiveWriter = writerModel;

  let attempt = 1;
  for (let guard = 0; guard < 30 && step !== 'finalize'; guard++) {
    const handler = STEP_HANDLERS[step];
    if (!handler) throw new Error(`未知の工程です: ${step}`);
    // 本番と同じく、高品質モードでは調査と根拠メモ以外を上位モデル（Pro）で行う
    const models = geminiModelsForStep(step, settings, { base: baseModel, writer: writerModel });
    const run = new GenerationRun(
      Date.now(),
      125_000,
      geminiKey,
      baseModelForStep(step, models.base, models.writer, settings.qualityMode),
      models.writer,
      true,
    );
    const roleCallers = await externalCallersForStep({
      step,
      settings,
      run,
      loadApiKey: async (provider) => env(provider === 'openai' ? 'OPENAI_API_KEY' : 'ANTHROPIC_API_KEY') || null,
    });
    const aiConfig: AIConfig = {
      id: 'pipeline-compare-v2-steps',
      provider: 'gemini',
      api_key: geminiKey,
      model: baseModel,
      temperature: 0.7,
      max_tokens: 4000,
      run,
    };
    const startedAt = Date.now();
    let result: StepResult;
    try {
      result = await timer.time<StepResult>(`${STEP_LABELS[step]}${attempt > 1 ? `（${attempt}回目）` : ''}`, () => handler({
        attempt,
        keyword,
        fixedTitle: null,
        settings,
        state,
        content,
        run,
        aiConfig,
        callers: roleCallers,
      }), (r) => JSON.stringify(r.output).slice(0, 160));
    } catch (error) {
      usage = mergeUsage(usage, run.tracker.hasData ? run.tracker.summarize() : null);
      // 本番と同じく、同じ工程を 3 回まで試す
      if (attempt >= 3) throw error;
      warnings.push(`工程「${STEP_LABELS[step]}」が ${attempt} 回目に失敗し、やり直しました: ${error instanceof Error ? error.message.slice(0, 120) : error}`);
      attempt += 1;
      continue;
    }
    attempt = 1;
    const ms = Date.now() - startedAt;
    if (ms > STEP_LIMIT_MS) {
      warnings.push(`工程「${STEP_LABELS[step]}」が ${Math.round(ms / 1000)} 秒かかり、1 工程の上限（120 秒）を超えました`);
    }
    usage = mergeUsage(usage, run.tracker.hasData ? run.tracker.summarize() : null);
    notes.push(...run.notes);
    effectiveWriter = run.effectiveWriterModel;
    state = result.state;
    if (result.content !== undefined) content = result.content;
    step = result.next === 'done' ? 'finalize' : result.next;
  }

  const title = state.title || keyword;
  const firstVersion = state.versions?.[0]?.content || content;
  const finalized = finalizeArticle({
    content,
    baseContent: firstVersion,
    title,
    targetWordCount: state.lengthPlan?.targetChars || settings.targetWordCount,
    outline: state.outline,
    factSheet: state.factSheet || null,
    referencesMarkdown: !state.factSheet && state.wideResearch ? buildWideReferencesMarkdown(state.wideResearch.sources) : undefined,
  });
  const fc = state.factCheck;
  for (const r of fc?.results || []) {
    if (r.verdict === 'incorrect' || r.verdict === 'partially_correct') {
      console.log(`  [${r.verdict} ${r.confidence}] ${r.claim.slice(0, 80)}\n     → ${String(r.explanation || '').slice(0, 160)}`);
    }
  }
  for (const note of state.notes || []) console.log(`  メモ: ${note}`);
  console.log(`  使った AI: ${describeAiRoleValues(settings.aiRoles)}`);
  for (const p of state.factCheck?.patches || []) {
    console.log(`  [直した文 ${p.round}回目] ${p.before.slice(0, 70)}
     → ${p.after.slice(0, 70)}`);
  }
  const critique = state.critique;
  for (const s of state.supplements || []) {
    console.log(`  [補足調査 ${s.round}回目] ${s.status}: ${s.questions.join(' / ').slice(0, 300)}`);
  }
  const reviewLines = [
    state.reviewStatus || '未実行',
    critique ? `批評: ${summarizeCritique(critique)}` : '',
    ...(critique?.issues.map((issue, i) => `${i + 1}. ${issue.section}: ${issue.problem}`) || []),
  ].filter(Boolean);

  return {
    name: 'current',
    label: '新方式（工程ごと）',
    keyword,
    title,
    content: finalized.content,
    outline: state.outline,
    research: state.research
      ? { source: 'Gemini 検索（新方式）', articles: state.research.competitors }
      : null,
    relatedKeywords: state.relatedKeywords || [],
    competitorHeadings: state.competitorHeadings || [],
    factSheet: state.factSheet || null,
    factSheetNote: state.factSheet ? '' : (state.factSheetNote || '作成できませんでした'),
    editorialReview: reviewLines.join('\n'),
    factCheck: {
      verifier: 'Gemini（Google 検索）',
      executed: Boolean(fc && !fc.error),
      results: fc?.results || [],
      rounds: fc?.rounds || 0,
      autoFixApplied: Boolean(fc?.autoFixApplied),
      note: fc?.error || '',
    },
    writerModel: effectiveWriter,
    draftReasons: finalized.draftReasons,
    warnings: [...warnings, ...finalized.warnings],
    notes: [...new Set([...(state.notes || []), ...notes, `書き方: ${state.writeMode === 'sections' ? '見出しごと' : '記事全体を一度に'}`])],
    skippedSteps: [],
    referencesCount: finalized.referencesCount,
    lengthPlan: state.lengthPlan
      ? {
        mode: state.lengthPlan.mode,
        targetChars: state.lengthPlan.targetChars,
        reason: state.lengthPlan.reason,
        maxHeadings: state.lengthPlan.maxHeadings,
        source: state.lengthPlan.source,
      }
      : undefined,
    lengthAdjustment: state.lengthAdjustment,
    steps: timer.steps,
    totalMs: timer.totalMs,
    usage: { gemini: usage, openai: null, serpapiCalls: 0, customSearchCalls: 0 },
  };
}
