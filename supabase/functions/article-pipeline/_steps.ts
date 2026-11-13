import { CASUAL_TONE_INSTRUCTION } from '../../../src/shared/toneOptions.ts';
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
  capOutlineHeadings,
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
  supplementFactSheet,
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
  claimsFromPatches,
  fixFactCheckIssuesWithPatches,
  mergeRecheckClaims,
  countCriticalIssues,
  countMinorIssues,
  runGeminiFactCheck,
} from '../../../src/shared/geminiFactCheck.ts';
import { getFixableFactCheckIssues, type FactCheckResult } from '../../../src/shared/factCheckCore.ts';
import { reviewTitleAgainstContent } from '../../../src/shared/titleReviewCore.ts';
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
import { normalizeAiRoleValues, type AiRole, type AiRoleValues } from '../../../src/shared/aiRoleSettings.ts';
import type { GeminiCaller } from '../../../src/shared/geminiCore.ts';
import type { AIConfig, ArticleOutline, WritingTone } from '../scheduler-executor/_shared.ts';
import { buildResearchOutlineInstructions, researchWithGemini, type AiResearch } from './_research.ts';
import { formatWideResearchForWriter, runWideResearch, WIDE_RESEARCH_LABELS, type WideResearch } from './_wideResearch.ts';
import { writeOneShotArticle } from './_oneShotWriter.ts';

// 書き方は 2 通り（2026-11-12 から「1 回で書き切る」が標準）
// - oneshot: 調査（広い調査）→ 執筆（1 回で書き切る）→ ファクトチェック → 修正 → 仕上げ
// - steps:   調査 → 根拠メモ → 企画 → 執筆 → 文字数の調整 → 批評 → 補足調査 → 書き直し → ファクトチェック → 修正 → 仕上げ
export const STEP_ORDER = [
  'research',
  'draft',
  'facts',
  'plan',
  'write',
  'condense',
  'critique',
  'supplement',
  'rewrite',
  'factcheck',
  'fix',
  'finalize',
] as const;
export type StepName = typeof STEP_ORDER[number];

export const STEP_LABELS: Record<StepName, string> = {
  research: '調査',
  draft: '執筆（1回で書き切る）',
  facts: '根拠メモ',
  plan: '企画',
  write: '執筆',
  condense: '文字数の調整',
  critique: '批評',
  supplement: '補足調査',
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
  // oneshot = 広い調査＋1 回で書き切る（標準）、steps = 工程を分けて批評・書き直しを重ねる
  writingStyle: 'oneshot' | 'steps';
  // 役割ごとの AI（AI 設定で選んだもの。ジョブを作った時点の設定を残す）。役割の一覧は aiRoleSettings.ts の AI_ROLES
  aiRoles: AiRoleValues;
}

