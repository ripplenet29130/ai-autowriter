// 新しい流れ（v2 仕様のお試し版）
// - 調査は Gemini の Google 検索＋ページ読み込みだけで行う（SerpAPI・Custom Search を使わない）
// - 時間制限で工程を省略しない（本番では工程ごとに分けて実行する想定）
// - 本文は H2 ごとに順番に書く（前のセクションとのつながりを保つ）
// - 検証は ChatGPT（Web 検索付き）。修正は Gemini、再検証は ChatGPT（最大 2 回）
import { DEFAULT_TARGET_WORD_COUNT } from '../../../src/shared/generationPolicy.ts';
import { generateOutlineWithAutoModeStyle } from '../../../src/shared/articleGenerationCore.ts';
import {
  buildAutoModeQualityInstructions,
  buildAutoOutlineRetryInstructions,
  compactAutoModeInstructions,
  evaluateAutoOutlineQuality,
} from '../../../src/shared/autoModeQuality.ts';
import { getFixableFactCheckIssues, type FactCheckResult } from '../../../src/shared/factCheckCore.ts';
import { getDefaultAiModel, resolveWritingModel } from '../../../src/shared/aiModelCatalog.ts';
import {
  assignFactsToSections,
  buildFactSheet,
  buildFactSheetOutlineInstructions,
  hasUsableFacts,
  type FactSheet,
} from '../../../src/shared/factSheetCore.ts';
import { runEditorialReview } from '../../../src/shared/editorialReviewCore.ts';
import {
  applyGeminiFactCheckFixes,
  claimsForRecheck,
  countCriticalIssues,
  countMinorIssues,
  runGeminiFactCheck,
} from '../../../src/shared/geminiFactCheck.ts';
import {
  GeminiHttpError,
  geminiGenerateUrl,
  isRateLimitError,
  parseGeminiResponse,
  sleep,
} from '../../../src/shared/geminiCore.ts';
import { GenerationRun } from '../../../supabase/functions/scheduler-executor/_run.ts';
import { callAI, generateTitleWithAI } from '../../../supabase/functions/scheduler-executor/_ai.ts';
import { extractCompetitorHeadings } from '../../../supabase/functions/scheduler-executor/_research.ts';
import { generateSchedulerArticleSectioned } from '../../../supabase/functions/scheduler-executor/_generation.ts';
import {
  countNonSummaryHeadings,
  normalizeGeneratedContentForPublishing,
} from '../../../supabase/functions/scheduler-executor/_content-format.ts';
import type { AIConfig } from '../../../supabase/functions/scheduler-executor/_shared.ts';
import { env, errorMessage, requireEnv, StepTimer } from '../lib/env.ts';
import { cleanupGenerated, finalizeArticle } from '../lib/finalize.ts';
import { OpenAiClient } from '../lib/openai.ts';
import { verifyWithChatGpt } from '../lib/verify.ts';
import type { FlowResult } from '../lib/types.ts';
import { formatReviewStatus, pickSectionKeywords } from './current.ts';

const MAX_FIX_ROUNDS = 2;

export interface AiResearch {
  searchIntent: string;
  readerQuestions: string[];
  competitors: Array<{ title: string; url: string; headings: string[] }>;
  relatedKeywords: string[];
  gaps: string[];
  searchQueries: string[];
  groundingSources: Array<{ title: string; url: string }>;
  urlContextUsed: boolean;
  searchUsed: boolean;
}

function buildResearchPrompt(keyword: string): string {
  return [
    `キーワード「${keyword}」で日本の Google 検索をして、上位に表示される記事ページ（広告・動画・SNS・EC の商品ページを除く）を 5 件ほど実際に読んでください。`,
    'そのうえで、このキーワードで記事を書くための調査結果をまとめてください。',
    '見出しは推測で作らず、読んだページにあるものだけを書いてください。',
    '',
    // 「JSON だけを返す」と指示すると Gemini が検索せずに記憶だけで答えるため、見出しと箇条書きで書かせる
    '次の形式で書いてください（JSON やコードフェンスは使わない）。',
    '## 検索意図',
    '検索する人が本当に知りたいこと（2〜3 文）',
    '## 読者の疑問',
    '- 読者が持っている具体的な疑問（5〜10 個）',
    '## 上位記事',
    '### 読んだ記事のタイトル',
    'URL: 実際に読んだページの URL',
    '- その記事の H2・H3 見出し（順番どおり、最大 12 個）',
    '## 関連キーワード',
    '- 記事に含めるべき関連キーワード（5〜10 個）',
    '## 上位記事に足りない点',
    '- 上位記事に足りない情報や、差別化できる点（3〜5 個）',
  ].join('\n');
}

