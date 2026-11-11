// 今の流れ（自動投稿 scheduler-executor/index.ts の記事作成部分を、同じ部品・同じ順番・同じ時間管理で再現）
// DB・WordPress・通知には触れない。
import { DEFAULT_TARGET_WORD_COUNT } from '../../../src/shared/generationPolicy.ts';
import { countGeneratedChars, generateOutlineWithAutoModeStyle } from '../../../src/shared/articleGenerationCore.ts';
import {
  buildOutlineLengthInstructions,
  condenseArticleIfTooLong,
  fixedLengthPlan,
  formatLengthPlanLabel,
  isOverLengthLimit,
  planArticleLength,
  type ArticleLengthPlan,
} from '../../../src/shared/articleLengthPlan.ts';
import {
  buildAutoModeQualityInstructions,
  buildAutoOutlineRetryInstructions,
  compactAutoModeInstructions,
  evaluateAutoOutlineQuality,
} from '../../../src/shared/autoModeQuality.ts';
import { getFixableFactCheckIssues, type FactCheckResult } from '../../../src/shared/factCheckCore.ts';
import { getDefaultAiModel, resolveWritingModel } from '../../../src/shared/aiModelCatalog.ts';
import {
  assignFactsByOverlap,
  assignFactsToSections,
  buildFactSheet,
  buildFactSheetOutlineInstructions,
  hasUsableFacts,
  type FactSheet,
} from '../../../src/shared/factSheetCore.ts';
import {
  CRITIQUE_ISSUE_TYPES,
  runEditorialReview,
  summarizeCritique,
  type EditorialReviewDecision,
} from '../../../src/shared/editorialReviewCore.ts';

// 比較ページに出す見直しの結果（批評の内訳と指摘を含める）
export function formatReviewStatus(decision: EditorialReviewDecision, withCritique = true): string {
  const head = decision.accepted ? decision.reason : `不採用（${decision.reason}）`;
  if (!withCritique) return `${head}（時間が足りず批評は省略）`;
  if (!decision.critique) return `${head}（批評は取得できませんでした）`;
  const issues = decision.critique.issues
    .map((issue, i) => `${i + 1}. [${CRITIQUE_ISSUE_TYPES[issue.type]}] ${issue.section}: ${issue.problem}`)
    .join('\n');
  return `${head}\n批評: ${summarizeCritique(decision.critique)}${issues ? `\n${issues}` : ''}`;
}
import {
  applyGeminiFactCheckFixes,
  claimsForRecheck,
  countCriticalIssues,
  countMinorIssues,
  runGeminiFactCheck,
} from '../../../src/shared/geminiFactCheck.ts';
import {
  GenerationRun,
  readGeminiMaxParallel,
  readSchedulerTimeBudgetMs,
  readSectionWritingMode,
  SearchUnavailableError,
  withDeadline,
} from '../../../supabase/functions/scheduler-executor/_run.ts';
import { callAI, generateTitleWithAI } from '../../../supabase/functions/scheduler-executor/_ai.ts';
import {
  conductCompetitorResearch,
  extractCompetitorHeadings,
  extractRelatedKeywordsFromCompetitorData,
  fetchRelatedKeywordsViaCustomSearch,
} from '../../../supabase/functions/scheduler-executor/_research.ts';
import {
  generateSchedulerArticleSectioned,
  generateSchedulerArticleSinglePass,
  REVIEW_THINKING_BUDGET,
} from '../../../supabase/functions/scheduler-executor/_generation.ts';
import {
  countNonSummaryHeadings,
  normalizeGeneratedContentForPublishing,
} from '../../../supabase/functions/scheduler-executor/_content-format.ts';
import type { AIConfig } from '../../../supabase/functions/scheduler-executor/_shared.ts';
import { env, errorMessage, requireEnv, StepTimer } from '../lib/env.ts';
import { cleanupGenerated, finalizeArticle } from '../lib/finalize.ts';
import type { FlowResult } from '../lib/types.ts';