export function normalizeJobSettings(raw: any): JobSettings {
  const target = Number(raw?.targetWordCount);
  return {
    writingStyle: raw?.writingStyle === 'steps' ? 'steps' : 'oneshot',
    // 古い形（writerAi / checkAi）も読めるようにしておく
    aiRoles: normalizeAiRoleValues(raw?.aiRoles ?? { writer: raw?.writerAi, factcheck: raw?.checkAi }),
    lengthMode: raw?.lengthMode === 'fixed' ? 'fixed' : 'auto',
    targetWordCount: Number.isFinite(target) && target >= 500 ? Math.min(6000, Math.round(target)) : 2000,
    tone: raw?.tone === 'professional' ? 'professional' : 'casual',
    qualityMode: raw?.qualityMode === 'standard' ? 'standard' : 'high',
    customInstructions: String(raw?.customInstructions || '').trim(),
    appendReferences: raw?.appendReferences === true,
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
  // 修正だけ済ませ、再確認を次の実行に回したとき true
  recheckPending?: boolean;
  // 直す文の組で直した記録（何回目・元の文・直した文）
  patches?: Array<{ round: number; before: string; after: string }>;
}

// 工程の間で受け渡す途中経過（article_jobs.state）
export interface JobState {
  // 広い調査の結果（書き方が oneshot のとき）
  wideResearch?: WideResearch | null;
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
  // 批評 → 書き直しの何回目か（1 から）
  reviewRound?: number;
  sectionParts?: string[];
  nextGroup?: number;
  versions?: ContentVersion[];
  lengthAdjustment?: string;
  critique?: EditorialCritique | null;
  reviewStatus?: string;
  // 回ごとの批評（画面と記録用）
  critiques?: Array<{ round: number; critique: EditorialCritique | null }>;
  // 補足調査（批評の指摘を検索で調べて根拠メモに足した記録）
  supplements?: Array<{ round: number; questions: string[]; status: string }>;
  // 本文に合わせたタイトルの見直し（変えたときは before と after が違う）
  titleReview?: { before: string; after: string; reason: string } | null;
  factCheck?: FactCheckState;
  notes?: string[];
}

// 費用より質を優先する設定（2026-11-11 の方針）。環境変数で変えられる
function readNumberEnv(name: string, fallback: number, min: number, max: number): number {
  const raw = Number(Deno.env.get(name));
  return Number.isFinite(raw) && raw >= min && raw <= max ? raw : fallback;
}
// 執筆・書き直しの思考の上限
export const PIPELINE_WRITER_THINKING = readNumberEnv('ARTICLE_PIPELINE_WRITER_THINKING_BUDGET', 8192, 0, 32768);
// 批評の思考の上限（出力は短いので多めに考えさせる）
export const PIPELINE_CRITIQUE_THINKING = readNumberEnv('ARTICLE_PIPELINE_CRITIQUE_THINKING_BUDGET', 12288, 0, 32768);
// 批評 → 書き直しを最大何回繰り返すか
export const MAX_REVIEW_ROUNDS = readNumberEnv('ARTICLE_PIPELINE_MAX_REVIEW_ROUNDS', 2, 1, 3);
// 2 回目の批評に進むのは、1 回目の指摘がこの件数以上あったとき
const REVIEW_AGAIN_MIN_ISSUES = 3;

// 工程ごとに使うモデル。高品質モードでは、構成案・タイトル・批評なども上位モデル（Pro）で行う。
// 調査・根拠メモ・ファクトチェック・修正は Google 検索を何度も呼ぶため、Pro では 1 工程の 120 秒に
// 収まらない（2026-11-11 の実測: ファクトチェック 113 秒・修正 139 秒）ので基本モデルのまま
export function baseModelForStep(step: StepName, baseModel: string, writerModel: string, qualityMode: string): string {
  if (qualityMode !== 'high') return baseModel;
  return step === 'research' || step === 'facts' || step === 'supplement' || step === 'factcheck' || step === 'fix' ? baseModel : writerModel;
}

export interface StepContext {
  // この工程を何回目に試しているか（調査は回を重ねるごとに読むページを減らす）
  attempt: number;
  keyword: string;
  fixedTitle: string | null;
  settings: JobSettings;
  state: JobState;
  content: string;
  run: GenerationRun;
  aiConfig: AIConfig;
  // AI 設定で ChatGPT・Claude を選んだ役割の呼び出し口（役割の一覧は aiRoleSettings.ts の AI_ROLES）。
  // 入っていない役割は Gemini（run.call）で行う
  callers?: Partial<Record<AiRole, RoleCaller>>;
}

export interface RoleCaller {
  call: GeminiCaller;
  label: string;
}

const roleCall = (ctx: StepContext, role: AiRole): GeminiCaller => ctx.callers?.[role]?.call || ctx.run.call;
const writerCall = (ctx: StepContext): GeminiCaller => roleCall(ctx, 'writer');
const checkCall = (ctx: StepContext): GeminiCaller => roleCall(ctx, 'factcheck');
// ChatGPT・Claude の検索は 1 回が長いため、全部の組を同時に確かめて 120 秒に収める
const checkConcurrency = (ctx: StepContext): number => (ctx.callers?.factcheck ? 5 : readGeminiMaxParallel());

export interface StepResult {
  state: JobState;
  next: StepName | 'done';
  content?: string;
  title?: string;
  // 工程の記録（article_job_steps.output）に残す要約
  output: Record<string, unknown>;
}

const toneInstructionFor = (tone: WritingTone) =>
  tone === 'casual' ? CASUAL_TONE_INSTRUCTION : 'ビジネス読者向けの自然な です・ます調';

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
    writerThinkingBudget: PIPELINE_WRITER_THINKING,
  };
}

