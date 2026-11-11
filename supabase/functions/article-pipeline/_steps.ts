// 新方式の工程（仕様書 4 章）。1 工程は 1 回の実行（120 秒以内）で終える。
// どの工程も、それまでの途中経過（state）と最新の記事を DB から受け取り、結果を返す。
import {
  countGeneratedChars,
  formatArticleBodyForReadability,
  generateOutlineWithAutoModeStyle,
} from '../../../src/shared/articleGenerationCore.ts';
import {
  buildAutoModeQualityInstructions,
  buildAutoOutlineRetryInstructions,
  compactAutoModeInstructions,
  evaluateAutoOutlineQuality,
} from '../../../src/shared/autoModeQuality.ts';
import {
  AUTO_LENGTH_MAX_CHARS,
  buildOutlineLengthInstructions,
  condenseArticleIfTooLong,
  fixedLengthPlan,
  isOverLengthLimit,
  planArticleLength,
  type ArticleLengthPlan,
} from '../../../src/shared/articleLengthPlan.ts';
import {
  assignFactsToSections,
  buildFactSheet,
  buildFactSheetOutlineInstructions,
  hasUsableFacts,
  type FactSheet,
} from '../../../src/shared/factSheetCore.ts';
import {
  runEditorialCritique,
  runEditorialReview,
  summarizeCritique,
  type EditorialCritique,
} from '../../../src/shared/editorialReviewCore.ts';
import {
  applyGeminiFactCheckFixes,
  claimsForRecheck,
  countCriticalIssues,
  countMinorIssues,
  runGeminiFactCheck,
} from '../../../src/shared/geminiFactCheck.ts';
import { getFixableFactCheckIssues, type FactCheckResult } from '../../../src/shared/factCheckCore.ts';
import { callAI, generateTitleWithAI } from '../scheduler-executor/_ai.ts';
import { extractCompetitorHeadings } from '../scheduler-executor/_research.ts';
import {
  createSectionWriter,
  generateSchedulerArticleSinglePass,
  REVIEW_THINKING_BUDGET,
  validateGeneratedArticleCompleteness,
  type SectionedGenerationParams,
} from '../scheduler-executor/_generation.ts';
import {
  countNonSummaryHeadings,
  normalizeGeneratedContentForPublishing,
} from '../scheduler-executor/_content-format.ts';
import { readGeminiMaxParallel, type GenerationRun } from '../scheduler-executor/_run.ts';
import type { AIConfig, ArticleOutline, WritingTone } from '../scheduler-executor/_shared.ts';
import { buildResearchOutlineInstructions, researchWithGemini, type AiResearch } from './_research.ts';

export const STEP_ORDER = [
  'research',
  'facts',
  'plan',
  'write',
  'condense',
  'critique',
  'rewrite',
  'factcheck',
  'fix',
  'finalize',
] as const;
export type StepName = typeof STEP_ORDER[number];

export const STEP_LABELS: Record<StepName, string> = {
  research: '調査',
  facts: '根拠メモ',
  plan: '企画',
  write: '執筆',
  condense: '文字数の調整',
  critique: '批評',
  rewrite: '書き直し',
  factcheck: 'ファクトチェック',
  fix: '修正と再確認',
  finalize: '仕上げと投稿',
};

export function isStepName(value: unknown): value is StepName {
  return typeof value === 'string' && (STEP_ORDER as readonly string[]).includes(value);
}

export interface JobSettings {
  lengthMode: 'auto' | 'fixed';
  targetWordCount: number;
  tone: WritingTone;
  qualityMode: 'high' | 'standard';
  customInstructions: string;
  appendReferences: boolean;
  // テスト期間中は常に下書き（仕様書 6 章）。本番運用に切り替えるときだけ publish を使う
  postStatus: 'draft' | 'publish';
}

export function normalizeJobSettings(raw: any): JobSettings {
  const target = Number(raw?.targetWordCount);
  return {
    lengthMode: raw?.lengthMode === 'fixed' ? 'fixed' : 'auto',
    targetWordCount: Number.isFinite(target) && target >= 500 ? Math.min(6000, Math.round(target)) : 2000,
    tone: raw?.tone === 'casual' ? 'casual' : 'professional',
    qualityMode: raw?.qualityMode === 'standard' ? 'standard' : 'high',
    customInstructions: String(raw?.customInstructions || '').trim(),
    appendReferences: raw?.appendReferences !== false,
    postStatus: raw?.postStatus === 'publish' ? 'publish' : 'draft',
  };
}