// 見出しと箇条書きで書かれた調査結果を読む
export function parseResearchText(text: string): Pick<AiResearch, 'searchIntent' | 'readerQuestions' | 'competitors' | 'relatedKeywords' | 'gaps'> {
  const result = {
    searchIntent: '',
    readerQuestions: [] as string[],
    competitors: [] as AiResearch['competitors'],
    relatedKeywords: [] as string[],
    gaps: [] as string[],
  };
  let section = '';
  const intentLines: string[] = [];
  for (const rawLine of String(text || '').split('\n')) {
    const line = rawLine.trim();
    if (!line) continue;
    const h2 = line.match(/^##\s+(.+)$/);
    if (h2) {
      const name = h2[1];
      section = /検索意図/.test(name) ? 'intent'
        : /疑問/.test(name) ? 'questions'
        : /足りない|差別化/.test(name) ? 'gaps'
        : /上位記事/.test(name) ? 'competitors'
        : /関連キーワード/.test(name) ? 'keywords'
        : '';
      continue;
    }
    const h3 = line.match(/^###\s+(.+)$/);
    if (h3 && section === 'competitors') {
      result.competitors.push({ title: h3[1].replace(/\*\*/g, '').trim(), url: '', headings: [] });
      continue;
    }
    const current = result.competitors[result.competitors.length - 1];
    const url = line.match(/^[-*]?\s*URL\s*[:：]\s*(\S+)/i);
    if (url && section === 'competitors' && current) {
      current.url = url[1];
      continue;
    }
    const bullet = line.match(/^(?:[-・*•]|\d+[.)．、])\s*(.+)$/);
    const body = (bullet ? bullet[1] : line).replace(/\*\*/g, '').trim();
    if (section === 'intent') intentLines.push(body);
    else if (!bullet) continue;
    else if (section === 'questions') result.readerQuestions.push(body);
    else if (section === 'keywords') result.relatedKeywords.push(body);
    else if (section === 'gaps') result.gaps.push(body);
    else if (section === 'competitors' && current && current.headings.length < 12) current.headings.push(body);
  }
  result.searchIntent = intentLines.join('');
  return result;
}

// Gemini の Google 検索＋URL 読み込みで調査する（geminiCore の共通部品は URL 読み込みに未対応のため個別に呼ぶ）
async function researchWithGemini(run: GenerationRun, keyword: string): Promise<AiResearch> {
  let useUrlContext = true;
  for (let attempt = 0; ; attempt++) {
    const body = {
      contents: [{ role: 'user', parts: [{ text: buildResearchPrompt(keyword) }] }],
      generationConfig: { temperature: 0.2, maxOutputTokens: 8192 },
      tools: [{ google_search: {} }, ...(useUrlContext ? [{ url_context: {} }] : [])],
    };
    const res = await fetch(geminiGenerateUrl(run.baseModel, run.apiKey), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(180_000),
    });
    if (!res.ok) {
      const text = await res.text();
      if (res.status === 400 && useUrlContext && /url_context/i.test(text)) {
        useUrlContext = false;
        continue;
      }
      const error = new GeminiHttpError(res.status, text, run.baseModel);
      if (isRateLimitError(error) && attempt < 3) {
        await sleep(error.retryAfterMs ?? 2000 * 2 ** attempt);
        continue;
      }
      throw error;
    }
    const data = await res.json();
    const parsed = parseGeminiResponse(data, run.baseModel);
    run.tracker.record(run.baseModel, parsed.usage, parsed.grounded, parsed.searchQueries.length);
    const research = parseResearchText(parsed.text);
    if (!research.searchIntent && research.competitors.length === 0) {
      throw new Error(`調査結果を読み取れませんでした: ${parsed.text.slice(0, 300)}`);
    }
    // 検索せずに答えた場合は 1 回だけやり直す
    if (!parsed.grounded && attempt < 1) continue;

    const resolved = await run.resolveUrls(parsed.sources.map((s) => s.uri).filter(Boolean)).catch(() => ({} as Record<string, string>));
    return {
      ...research,
      searchUsed: parsed.grounded,
      searchQueries: parsed.searchQueries,
      groundingSources: parsed.sources.map((s) => ({ title: s.title, url: resolved[s.uri] || s.uri })),
      urlContextUsed: useUrlContext && Boolean(data?.candidates?.[0]?.urlContextMetadata),
    };
  }
}