// --- 1a. 調査: Gemini の Google 検索で上位ページを読む（90〜100 秒かかるため、根拠メモとは別の工程） ---
async function stepResearch(ctx: StepContext): Promise<StepResult> {
  if (ctx.settings.writingStyle === 'oneshot') return stepWideResearch(ctx);
  const state: JobState = { ...ctx.state };
  let research: AiResearch;
  // 1 回目は 3 ページ、やり直しでは 2 ページだけ読む（時間切れを繰り返さないため）
  const pages = ctx.attempt <= 1 ? 3 : 2;
  try {
    research = await researchWithGemini(ctx.run, ctx.keyword, 100_000, pages);
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

// --- 1（oneshot）. 広い調査: 上位記事の中身・実際の悩み・公式情報を同時に調べる ---
async function stepWideResearch(ctx: StepContext): Promise<StepResult> {
  const state: JobState = { ...ctx.state };
  const research = await runWideResearch(ctx.run, ctx.keyword, 100_000);
  const okParts = research.parts.filter((p) => p.ok);
  // 上位記事の中身が 1 つも取れなければ、材料が足りないのでやり直す
  if (!okParts.some((p) => p.part === 'top_a' || p.part === 'top_b')) {
    const reasons = research.parts.map((p) => `${WIDE_RESEARCH_LABELS[p.part]}: ${p.error || '空'}`).join(' / ');
    throw new Error(`調査で上位記事の中身を取れませんでした（${reasons.slice(0, 300)}）`);
  }
  for (const p of research.parts) {
    if (!p.ok) addNote(state, `調査「${WIDE_RESEARCH_LABELS[p.part]}」を取れませんでした（${p.error || '空'}）`);
    else if (!p.grounded) addNote(state, `調査「${WIDE_RESEARCH_LABELS[p.part]}」で Google 検索が使われませんでした`);
  }
  state.wideResearch = research;
  return {
    state,
    next: 'draft',
    output: {
      parts: research.parts.map((p) => ({
        part: WIDE_RESEARCH_LABELS[p.part],
        ok: p.ok,
        chars: p.text.length,
        grounded: p.grounded,
        seconds: Math.round(p.ms / 1000),
        error: p.error || null,
      })),
      sources: research.sources.length,
    },
  };
}

// --- 2（oneshot）. 執筆: 上位モデルが調査の材料を読み、検索しながら記事全体を 1 回で書き切る ---
async function stepDraft(ctx: StepContext): Promise<StepResult> {
  const state: JobState = { ...ctx.state };
  if (!state.wideResearch) throw new Error('調査の結果がありません');
  const material = formatWideResearchForWriter(state.wideResearch);
  const article = await writeOneShotArticle(writerCall(ctx), {
    keyword: ctx.keyword,
    material,
    fixedTitle: ctx.fixedTitle,
    toneInstruction: toneInstructionFor(ctx.settings.tone),
    targetChars: ctx.settings.lengthMode === 'fixed' ? ctx.settings.targetWordCount : null,
    customInstructions: ctx.settings.customInstructions || undefined,
  }, { useSearch: !ctx.callers?.writer });
  if (ctx.callers?.writer) addNote(state, `執筆: ${ctx.callers.writer.label}`);
  state.title = article.title;
  state.writeMode = 'whole';
  const content = tidyContent(article.content, article.title);
  pushVersion(state, '執筆直後', content);
  return {
    state,
    next: 'factcheck',
    content,
    title: article.title,
    output: { title: article.title, chars: countGeneratedChars(content), searchUsed: article.grounded },
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
      // 読者の疑問ごとに答えになる事実（判定基準・区分ごとの金額など）も同時に集める
      readerQuestions: (research?.readerQuestions || []).slice(0, 8),
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
  // 上位モデルの構成案は 1 回 30〜50 秒かかるため、作り直しは時間が十分あるときだけ
  if (!quality.passed && ctx.run.hasTime(65_000)) {
    outline = await makeOutline(buildAutoOutlineRetryInstructions(quality.issues));
  }
  // 文字数に対して見出しが多すぎると本文で見出しがまとめられて失敗するため、上限まで減らす
  const cappedOutline = capOutlineHeadings(outline.sections, lengthPlan.maxHeadings);
  if (cappedOutline.removed.length > 0) {
    outline = { ...outline, sections: cappedOutline.sections };
    addNote(state, `見出しが多すぎたため、${cappedOutline.removed.length}個を他の見出しにまとめました（${cappedOutline.removed.join(' / ').slice(0, 120)}）`);
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
      thinkingBudget: PIPELINE_CRITIQUE_THINKING,
    });
  } catch (error) {
    addNote(state, `批評に失敗したため、一般的な見直しだけ行います（${error instanceof Error ? error.message.slice(0, 120) : ''}）`);
  }
  const round = state.reviewRound || 1;
  state.critique = critique;
  state.critiques = [...(state.critiques || []), { round, critique }];
  // 2 回目以降で指摘がほとんどなければ、書き直さずにファクトチェックへ進む
  if (round > 1 && (!critique || critique.issues.length < REVIEW_AGAIN_MIN_ISSUES)) {
    return {
      state,
      next: 'factcheck',
      output: { round, summary: critique ? summarizeCritique(critique) : '批評を取得できませんでした', skippedRewrite: '指摘が少ないため書き直さない' },
    };
  }
  return {
    state,
    next: 'supplement',
    output: critique
      ? { round, summary: summarizeCritique(critique), overall: critique.summary, issues: critique.issues }
      : { round, summary: '批評を取得できませんでした' },
  };
}

// --- 5b. 補足調査: 批評で足りないと言われた事実を検索で調べ、根拠メモに足す ---
// 書き直しは根拠メモにある事実しか使えないため、ここで補わないと指摘を直せない
// （例: 「自分が申告の対象か」の基礎控除がメモになく、書き直しでも足せなかった。2026-11-12）
const SUPPLEMENT_ISSUE_TYPES = new Set(['unanswered', 'incomplete', 'vague', 'thin']);
const MAX_SUPPLEMENT_QUESTIONS = 6;

async function stepSupplement(ctx: StepContext): Promise<StepResult> {
  const state: JobState = { ...ctx.state };
  const round = state.reviewRound || 1;
  const questions = (state.critique?.issues || [])
    .filter((issue) => SUPPLEMENT_ISSUE_TYPES.has(issue.type))
    .map((issue) => `${issue.problem}（${issue.fix}）`.slice(0, 200))
    .slice(0, MAX_SUPPLEMENT_QUESTIONS);
  if (questions.length === 0) {
    return { state, next: 'rewrite', output: { round, status: '調べる指摘なし' } };
  }
  try {
    const result = await supplementFactSheet({
      keyword: ctx.keyword,
      title: state.title,
      questions,
      base: state.factSheet || null,
      call: ctx.run.call,
      resolveUrls: ctx.run.resolveUrls,
    });
    if (result.added > 0) state.factSheet = result.sheet;
    const status = result.added > 0
      ? `${result.added}件の事実を追加`
      : result.searchUsed ? '新しい事実は見つからず' : 'Google 検索が使われなかったため追加なし';
    state.supplements = [...(state.supplements || []), { round, questions, status }];
    return { state, next: 'rewrite', output: { round, status, questions } };
  } catch (error) {
    // 補足できなくても、今の根拠メモで書き直しは進める
    const message = error instanceof Error ? error.message.slice(0, 120) : String(error || '');
    addNote(state, `補足調査に失敗したため、今の根拠メモで書き直します（${message}）`);
    return { state, next: 'rewrite', output: { round, status: '失敗', questions } };
  }
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
    // 2 回目の書き直しは足しすぎて不採用（文字数 +50%）になったため、量を増やさないよう念を押す
    customInstructions: [
      ctx.settings.customInstructions,
      (ctx.state.reviewRound || 1) > 1
        ? '今回は 2 回目の書き直しです。内容を足すより、指摘の箇所を言い換え・置き換えで直してください。本文の文字数は今の ±15% 以内に保ってください。'
        : '',
    ].filter(Boolean).join('\n') || undefined,
    call: ctx.run.call,
    thinkingBudget: PIPELINE_WRITER_THINKING,
    // 批評は前の工程で済ませている（取れなかったときは null → 一般的な見直し）
    presetCritique: state.critique ?? null,
  });
  const round = state.reviewRound || 1;
  const status = decision.accepted ? decision.reason : `不採用（${decision.reason}）`;
  state.reviewStatus = round > 1 ? `${state.reviewStatus || ''} → ${round}回目: ${status}` : `1回目: ${status}`;
  const content = decision.accepted ? tidyContent(decision.content, state.title || ctx.keyword) : ctx.content;
  if (decision.accepted) pushVersion(state, `書き直し後（${round}回目）`, content);

  // タイトルを本文に合わせて見直す（人が指定したタイトルは変えない）
  let titleReview: { before: string; after: string; reason: string } | null = null;
  if (!ctx.fixedTitle && state.title) {
    const review = await reviewTitleAgainstContent({
      title: state.title,
      keyword: ctx.keyword,
      content,
      callAI: (prompt, maxTokens) => callAI(prompt, ctx.aiConfig, maxTokens),
    });
    titleReview = { before: state.title, after: review.title, reason: review.reason };
    state.titleReview = titleReview;
    if (review.changed) state.title = review.title;
  }
  // 人が 2 回ダメ出しするのに近づけるため、批評 → 書き直しを最大 MAX_REVIEW_ROUNDS 回まで繰り返す
  const critiqueAgain = round < MAX_REVIEW_ROUNDS && Boolean(state.critique) && (state.critique?.issues.length || 0) >= REVIEW_AGAIN_MIN_ISSUES;
  if (critiqueAgain) state.reviewRound = round + 1;
  return {
    state,
    next: critiqueAgain ? 'critique' : 'factcheck',
    content,
    title: state.title,
    output: {
      round,
      status,
      before: countGeneratedChars(ctx.content),
      after: countGeneratedChars(content),
      titleReview,
    },
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
      call: checkCall(ctx),
      resolveUrls: ctx.run.resolveUrls,
      canSearch: () => ctx.run.hasTime(25_000),
      concurrency: checkConcurrency(ctx),
    });
    if (ctx.callers?.factcheck) addNote(state, `ファクトチェック: ${ctx.callers.factcheck.label}`);
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