export interface ContentVersion {
  label: string;
  content: string;
  chars: number;
}

export interface FactCheckState {
  results: FactCheckResult[];
  itemsChecked: number;
  searchedClaims: number;
  skippedSearchClaims: number;
  rounds: number;
  autoFixApplied: boolean;
  error?: string;
}

// 工程の間で受け渡す途中経過（article_jobs.state）
export interface JobState {
  research?: AiResearch | null;
  researchError?: string;
  factSheet?: FactSheet | null;
  factSheetNote?: string;
  title?: string;
  relatedKeywords?: string[];
  sectionKeywords?: string[];
  competitorHeadings?: string[];
  lengthPlan?: ArticleLengthPlan;
  outline?: ArticleOutline;
  sectionFactIds?: string[][];
  writeMode?: 'whole' | 'sections';
  sectionParts?: string[];
  nextGroup?: number;
  versions?: ContentVersion[];
  lengthAdjustment?: string;
  critique?: EditorialCritique | null;
  reviewStatus?: string;
  factCheck?: FactCheckState;
  notes?: string[];
}

export interface StepContext {
  keyword: string;
  fixedTitle: string | null;
  settings: JobSettings;
  state: JobState;
  content: string;
  run: GenerationRun;
  aiConfig: AIConfig;
}

export interface StepResult {
  state: JobState;
  next: StepName | 'done';
  content?: string;
  title?: string;
  // 工程の記録（article_job_steps.output）に残す要約
  output: Record<string, unknown>;
}

const toneInstructionFor = (tone: WritingTone) =>
  tone === 'casual' ? 'やわらかく親しみやすい です・ます調' : 'ビジネス読者向けの自然な です・ます調';

function addNote(state: JobState, note: string): void {
  state.notes = [...(state.notes || []), note];
}

function pushVersion(state: JobState, label: string, content: string): void {
  const versions = [...(state.versions || [])];
  versions.push({ label, content, chars: countGeneratedChars(content) });
  // 記事の版は最大 6 つまで残す（DB が大きくなりすぎないように）
  state.versions = versions.slice(-6);
}

// 本文を書いた直後や書き直した後の整形（表は崩さない）
export function tidyContent(content: string, title: string): string {
  return formatArticleBodyForReadability(normalizeGeneratedContentForPublishing(content, title));
}

// 本文の各セクションに渡すキーワード（最大 3 個、表記ゆれを除く）
function pickSectionKeywords(keyword: string, relatedKeywords: string[]): string[] {
  const result: string[] = [];
  const seen = new Set<string>();
  for (const candidate of [keyword, ...relatedKeywords].map((k) => String(k || '').trim()).filter(Boolean)) {
    const normalized = candidate.replace(/\s+/g, '').toLowerCase();
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    result.push(candidate);
    if (result.length >= 3) break;
  }
  return result;
}

function readWholeWritingLimit(): number {
  const raw = Number(Deno.env.get('ARTICLE_PIPELINE_WHOLE_WRITING_MAX_CHARS'));
  return Number.isFinite(raw) && raw >= 1000 ? raw : 4500;
}

function readAutoLengthMaxChars(): number {
  const raw = Number(Deno.env.get('AUTO_LENGTH_MAX_CHARS'));
  return Number.isFinite(raw) && raw >= 1500 ? raw : AUTO_LENGTH_MAX_CHARS;
}

function generationParams(ctx: StepContext): SectionedGenerationParams {
  const state = ctx.state;
  return {
    outline: state.outline!,
    keyword: ctx.keyword,
    keywords: state.sectionKeywords || [ctx.keyword],
    tone: ctx.settings.tone,
    targetWordCount: state.lengthPlan?.targetChars || ctx.settings.targetWordCount,
    customInstructions: compactAutoModeInstructions([
      ctx.settings.customInstructions,
      buildAutoModeQualityInstructions({
        selectedTitle: state.title,
        targetWordCount: state.lengthPlan?.targetChars || ctx.settings.targetWordCount,
      }),
    ]),
    aiConfig: ctx.aiConfig,
    factSheet: state.factSheet || null,
    sectionFactIds: state.sectionFactIds,
    parallelism: 1,
  };
}