export async function runV2Flow(params: { keyword: string; targetWordCount?: number }): Promise<FlowResult> {
  const keyword = params.keyword;
  const targetWordCount = params.targetWordCount || DEFAULT_TARGET_WORD_COUNT;
  const timer = new StepTimer();
  const geminiKey = requireEnv('GEMINI_API_KEY');
  const baseModel = env('GEMINI_MODEL', getDefaultAiModel('gemini'));
  const writerModel = env('GEMINI_WRITER_MODEL') || resolveWritingModel('gemini', baseModel, 'high');
  // 工程ごとに分けて実行する想定なので、全体の時間上限は実質なし（1 時間）
  const run = new GenerationRun(Date.now(), 3_600_000, geminiKey, baseModel, writerModel);
  const aiConfig: AIConfig = {
    id: 'pipeline-compare-v2',
    provider: 'gemini',
    api_key: geminiKey,
    model: baseModel,
    temperature: 0.7,
    max_tokens: 4000,
    run,
  };
  const openAiKey = env('OPENAI_API_KEY');
  const openai = openAiKey ? new OpenAiClient(openAiKey, env('OPENAI_MODEL', getDefaultAiModel('openai'))) : null;
  const warnings: string[] = [];
  const draftReasons: string[] = [];

  // 1. 調査（AI 検索だけ）
  const research = await timer.time('調査（Gemini 検索＋ページ読み込み）', () => researchWithGemini(run, keyword),
    (r) => `上位記事${r.competitors.length}件・${r.searchUsed ? `検索${r.searchQueries.length}回` : '検索なし'}${r.urlContextUsed ? '・ページ読み込みあり' : ''}`);
  if (!research.searchUsed) warnings.push('調査で Google 検索が使われませんでした（AI の知識とページ読み込みだけで調査）');
  const competitorData = { articles: research.competitors };
  const competitorHeadings = extractCompetitorHeadings(competitorData, 15);
  const relatedKeywords = research.relatedKeywords.slice(0, 8);
  const sectionKeywords = pickSectionKeywords(keyword, relatedKeywords);

  // 2. 根拠集め（調査結果を渡す。最新情報の検索も必ず行う）
  let factSheetNote = '';
  let factSheet: FactSheet | null = null;
  try {
    factSheet = await timer.time('根拠集め（Gemini 検索）', () =>
      buildFactSheet({
        keyword,
        relatedKeywords,
        competitorHeadings,
        call: run.call,
        resolveUrls: run.resolveUrls,
        includeLatest: () => true,
      }), (s) => `事実${s.facts.length}件・出典${s.sources.length}件`);
    if (!factSheet.searchUsed) {
      factSheetNote = 'Google 検索が使われませんでした';
      factSheet = null;
    }
  } catch (error) {
    factSheetNote = errorMessage(error);
  }

  // 3. 企画（タイトル・構成案）
  const competitorTitles = research.competitors.map((c) => c.title).filter(Boolean);
  const title = await timer.time('タイトル', () => generateTitleWithAI(keyword, relatedKeywords, competitorTitles, aiConfig, competitorData), (t) => t);

  const researchInstructions = [
    research.searchIntent ? `検索意図: ${research.searchIntent}` : '',
    research.readerQuestions.length ? `読者の疑問（構成案でこれらに答える見出しを用意する）:\n- ${research.readerQuestions.join('\n- ')}` : '',
    research.gaps.length ? `上位記事に足りない点（差別化に使う）:\n- ${research.gaps.join('\n- ')}` : '',
  ].filter(Boolean).join('\n');
  const effectiveInstructions = compactAutoModeInstructions([
    relatedKeywords.length > 0 ? `Related keywords: ${relatedKeywords.join(', ')}` : undefined,
    buildAutoModeQualityInstructions({ selectedTitle: title, targetWordCount }),
  ]);
  const outline = await timer.time('構成案', async () => {
    const makeOutline = (extra?: string) =>
      generateOutlineWithAutoModeStyle({
        keyword,
        targetWordCount,
        fixedTitle: title,
        customInstructions: compactAutoModeInstructions([
          effectiveInstructions,
          researchInstructions,
          buildFactSheetOutlineInstructions(factSheet),
          extra,
        ]),
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
    sectionFactIds = await timer.time('根拠の割り当て（AI）', () => assignFactsToSections({ sheet: factSheet, sections, call: run.call }));
  }

  // 4. 執筆（H2 ごとに順番に）
  const generated = await timer.time('本文（H2 ごとに順番）', () =>
    generateSchedulerArticleSectioned({
      outline,
      keyword,
      keywords: sectionKeywords,
      tone: 'professional',
      targetWordCount,
      customInstructions: effectiveInstructions,
      aiConfig,
      factSheet,
      sectionFactIds,
      parallelism: 1,
    }), (g) => `${g.wordCount}文字`);
  let content = cleanupGenerated(generated.fullContent, title, targetWordCount);

  // 5. 見直し（省略しない）
  let editorialReview = '未実行';
  try {
    // 時間制限がないので、いつも批評→書き直しの 2 段階（段階 2）
    const decision = await timer.time('見直し（批評→書き直し）', () =>
      runEditorialReview({
        title,
        keyword,
        content,
        factSheet,
        toneInstruction: 'ビジネス読者向けの自然な です・ます調',
        call: run.call,
        critique: true,
      }), (d) => (d.accepted ? d.reason : `不採用（${d.reason}）`));
    if (decision.accepted) content = cleanupGenerated(decision.content, title, targetWordCount);
    editorialReview = formatReviewStatus(decision);
  } catch (error) {
    editorialReview = `失敗（${errorMessage(error)}）`;
  }

  // 6〜8. 検証（ChatGPT）→ 修正（Gemini）→ 再検証（ChatGPT）
  let results: FactCheckResult[] = [];
  let overall: { rating: string; summary: string } | undefined;
  let rounds = 0;
  let autoFixApplied = false;
  let factCheckNote = '';
  const verifier = openai ? `ChatGPT（${openai.model}・Web 検索）` : 'Gemini（OpenAI キーがないため代替）';
  try {
    if (openai) {
      const first = await timer.time('検証（ChatGPT）', () => verifyWithChatGpt(openai, { content, keyword, factSheet }),
        (v) => `${v.results.length}件確認・検索${v.webSearchCalls}回・総合評価 ${v.overall.rating}`);
      results = first.results;
      overall = first.overall;
    } else {
      const first = await timer.time('検証（Gemini で代替）', () =>
        runGeminiFactCheck({ content, keyword, factSheet, call: run.call, resolveUrls: run.resolveUrls, canSearch: () => true, concurrency: 2 }));
      results = first.results;
    }
    rounds = 1;

    for (let round = 1; round <= MAX_FIX_ROUNDS; round++) {
      if (countCriticalIssues(results) === 0 && countMinorIssues(results) === 0) break;
      const headingsBefore = countNonSummaryHeadings(content);
      const fix = await timer.time(`修正 ${round} 回目（Gemini）`, () => applyGeminiFactCheckFixes({ content, results, keyword, call: run.call }));
      if (!fix.content.trim()) break;
      const fixed = normalizeGeneratedContentForPublishing(fix.content, title);
      if (headingsBefore >= 2 && countNonSummaryHeadings(fixed) < Math.max(2, headingsBefore - 1)) {
        warnings.push('自動修正で見出しが減りすぎたため修正前の本文を使いました');
        break;
      }
      if (fixed === content) break;
      content = fixed;
      autoFixApplied = true;

      const onlyClaims = claimsForRecheck(results, content);
      const fixable = new Set(getFixableFactCheckIssues(results).map((r) => r.claim));
      const recheck = openai
        ? (await timer.time(`再検証 ${round} 回目（ChatGPT）`, () => verifyWithChatGpt(openai, { content, keyword, factSheet, onlyClaims }))).results
        : (await runGeminiFactCheck({ content, keyword, factSheet, call: run.call, resolveUrls: run.resolveUrls, canSearch: () => true, concurrency: 2, onlyClaims })).results;
      results = [...results.filter((r) => !fixable.has(r.claim)), ...recheck];
      rounds += 1;
    }

    const critical = countCriticalIssues(results);
    if (critical > 0) draftReasons.push(`重大な指摘が残っています（${critical}件）`);
    if (overall?.rating === 'reject') draftReasons.push('検証 AI の総合評価が「公開不可」でした（修正前の評価）');
  } catch (error) {
    factCheckNote = `失敗: ${errorMessage(error)}`;
    draftReasons.push(`検証に失敗しました: ${errorMessage(error).slice(0, 200)}`);
  }

  const finalized = finalizeArticle({ content, baseContent: generated.fullContent, title, targetWordCount, outline, factSheet });
  draftReasons.push(...finalized.draftReasons);
  warnings.push(...finalized.warnings);

  return {
    name: 'v2',
    label: '新しい流れ',
    keyword,
    title,
    content: finalized.content,
    outline,
    research,
    relatedKeywords,
    competitorHeadings,
    factSheet,
    factSheetNote: hasUsableFacts(factSheet) ? '' : factSheetNote || '事実が見つかりませんでした',
    editorialReview,
    factCheck: { verifier, executed: rounds > 0, results, rounds, autoFixApplied, overall, note: factCheckNote },
    writerModel: run.effectiveWriterModel,
    draftReasons,
    warnings,
    notes: run.notes,
    skippedSteps: run.skippedSteps,
    referencesCount: finalized.referencesCount,
    steps: timer.steps,
    totalMs: timer.totalMs,
    usage: { gemini: run.tracker.summarize(), openai: openai ? { ...openai.usage } : null, serpapiCalls: 0, customSearchCalls: 0 },
  };
}