// --- 8. 修正と再確認（最大 3 回） ---
// ファクトチェック・修正の AI が ChatGPT・Claude なら、直す文の組だけを返させて置き換える（仕様書 4.3）。
// 組で直せなかった指摘と、Gemini を選んでいるときは、記事全体の書き直しで直す。
// 修正のあと再確認の時間が残っていなければ、再確認は次の実行（同じ工程）に回す
const RECHECK_REQUIRED_MS = 70_000;

async function stepFix(ctx: StepContext): Promise<StepResult> {
  const state: JobState = { ...ctx.state };
  const fc: FactCheckState = { ...(state.factCheck as FactCheckState) };
  const title = state.title || ctx.keyword;
  let content = ctx.content;
  let applied = false;
  let patchCount = 0;
  let rewrittenIssues = 0;
  let keptCount = 0;

  if (!fc.recheckPending) {
    let fixedContent = '';
    // 修正の役割が ChatGPT・Claude なら、検索で確かめて直す文だけを置き換える。
    // Gemini（標準）なら、記事全体を書き直して直す（前後の文のつながりが自然になる）
    const fixer = ctx.callers?.fix;
    if (fixer) {
      const fix = await fixFactCheckIssuesWithPatches({
        content,
        results: fc.results,
        keyword: ctx.keyword,
        call: fixer.call,
        rewriteCall: ctx.run.call,
        // 直す前に検索で正しい内容を確かめさせる（記憶違いで正しい文を誤りに変えるのを防ぐ。仕様書 4.3）
        useSearch: true,
      });
      keptCount = fix.kept.length;
      for (const k of fix.kept) {
        addNote(state, `修正（${fc.rounds}回目）: 検索で確かめた結果、元の文が正しいため直さなかった: 「${k.claim.slice(0, 60)}」（${k.reason.slice(0, 120)}）`);
      }
      if (!fix.searchUsed) addNote(state, `修正（${fc.rounds}回目）: ${fixer.label} が検索を使わずに直しました`);
      fixedContent = fix.content;
      patchCount = fix.applied.length;
      rewrittenIssues = fix.rewrittenIssues;
      fc.patches = [
        ...(fc.patches || []),
        ...fix.applied.map((p) => ({ round: fc.rounds, before: p.before, after: p.after })),
      ];
      if (fix.rewrittenIssues > 0) {
        addNote(state, `修正（${fc.rounds}回目）: 直す文の組で直せなかった ${fix.rewrittenIssues} 件は、Gemini で書き直して直しました`);
      }
    } else {
      const fix = await applyGeminiFactCheckFixes({ content, results: fc.results, keyword: ctx.keyword, call: ctx.run.call });
      fixedContent = fix.content;
    }
    if (fixedContent.trim()) {
      const fixed = tidyContent(fixedContent, title);
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
      fc.recheckPending = true;
    }
  }

  let rechecked = false;
  if (fc.recheckPending && ctx.run.hasTime(RECHECK_REQUIRED_MS)) {
    const recheck = await runGeminiFactCheck({
      content,
      keyword: ctx.keyword,
      factSheet: state.factSheet || null,
      call: checkCall(ctx),
      resolveUrls: ctx.run.resolveUrls,
      canSearch: () => ctx.run.hasTime(20_000),
      concurrency: checkConcurrency(ctx),
      // 元の主張に似た文に加え、この回に直す文の組で書き換えた文も確かめる
      onlyClaims: mergeRecheckClaims(
        claimsForRecheck(fc.results, content),
        claimsFromPatches((fc.patches || []).filter((p) => p.round === fc.rounds).map((p) => p.after), content),
      ),
    });
    const fixable = new Set(getFixableFactCheckIssues(fc.results).map((r) => r.claim));
    fc.results = [...fc.results.filter((r) => !fixable.has(r.claim)), ...recheck.results];
    fc.skippedSearchClaims += recheck.skippedSearchClaims;
    fc.rounds += 1;
    fc.recheckPending = false;
    rechecked = true;
  }
  state.factCheck = fc;

  const stillIssues = countCriticalIssues(fc.results) > 0 || countMinorIssues(fc.results) > 0;
  let next: StepName = 'finalize';
  if (fc.recheckPending) next = 'fix';
  else if (rechecked && stillIssues && fc.rounds < 3) next = 'fix';
  return {
    state,
    next,
    content,
    output: {
      applied,
      patches: patchCount,
      kept: keptCount,
      rewrittenIssues,
      rechecked,
      recheckDeferred: Boolean(fc.recheckPending),
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
  draft: stepDraft,
  facts: stepFacts,
  plan: stepPlan,
  write: stepWrite,
  condense: stepCondense,
  critique: stepCritique,
  supplement: stepSupplement,
  rewrite: stepRewrite,
  factcheck: stepFactCheck,
  fix: stepFix,
};