// --- 1a. 調査: Gemini の Google 検索で上位ページを読む（90〜100 秒かかるため、根拠メモとは別の工程） ---
async function stepResearch(ctx: StepContext): Promise<StepResult> {
  const state: JobState = { ...ctx.state };
  let research: AiResearch;
  try {
    research = await researchWithGemini(ctx.run, ctx.keyword, 110_000);
  } catch (error) {
    state.researchError = error instanceof Error ? error.message : String(error || '');
    throw new Error(`調査に失敗しました: ${state.researchError}`);
  }
  state.research = research;
  if (!research.searchUsed) addNote(state, '調査で Google 検索が使われませんでした（AI の知識とページ読み込みだけで調査）');
  return {
    state,
    next: 'facts',
    output: {
      searchIntent: research.searchIntent,
      competitors: research.competitors.map((c) => c.title),
      readerQuestions: research.readerQuestions,
      relatedKeywords: research.relatedKeywords,
      searchQueries: research.searchQueries,
      urlContextUsed: research.urlContextUsed,
    },
  };
}

// --- 1b. 根拠メモ: 調査結果を踏まえて、本文に使える事実を出典付きで集める ---
async function stepFacts(ctx: StepContext): Promise<StepResult> {
  const state: JobState = { ...ctx.state };
  const research = state.research || null;
  const competitorHeadings = extractCompetitorHeadings({ articles: research?.competitors || [] }, 15);
  let factSheet: FactSheet | null = null;
  try {
    // 検索が使われなかったときの作り直しは buildFactSheet の中で 1 回だけ行う
    factSheet = await buildFactSheet({
      keyword: ctx.keyword,
      title: ctx.fixedTitle,
      relatedKeywords: (research?.relatedKeywords || []).slice(0, 8),
      competitorHeadings,
      call: ctx.run.call,
      resolveUrls: ctx.run.resolveUrls,
      includeLatest: () => true,
    });
  } catch (error) {
    state.factSheetNote = error instanceof Error ? error.message : String(error || '');
  }
  if (factSheet && factSheet.searchUsed) {
    state.factSheet = factSheet;
  } else {
    // 検索なしで作られたメモは AI の知識だけなので、根拠としては使わない（今の自動投稿と同じ）
    state.factSheet = null;
    state.factSheetNote = state.factSheetNote || (factSheet ? 'Google 検索が使われませんでした' : '作成できませんでした');
  }
  return {
    state,
    next: 'plan',
    output: state.factSheet
      ? {
        facts: state.factSheet.facts.map((fact) => `${fact.statement}${fact.asOf ? `（${fact.asOf}）` : ''}`),
        sources: state.factSheet.sources.length,
        warnings: state.factSheet.warnings,
      }
      : { factSheet: `なし（${state.factSheetNote}）` },
  };
}