export async function runCurrentFlow(params: { keyword: string; targetWordCount?: number }): Promise<FlowResult> {
  const keyword = params.keyword;
  // --words を指定したときは文字数指定、指定しなければ本番の新しい既定と同じく「おまかせ」
  const lengthMode = params.targetWordCount ? 'fixed' : 'auto';
  let targetWordCount = params.targetWordCount || DEFAULT_TARGET_WORD_COUNT;
  let lengthPlan: ArticleLengthPlan = fixedLengthPlan(targetWordCount);
  const timer = new StepTimer();
  const geminiKey = requireEnv('GEMINI_API_KEY');
  const baseModel = env('GEMINI_MODEL', getDefaultAiModel('gemini'));
  const writerModel = env('GEMINI_WRITER_MODEL') || resolveWritingModel('gemini', baseModel, 'high');
  const run = new GenerationRun(Date.now(), readSchedulerTimeBudgetMs(), geminiKey, baseModel, writerModel);
  const aiConfig: AIConfig = {
    id: 'pipeline-compare',
    provider: 'gemini',
    api_key: geminiKey,
    model: baseModel,
    temperature: 0.7,
    max_tokens: 4000,
    run,
  };
  const searchApiKey = env('SEARCHAPI_API_KEY');
  // SearchApi のキーがあればそちらを優先する
  const serpApiKey = searchApiKey || env('SERPAPI_API_KEY');
  const researchLabel = searchApiKey ? 'SearchApi' : 'SerpAPI';
  const googleApiKey = env('GOOGLE_CUSTOM_SEARCH_API_KEY');
  const searchEngineId = env('GOOGLE_CUSTOM_SEARCH_ENGINE_ID');
  let serpapiCalls = 0;
  let customSearchCalls = 0;
  const warnings: string[] = [];
  const draftReasons: string[] = [];

  // 根拠メモは競合調査と同時に作る（本番と同じく 40 秒で打ち切り）
  let factSheetNote = '';
  const factSheetPromise: Promise<FactSheet | null> = timer.time(
    '根拠メモ（Gemini 検索）',
    () =>
      withDeadline(
        buildFactSheet({
          keyword,
          title: null,
          call: run.call,
          resolveUrls: run.resolveUrls,
          includeLatest: () => run.hasTime(110_000),
        }),
        40_000,
      ).then((sheet) => {
        if (!sheet) {
          factSheetNote = '時間内に作成できませんでした';
          return null;
        }
        if (!sheet.searchUsed) {
          factSheetNote = 'Google 検索が使われませんでした';
          return null;
        }
        return sheet;
      }),
    (sheet) => (sheet ? `事実${sheet.facts.length}件・出典${sheet.sources.length}件` : factSheetNote),
  ).catch((error) => {
    factSheetNote = error instanceof SearchUnavailableError ? 'このキーでは Google 検索を使えません' : errorMessage(error);
    return null;
  });

  let competitorData: any = null;
  if (serpApiKey) {
    try {
      serpapiCalls += 1;
      competitorData = await timer.time(
        `競合調査（${researchLabel}＋ページ取得）`,
        () => researchLabel === 'SerpAPI'
          ? conductCompetitorResearch(keyword, serpApiKey, 5)
          : withSearchApiInsteadOfSerpApi(() => conductCompetitorResearch(keyword, serpApiKey, 5)),
        (d: any) => `${d?.articles?.length || 0}件`,
      );
      competitorData.source = researchLabel;
    } catch (error) {
      warnings.push(`競合調査に失敗: ${errorMessage(error)}`);
    }
  } else {
    timer.skip('競合調査（SerpAPI）', 'SERPAPI_API_KEY・SEARCHAPI_API_KEY が未設定');
  }

  const factSheet = await factSheetPromise;

  const relatedKeywords: string[] = [];
  if (competitorData) relatedKeywords.push(...extractRelatedKeywordsFromCompetitorData(competitorData, keyword, 5));
  if (googleApiKey && searchEngineId) {
    try {
      customSearchCalls += 1;
      relatedKeywords.push(...await fetchRelatedKeywordsViaCustomSearch(keyword, googleApiKey, searchEngineId));
    } catch (error) {
      warnings.push(`Custom Search に失敗: ${errorMessage(error)}`);
    }
  }
  const sectionKeywords = pickSectionKeywords(keyword, relatedKeywords);
  const competitorHeadings = extractCompetitorHeadings(competitorData, 15);

  const competitorTitles = (competitorData?.articles || []).map((a: any) => a.title).filter(Boolean);
  const title = await timer.time('タイトル', () => generateTitleWithAI(keyword, relatedKeywords, competitorTitles, aiConfig, competitorData), (t) => t);

  // 文字数おまかせ（本番の index.ts と同じ: タイトルの後、構成案の前に AI が決める）
  if (lengthMode === 'auto') {
    lengthPlan = await timer.time('文字数を決める', () =>
      planArticleLength({
        keyword,
        title,
        competitorTitles,
        competitorHeadings: extractCompetitorHeadings(competitorData, 20),
        relatedKeywords,
        researchNotes: hasUsableFacts(factSheet) ? factSheet.facts.map((fact) => fact.statement) : [],
        callAI: (prompt, maxTokens) => callAI(prompt, aiConfig, maxTokens),
      }), (plan) => formatLengthPlanLabel(plan));
    targetWordCount = lengthPlan.targetChars;
  }

  const baseInstructions = compactAutoModeInstructions([
    relatedKeywords.length > 0 ? `Related keywords: ${relatedKeywords.slice(0, 8).join(', ')}` : undefined,
  ]);
  const effectiveInstructions = compactAutoModeInstructions([
    baseInstructions,
    buildAutoModeQualityInstructions({ selectedTitle: title, targetWordCount }),
  ]);
  const outlineFactInstructions = buildFactSheetOutlineInstructions(factSheet);
  const outlineLengthInstructions = buildOutlineLengthInstructions(lengthPlan);
  const outline = await timer.time('構成案', async () => {
    const makeOutline = (extra?: string) =>
      generateOutlineWithAutoModeStyle({
        keyword,
        targetWordCount,
        fixedTitle: title,
        customInstructions: compactAutoModeInstructions([effectiveInstructions, outlineLengthInstructions, outlineFactInstructions, extra]),
        competitorHeadings,
        relatedKeywords,
        tone: 'professional',
        callAI: (prompt, maxTokens) => callAI(prompt, aiConfig, maxTokens),
      });
    let result = await makeOutline();
    const quality = evaluateAutoOutlineQuality(result as any, { targetWordCount, selectedTitle: title });
    if (!quality.passed) result = await makeOutline(buildAutoOutlineRetryInstructions(quality.issues));
    return result;
  }, (o: any) => `見出し${o.sections.length}個`);

  let sectionFactIds: string[][] | undefined;
  if (hasUsableFacts(factSheet)) {
    const sections = outline.sections.map((s: any) => ({ title: s.title, description: s.description }));
    sectionFactIds = run.hasTime(100_000)
      ? await timer.time('根拠の割り当て（AI）', () => assignFactsToSections({ sheet: factSheet, sections, call: run.call }))
      : assignFactsByOverlap(factSheet, sections);
  }

  const generationParams = {
    outline,
    keyword,
    keywords: sectionKeywords,
    tone: 'professional' as const,
    targetWordCount,
    customInstructions: effectiveInstructions,
    aiConfig,
    factSheet,
    sectionFactIds,
    // 本番と同じ: 既定は H2 並列、SECTION_WRITING_MODE=sequential なら順番に書く
    parallelism: readSectionWritingMode() === 'parallel' ? readGeminiMaxParallel() : 1,
  };
  const writingLabel = readSectionWritingMode() === 'parallel' ? '本文（H2 並列）' : '本文（順番に書く）';
  const generated = await timer.time(writingLabel, async () => {
    try {
      return await generateSchedulerArticleSectioned(generationParams);
    } catch (error) {
      warnings.push(`セクション生成に失敗したため一括生成に切り替え: ${errorMessage(error)}`);
      return await generateSchedulerArticleSinglePass(generationParams);
    }
  }, (g) => `${g.wordCount}文字`);

  let content = cleanupGenerated(generated.fullContent, title, targetWordCount);

  // 文字数の調整（本番の index.ts と同じ）。目安の 1.5 倍を超えたときだけ AI が短く言い直す
  let lengthAdjustment = '不要';
  if (isOverLengthLimit(countGeneratedChars(content), targetWordCount)) {
    if (run.hasTime(75_000)) {
      const condensed = await timer.time('文字数の短縮（AI）', () =>
        condenseArticleIfTooLong({
          title,
          keyword,
          content,
          targetChars: targetWordCount,
          callAI: (prompt, maxTokens) => callAI(prompt, aiConfig, maxTokens, { role: 'writer', thinkingBudget: 2048 }),
        }), (r) => r.reason);
      if (condensed.applied) content = cleanupGenerated(condensed.content, title, targetWordCount);
      lengthAdjustment = condensed.reason;
    } else {
      run.skip('文字数の短縮');
      timer.skip('文字数の短縮', '時間切れ');
      lengthAdjustment = `時間切れのため短縮せずそのまま（${countGeneratedChars(content)}字）`;
    }
  }

  // 見直し（本番の index.ts と同じ: 時間があれば批評→書き直しの 2 段階、少なければ 1 回、さらに少なければ省略）
  let editorialReview = '未実行';
  const withCritique = run.hasTime(120_000);
  if (withCritique || run.hasTime(80_000)) {
    try {
      const decision = await timer.time(withCritique ? '見直し（批評→書き直し）' : '見直し（1回）', () =>
        runEditorialReview({
          title,
          keyword,
          content,
          factSheet,
          toneInstruction: 'ビジネス読者向けの自然な です・ます調',
          call: run.call,
          thinkingBudget: REVIEW_THINKING_BUDGET,
          critique: withCritique,
        }), (d) => (d.accepted ? d.reason : `不採用（${d.reason}）`));
      if (decision.accepted) content = cleanupGenerated(decision.content, title, targetWordCount);
      editorialReview = formatReviewStatus(decision, withCritique);
    } catch (error) {
      editorialReview = `失敗（${errorMessage(error)}）`;
    }
  } else {
    run.skip('編集見直し');
    timer.skip('見直し', '時間切れ');
    editorialReview = '時間切れで省略';
  }

  // ファクトチェック（Gemini 検索）と自動修正（本番と同じ条件）
  let results: FactCheckResult[] = [];
  let rounds = 0;
  let autoFixApplied = false;
  let factCheckNote = '';
  try {
    const concurrency = readGeminiMaxParallel();
    const first = await timer.time('ファクトチェック（Gemini）', () =>
      runGeminiFactCheck({
        content,
        keyword,
        factSheet,
        call: run.call,
        resolveUrls: run.resolveUrls,
        canSearch: () => run.hasTime(45_000),
        concurrency,
      }), (r) => `${r.itemsChecked}件確認・検索${r.searchedClaims}件・検索省略${r.skippedSearchClaims}件`);
    rounds = 1;
    results = first.results;
    let searchSkipped = first.skippedSearchClaims > 0;

    if (countCriticalIssues(results) > 0 || countMinorIssues(results) > 0) {
      const before = content;
      const headingsBefore = countNonSummaryHeadings(content);
      const fix = await timer.time('自動修正（Gemini）', () =>
        applyGeminiFactCheckFixes({ content, results, keyword, call: run.call }));
      if (fix.content.trim()) {
        const fixed = normalizeGeneratedContentForPublishing(fix.content, title);
        if (headingsBefore >= 2 && countNonSummaryHeadings(fixed) < Math.max(2, headingsBefore - 1)) {
          warnings.push('自動修正で見出しが減りすぎたため修正前の本文を使いました');
        } else {
          content = fixed;
          autoFixApplied = before !== fixed;
          if (run.hasTime(30_000)) {
            const recheck = await timer.time('修正箇所の再確認（Gemini）', () =>
              runGeminiFactCheck({
                content,
                keyword,
                factSheet,
                call: run.call,
                resolveUrls: run.resolveUrls,
                canSearch: () => run.hasTime(30_000),
                concurrency,
                onlyClaims: claimsForRecheck(results, content),
              }));
            rounds = 2;
            const fixable = new Set(getFixableFactCheckIssues(results).map((r) => r.claim));
            results = [...results.filter((r) => !fixable.has(r.claim)), ...recheck.results];
            searchSkipped = searchSkipped || recheck.skippedSearchClaims > 0;
          } else {
            run.skip('自動修正後の再確認');
            timer.skip('修正箇所の再確認', '時間切れ');
            searchSkipped = true;
          }
        }
      }
    }
    const critical = countCriticalIssues(results);
    if (critical > 0) draftReasons.push(`重大な指摘が残っています（${critical}件）`);
    if (searchSkipped) draftReasons.push('時間が足りず、一部の主張を検索で確認できませんでした');
  } catch (error) {
    factCheckNote = `失敗: ${errorMessage(error)}`;
    draftReasons.push(`ファクトチェックに失敗しました: ${errorMessage(error).slice(0, 200)}`);
  }

  const finalized = finalizeArticle({ content, baseContent: generated.fullContent, title, targetWordCount, outline, factSheet });
  draftReasons.push(...finalized.draftReasons);
  warnings.push(...finalized.warnings);

  return {
    name: 'current',
    label: '今の流れ',
    keyword,
    title,
    content: finalized.content,
    outline,
    research: competitorData,
    relatedKeywords,
    competitorHeadings,
    factSheet,
    factSheetNote: hasUsableFacts(factSheet) ? '' : factSheetNote || '事実が見つかりませんでした',
    editorialReview,
    factCheck: {
      verifier: 'Gemini（Google 検索）',
      executed: rounds > 0,
      results,
      rounds,
      autoFixApplied,
      note: factCheckNote,
    },
    writerModel: run.effectiveWriterModel,
    draftReasons,
    warnings,
    notes: run.notes,
    skippedSteps: run.skippedSteps,
    referencesCount: finalized.referencesCount,
    lengthPlan: {
      mode: lengthPlan.mode,
      targetChars: lengthPlan.targetChars,
      reason: lengthPlan.reason,
      maxHeadings: lengthPlan.maxHeadings,
      source: lengthPlan.source,
    },
    lengthAdjustment,
    steps: timer.steps,
    totalMs: timer.totalMs,
    usage: { gemini: run.tracker.summarize(), openai: null, serpapiCalls, customSearchCalls },
  };
}

// 本番の競合調査（_research.ts）は SerpAPI の URL を決め打ちで呼ぶため、
// テストの間だけ SearchApi（searchapi.io）に向け直す。応答の形（organic_results の title / link / snippet）は同じ。
// ページの見出しの読み取りは本番の処理をそのまま使う。
export async function withSearchApiInsteadOfSerpApi<T>(fn: () => Promise<T>): Promise<T> {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    if (url.startsWith('https://serpapi.com/search.json')) {
      const rewritten = new URL(url);
      rewritten.protocol = 'https:';
      rewritten.host = 'www.searchapi.io';
      rewritten.pathname = '/api/v1/search';
      return originalFetch(rewritten.href, init);
    }
    return originalFetch(input, init);
  }) as typeof fetch;
  try {
    return await fn();
  } finally {
    globalThis.fetch = originalFetch;
  }
}

// 本文の各セクションに渡すキーワード（本番と同じく最大 3 個、表記ゆれを除く）
export function pickSectionKeywords(keyword: string, relatedKeywords: string[]): string[] {
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
