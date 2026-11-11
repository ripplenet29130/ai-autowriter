// 新方式（article-pipeline）の工程を、この PC の上で順番に動かす（DB・WordPress・通知は使わない）
// - 工程ごとに新しい GenerationRun（125 秒）を作り、本番の 1 工程 = 1 回の実行と同じ条件で動かす
// - 120 秒を超えた工程は「注意」に出す（本番では 1 工程が 150 秒の上限に収まる必要がある）
import { getDefaultAiModel, resolveWritingModel } from '../../../src/shared/aiModelCatalog.ts';
import { USD_TO_JPY, type AiUsageSummary, type ModelUsageSummary } from '../../../src/shared/aiUsage.ts';
import { summarizeCritique } from '../../../src/shared/editorialReviewCore.ts';
import { GenerationRun } from '../../../supabase/functions/scheduler-executor/_run.ts';
import type { AIConfig } from '../../../supabase/functions/scheduler-executor/_shared.ts';
import {
  normalizeJobSettings,
  STEP_HANDLERS,
  STEP_LABELS,
  type JobState,
  type StepResult,
  type StepName,
} from '../../../supabase/functions/article-pipeline/_steps.ts';
import { env, requireEnv, StepTimer } from '../lib/env.ts';
import { finalizeArticle } from '../lib/finalize.ts';
import type { FlowResult } from '../lib/types.ts';

const STEP_LIMIT_MS = 120_000;

function mergeUsage(total: AiUsageSummary | null, add: AiUsageSummary | null): AiUsageSummary | null {
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
  });
  const timer = new StepTimer();
  const warnings: string[] = [];
  const notes: string[] = [];
  let usage: AiUsageSummary | null = null;
  let state: JobState = {};
  let content = '';
  let step: StepName = 'research';
  let effectiveWriter = writerModel;

  for (let guard = 0; guard < 20 && step !== 'finalize'; guard++) {
    const handler = STEP_HANDLERS[step];
    if (!handler) throw new Error(`未知の工程です: ${step}`);
    const run = new GenerationRun(Date.now(), 125_000, geminiKey, baseModel, writerModel);
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
    const result = await timer.time<StepResult>(STEP_LABELS[step], () => handler({
      keyword,
      fixedTitle: null,
      settings,
      state,
      content,
      run,
      aiConfig,
    }), (r) => JSON.stringify(r.output).slice(0, 160));
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
  });
  const fc = state.factCheck;
  const critique = state.critique;
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