// --- 2. 企画: タイトル・文字数・構成案・根拠の割り当て ---
async function stepPlan(ctx: StepContext): Promise<StepResult> {
  const state: JobState = { ...ctx.state };
  const research = state.research || null;
  const competitorData = { articles: research?.competitors || [] };
  const relatedKeywords = (research?.relatedKeywords || []).slice(0, 8);
  const competitorHeadings = extractCompetitorHeadings(competitorData, 15);
  const competitorTitles = competitorData.articles.map((a) => a.title).filter(Boolean);

  const title = ctx.fixedTitle
    || await generateTitleWithAI(ctx.keyword, relatedKeywords, competitorTitles, ctx.aiConfig, competitorData);

  const lengthPlan: ArticleLengthPlan = ctx.settings.lengthMode === 'auto'
    ? await planArticleLength({
      keyword: ctx.keyword,
      title,
      competitorTitles,
      competitorHeadings: extractCompetitorHeadings(competitorData, 20),
      relatedKeywords,
      researchNotes: hasUsableFacts(state.factSheet) ? state.factSheet.facts.map((fact) => fact.statement) : [],
      maxChars: readAutoLengthMaxChars(),
      callAI: (prompt, maxTokens) => callAI(prompt, ctx.aiConfig, maxTokens),
    })
    : fixedLengthPlan(ctx.settings.targetWordCount);
  const targetWordCount = lengthPlan.targetChars;

  const baseInstructions = compactAutoModeInstructions([
    ctx.settings.customInstructions,
    relatedKeywords.length > 0 ? `Related keywords: ${relatedKeywords.join(', ')}` : undefined,
    buildAutoModeQualityInstructions({ selectedTitle: title, targetWordCount }),
  ]);
  const makeOutline = (extra?: string) => generateOutlineWithAutoModeStyle({
    keyword: ctx.keyword,
    targetWordCount,
    fixedTitle: title,
    customInstructions: compactAutoModeInstructions([
      baseInstructions,
      buildResearchOutlineInstructions(research),
      buildOutlineLengthInstructions(lengthPlan),
      buildFactSheetOutlineInstructions(state.factSheet || null),
      extra,
    ]),
    competitorHeadings,
    relatedKeywords,
    tone: ctx.settings.tone,
    callAI: (prompt, maxTokens) => callAI(prompt, ctx.aiConfig, maxTokens),
  });
  let outline = await makeOutline();
  const quality = evaluateAutoOutlineQuality(outline as any, { targetWordCount, selectedTitle: title });
  if (!quality.passed && ctx.run.hasTime(45_000)) {
    outline = await makeOutline(buildAutoOutlineRetryInstructions(quality.issues));
  }

  let sectionFactIds: string[][] | undefined;
  if (hasUsableFacts(state.factSheet)) {
    sectionFactIds = await assignFactsToSections({
      sheet: state.factSheet,
      sections: outline.sections.map((section) => ({ title: section.title, description: section.description })),
      call: ctx.run.call,
    });
  }

  Object.assign(state, {
    title,
    relatedKeywords,
    competitorHeadings,
    sectionKeywords: pickSectionKeywords(ctx.keyword, relatedKeywords),
    lengthPlan,
    outline: outline as ArticleOutline,
    sectionFactIds,
  });
  return {
    state,
    next: 'write',
    title,
    output: {
      title,
      lengthPlan,
      headings: outline.sections.map((s) => `${s.isLead ? 'lead' : `H${s.level}`} ${s.title}`),
      outlineIssues: quality.passed ? [] : quality.issues,
    },
  };
}

// --- 3. 執筆: 記事全体を一度に書く。長いときは H2 ごとに順番に書く（仕様書 4.1） ---
async function stepWrite(ctx: StepContext): Promise<StepResult> {
  const state: JobState = { ...ctx.state };
  if (!state.outline) throw new Error('構成案がありません');
  const targetChars = state.lengthPlan?.targetChars || ctx.settings.targetWordCount;
  const mode = state.writeMode || (targetChars > readWholeWritingLimit() ? 'sections' : 'whole');
  const params = generationParams(ctx);
  const title = state.title || ctx.keyword;

  if (mode === 'whole') {
    try {
      const startedAt = Date.now();
      const result = await generateSchedulerArticleSinglePass(params);
      const content = tidyContent(result.fullContent, title);
      state.writeMode = 'whole';
      pushVersion(state, '書いた直後', content);
      return {
        state,
        next: 'condense',
        content,
        output: { mode: '記事全体を一度に', chars: countGeneratedChars(content), seconds: Math.round((Date.now() - startedAt) / 1000) },
      };
    } catch (error) {
      // 時間切れや途中切れで失敗したら、見出しごとに順番に書く方法に切り替えて次の工程でやり直す
      const message = error instanceof Error ? error.message : String(error || '');
      state.writeMode = 'sections';
      state.sectionParts = [];
      state.nextGroup = 0;
      addNote(state, `記事全体を一度に書くのに失敗したため、見出しごとに書く方法に切り替えました（${message.slice(0, 120)}）`);
      return { state, next: 'write', output: { mode: '記事全体を一度に', failed: message.slice(0, 300), switchedTo: '見出しごと' } };
    }
  }

  // 見出しごと: 1 回の工程で H2 グループを 1 つ（時間があれば続けて）書く
  const writer = createSectionWriter(params);
  const parts = [...(state.sectionParts || [])];
  let groupIndex = state.nextGroup ?? 0;
  const written: string[] = [];
  while (groupIndex < writer.groups.length) {
    for (const step of writer.groups[groupIndex]) {
      const text = await writer.writeStep(step, parts.join('\n\n'));
      parts.push(writer.formatStep(step, text));
    }
    written.push(String(groupIndex));
    groupIndex += 1;
    // 次のグループを書く時間が残っていなければ、次の工程に回す
    if (!ctx.run.hasTime(60_000)) break;
  }
  state.writeMode = 'sections';
  state.sectionParts = parts;
  state.nextGroup = groupIndex;
  if (groupIndex < writer.groups.length) {
    return { state, next: 'write', output: { mode: '見出しごと', groupsWritten: written.length, remainingGroups: writer.groups.length - groupIndex } };
  }

  const content = tidyContent(parts.join('\n\n'), title);
  try {
    validateGeneratedArticleCompleteness(content, state.outline, targetChars);
  } catch (error) {
    addNote(state, `本文の確認で注意: ${error instanceof Error ? error.message : String(error)}`);
  }
  state.sectionParts = [];
  pushVersion(state, '書いた直後', content);
  return { state, next: 'condense', content, output: { mode: '見出しごと', chars: countGeneratedChars(content) } };
}

// --- 4. 文字数の調整: 目安の 1.5 倍を超えたときだけ AI が短く言い直す ---
async function stepCondense(ctx: StepContext): Promise<StepResult> {
  const state: JobState = { ...ctx.state };
  const target = state.lengthPlan?.targetChars || ctx.settings.targetWordCount;
  const chars = countGeneratedChars(ctx.content);
  if (!isOverLengthLimit(chars, target)) {
    state.lengthAdjustment = '不要';
    return { state, next: 'critique', output: { status: '不要', chars, target } };
  }
  const result = await condenseArticleIfTooLong({
    title: state.title || ctx.keyword,
    keyword: ctx.keyword,
    content: ctx.content,
    targetChars: target,
    callAI: (prompt, maxTokens) => callAI(prompt, ctx.aiConfig, maxTokens, { role: 'writer', thinkingBudget: 2048 }),
  });
  state.lengthAdjustment = result.reason;
  const content = result.applied ? tidyContent(result.content, state.title || ctx.keyword) : ctx.content;
  if (result.applied) pushVersion(state, '短縮後', content);
  return { state, next: 'critique', content, output: { status: result.reason, before: chars, after: countGeneratedChars(content) } };
}

// --- 5. 批評 ---
async function stepCritique(ctx: StepContext): Promise<StepResult> {
  const state: JobState = { ...ctx.state };
  let critique: EditorialCritique | null = null;
  try {
    critique = await runEditorialCritique({
      title: state.title || ctx.keyword,
      keyword: ctx.keyword,
      content: ctx.content,
      factSheet: state.factSheet || null,
      toneInstruction: toneInstructionFor(ctx.settings.tone),
      customInstructions: ctx.settings.customInstructions || undefined,
      call: ctx.run.call,
      thinkingBudget: REVIEW_THINKING_BUDGET,
    });
  } catch (error) {
    addNote(state, `批評に失敗したため、一般的な見直しだけ行います（${error instanceof Error ? error.message.slice(0, 120) : ''}）`);
  }
  state.critique = critique;
  return {
    state,
    next: 'rewrite',
    output: critique
      ? { summary: summarizeCritique(critique), overall: critique.summary, issues: critique.issues }
      : { summary: '批評を取得できませんでした' },
  };
}

// --- 6. 書き直し ---
async function stepRewrite(ctx: StepContext): Promise<StepResult> {
  const state: JobState = { ...ctx.state };
  const decision = await runEditorialReview({
    title: state.title || ctx.keyword,
    keyword: ctx.keyword,
    content: ctx.content,
    factSheet: state.factSheet || null,
    toneInstruction: toneInstructionFor(ctx.settings.tone),
    customInstructions: ctx.settings.customInstructions || undefined,
    call: ctx.run.call,
    thinkingBudget: REVIEW_THINKING_BUDGET,
    // 批評は前の工程で済ませている（取れなかったときは null → 一般的な見直し）
    presetCritique: state.critique ?? null,
  });
  state.reviewStatus = decision.accepted ? decision.reason : `不採用（${decision.reason}）`;
  const content = decision.accepted ? tidyContent(decision.content, state.title || ctx.keyword) : ctx.content;
  if (decision.accepted) pushVersion(state, '書き直し後', content);
  return {
    state,
    next: 'factcheck',
    content,
    output: { status: state.reviewStatus, before: countGeneratedChars(ctx.content), after: countGeneratedChars(content) },
  };
}

// --- 7. ファクトチェック: 主張をすべて検索で確かめる ---
async function stepFactCheck(ctx: StepContext): Promise<StepResult> {
  const state: JobState = { ...ctx.state };
  try {
    const result = await runGeminiFactCheck({
      content: ctx.content,
      keyword: ctx.keyword,
      factSheet: state.factSheet || null,
      call: ctx.run.call,
      resolveUrls: ctx.run.resolveUrls,
      canSearch: () => ctx.run.hasTime(25_000),
      concurrency: readGeminiMaxParallel(),
    });
    state.factCheck = {
      results: result.results,
      itemsChecked: result.itemsChecked,
      searchedClaims: result.searchedClaims,
      skippedSearchClaims: result.skippedSearchClaims,
      rounds: 1,
      autoFixApplied: false,
    };
  } catch (error) {
    state.factCheck = {
      results: [],
      itemsChecked: 0,
      searchedClaims: 0,
      skippedSearchClaims: 0,
      rounds: 0,
      autoFixApplied: false,
      error: error instanceof Error ? error.message : String(error || ''),
    };
  }
  const fc = state.factCheck;
  const needsFix = !fc.error && (countCriticalIssues(fc.results) > 0 || countMinorIssues(fc.results) > 0);
  return {
    state,
    next: needsFix ? 'fix' : 'finalize',
    output: {
      checked: fc.itemsChecked,
      searched: fc.searchedClaims,
      skipped: fc.skippedSearchClaims,
      critical: countCriticalIssues(fc.results),
      minor: countMinorIssues(fc.results),
      error: fc.error || null,
    },
  };
}

// --- 8. 修正と再確認（最大 2 回） ---
async function stepFix(ctx: StepContext): Promise<StepResult> {
  const state: JobState = { ...ctx.state };
  const fc: FactCheckState = { ...(state.factCheck as FactCheckState) };
  const title = state.title || ctx.keyword;
  let content = ctx.content;
  const fix = await applyGeminiFactCheckFixes({ content, results: fc.results, keyword: ctx.keyword, call: ctx.run.call });
  let applied = false;
  if (fix.content.trim()) {
    const fixed = tidyContent(fix.content, title);
    const headingsBefore = countNonSummaryHeadings(content);
    if (headingsBefore >= 2 && countNonSummaryHeadings(fixed) < Math.max(2, headingsBefore - 1)) {
      addNote(state, '自動修正で見出しが減りすぎたため、修正前の本文を使いました');
    } else {
      applied = fixed !== content;
      content = fixed;
    }
  }
  if (applied) {
    fc.autoFixApplied = true;
    pushVersion(state, `修正後（${fc.rounds}回目）`, content);
    const recheck = await runGeminiFactCheck({
      content,
      keyword: ctx.keyword,
      factSheet: state.factSheet || null,
      call: ctx.run.call,
      resolveUrls: ctx.run.resolveUrls,
      canSearch: () => ctx.run.hasTime(20_000),
      concurrency: readGeminiMaxParallel(),
      onlyClaims: claimsForRecheck(fc.results, content),
    });
    const fixable = new Set(getFixableFactCheckIssues(fc.results).map((r) => r.claim));
    fc.results = [...fc.results.filter((r) => !fixable.has(r.claim)), ...recheck.results];
    fc.skippedSearchClaims += recheck.skippedSearchClaims;
    fc.rounds += 1;
  }
  state.factCheck = fc;
  const stillIssues = countCriticalIssues(fc.results) > 0 || countMinorIssues(fc.results) > 0;
  const next: StepName = applied && stillIssues && fc.rounds < 3 ? 'fix' : 'finalize';
  return {
    state,
    next,
    content,
    output: {
      applied,
      round: fc.rounds,
      critical: countCriticalIssues(fc.results),
      minor: countMinorIssues(fc.results),
    },
  };
}

export type StepHandler = (ctx: StepContext) => Promise<StepResult>;

// 仕上げと投稿は DB・WordPress・通知を使うため index.ts で行う
export const STEP_HANDLERS: Partial<Record<StepName, StepHandler>> = {
  research: stepResearch,
  facts: stepFacts,
  plan: stepPlan,
  write: stepWrite,
  condense: stepCondense,
  critique: stepCritique,
  rewrite: stepRewrite,
  factcheck: stepFactCheck,
  fix: stepFix,
};
