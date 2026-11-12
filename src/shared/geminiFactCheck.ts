// Gemini によるファクトチェック（Perplexity の代わり）
// 1. AI が確認の必要な主張を抜き出す
// 2. 根拠メモと照合する（検索なし）
// 3. 根拠メモで確認できなかった主張だけ Google 検索で確認する
// 4. 自動修正 → 修正した主張だけ再確認する
import {
  applyFallbackFactCheckFixes,
  buildFactCheckCorrectionPrompt,
  cleanFactCheckModelText,
  extractFactsFromContent,
  getFixableFactCheckIssues,
  normalizeFactCheckConfidence,
  parseFactCheckBatchResults,
  type FactCheckItem,
  type FactCheckResult,
} from './factCheckCore.ts';
import { formatFactLines, hasUsableFacts, type FactSheet } from './factSheetCore.ts';
import {
  extractJsonValue,
  isGroundingRedirectUrl,
  mapWithConcurrency,
  type GeminiCaller,
  type ParsedGeminiResponse,
  type UrlResolver,
} from './geminiCore.ts';

// 数字の入った文に加えて、条件・可否・結果を述べる文も確かめるため 25 件まで
export const MAX_AI_EXTRACTED_CLAIMS = 25;
export const GROUNDED_VERIFY_BATCH_SIZE = 5;
export const CRITICAL_CONFIDENCE_THRESHOLD = 70;
export const UNVERIFIED_WARNING_THRESHOLD = 5;

// --- 判定の集計 ---

export function countCriticalIssues(results: FactCheckResult[]): number {
  return results.filter((r) => r.verdict === 'incorrect' && r.confidence >= CRITICAL_CONFIDENCE_THRESHOLD).length;
}

export function countMinorIssues(results: FactCheckResult[]): number {
  return results.filter((r) =>
    r.verdict === 'partially_correct' ||
    (r.verdict === 'incorrect' && r.confidence < CRITICAL_CONFIDENCE_THRESHOLD)).length;
}

export function countUnverified(results: FactCheckResult[]): number {
  return results.filter((r) => r.verdict === 'unverified').length;
}

// 自動修正で直しきれなかったときに本文へ挿入される文言
export function hasCorrectionArtifacts(content: string): boolean {
  return /（修正:\s|【AI修正サマリー】/.test(String(content || ''));
}

// --- 1. 主張の抽出 ---

export function buildClaimExtractionPrompt(content: string, maxClaims = MAX_AI_EXTRACTED_CLAIMS): string {
  return [
    '次の日本語記事から、事実確認が必要な主張を抜き出してください。',
    '',
    '対象にするもの: 数値・金額・割合、日付・期限、制度・法令・手続きの内容、固有名詞（団体名・商品名・人名）に関する説明、比較や順位（最大・最安など）',
    // 2026-11-12: 「期限を過ぎると特例は使えなくなる」（誤り）が数字を含まないため抜き出されず、見逃された
    '数字がなくても必ず対象にするもの: 制度の条件・要件（「〜が要件」「〜の場合に限り」）、できる・できないの説明（「〜は使えない」「〜は認められない」）、「〜すると〜になる」という結果や不利益、「原則として」「必ず」「一律」などの言い切り、例外の説明',
    '対象にしないもの: 意見・感想・一般的な助言、記事の構成の説明',
    `- 重要なものから最大${maxClaims}件。間違っていたら読者が損をする主張（期限・罰則・特例が使えるかどうか・手続きの可否）を優先する`,
    '- 同じ内容を言い換えた文は1件にまとめる',
    '- claim には記事中の文をそのまま（1文）入れる',
    '- type は「数値」「日付」「制度」「固有名詞」「比較」のどれか',
    '',
    '次の形式の JSON だけを返してください:',
    '{"claims":[{"claim":"記事中の文","type":"数値"}]}',
    '',
    '【記事】',
    content,
  ].join('\n');
}

export function parseClaimExtraction(text: string, content: string): FactCheckItem[] {
  const parsed = extractJsonValue(text) as any;
  const list: any[] = Array.isArray(parsed?.claims) ? parsed.claims : Array.isArray(parsed) ? parsed : [];
  const paragraphs = String(content || '').split(/\n{2,}/);
  const items: FactCheckItem[] = [];
  const seen = new Set<string>();

  for (const entry of list) {
    const claim = String(entry?.claim ?? '').replace(/\s+/g, ' ').trim();
    if (claim.length < 8 || seen.has(claim)) continue;
    seen.add(claim);
    const type = String(entry?.type ?? '');
    const probe = claim.slice(0, 20);
    const context = paragraphs.find((p) => p.includes(probe)) || claim;
    items.push({
      claim,
      context: context.slice(0, 400),
      priority: /数値|日付|制度/.test(type) ? 'high' : 'normal',
    });
    if (items.length >= MAX_AI_EXTRACTED_CLAIMS) break;
  }
  return items;
}

// [[ ]] で手動指定した主張を先頭に、AI 抽出分と重複しないように並べる
export function mergeUserMarkedClaims(aiItems: FactCheckItem[], userMarkedText?: string | null): FactCheckItem[] {
  if (!userMarkedText || !/\[\[.+?\]\]/.test(userMarkedText)) return aiItems;
  const marked = extractFactsFromContent('', userMarkedText).filter((item) => item.priority === 'high');
  const markedClaims = new Set(marked.map((m) => m.claim));
  return [...marked, ...aiItems.filter((item) => !markedClaims.has(item.claim))];
}

export async function extractClaimsWithAI(params: {
  content: string;
  userMarkedText?: string | null;
  call: GeminiCaller;
}): Promise<{ items: FactCheckItem[]; usedFallback: boolean }> {
  try {
    const response = await params.call(buildClaimExtractionPrompt(params.content), {
      role: 'base',
      jsonOutput: true,
      maxOutputTokens: 4096,
      temperature: 0.1,
      thinkingBudget: 0,
    });
    const items = parseClaimExtraction(response.text, params.content);
    if (items.length > 0) {
      return { items: mergeUserMarkedClaims(items, params.userMarkedText), usedFallback: false };
    }
  } catch (error) {
    console.warn('AI claim extraction failed; falling back to rule-based extraction:', error);
  }
  // 失敗時は従来の機械的な抽出
  const fallback = extractFactsFromContent(params.content, params.userMarkedText || undefined).slice(0, MAX_AI_EXTRACTED_CLAIMS);
  return { items: fallback, usedFallback: true };
}

// --- 2. 根拠メモとの照合 ---

export function buildFactSheetComparisonPrompt(items: FactCheckItem[], sheet: FactSheet): string {
  return [
    '次の「主張」を「根拠メモ」と照らし合わせてください。検索はしないでください。',
    '',
    'status の決め方:',
    '- supported: 根拠メモの事実と内容が一致する（数値・日付も一致）。主張に、根拠メモにない条件・範囲（「期限内に」「原則として」「一律」など）や結果（「〜できなくなる」など）が付け足されているときは supported にせず not_found にする',
    '- contradicted: 根拠メモの事実と食い違う（数値・日付・制度の内容が違う）',
    '- not_found: 根拠メモに関係する事実がない',
    '',
    '【根拠メモ】',
    formatFactLines(sheet),
    '',
    '【主張】',
    items.map((item, i) => `${i + 1}. ${item.claim}`).join('\n'),
    '',
    '次の形式の JSON だけを返してください:',
    '{"results":[{"claim_number":1,"status":"supported","fact_ids":["F2"],"correct_info":"食い違う場合の正しい内容","explanation":"理由"}]}',
  ].join('\n');
}

interface ComparisonOutcome {
  resolved: FactCheckResult[];
  needsSearch: Array<{ item: FactCheckItem; hint?: string; factIds: string[] }>;
}

export function parseFactSheetComparison(
  items: FactCheckItem[],
  text: string,
  sheet: FactSheet,
): ComparisonOutcome {
  const parsed = extractJsonValue(text) as any;
  const list: any[] = Array.isArray(parsed?.results) ? parsed.results : Array.isArray(parsed) ? parsed : [];
  const outcome: ComparisonOutcome = { resolved: [], needsSearch: [] };
  const factById = new Map(sheet.facts.map((f) => [f.id, f]));
  const sourceById = new Map(sheet.sources.map((s) => [s.id, s]));

  items.forEach((item, index) => {
    const entry = list.find((r) => Number(r?.claim_number) === index + 1);
    const status = String(entry?.status || 'not_found');
    const factIds: string[] = Array.isArray(entry?.fact_ids)
      ? entry.fact_ids.map((id: unknown) => String(id || '').toUpperCase()).filter((id: string) => factById.has(id))
      : [];

    if (status === 'supported' && factIds.length > 0) {
      const sourceUrl = factIds
        .flatMap((id) => factById.get(id)?.sourceIds || [])
        .map((id) => sourceById.get(id)?.url || '')
        .find((url) => url) || '';
      outcome.resolved.push({
        claim: item.claim,
        verdict: 'correct',
        confidence: 85,
        sourceUrl,
        explanation: `根拠メモ（${factIds.join(', ')}）と一致しました。${String(entry?.explanation || '')}`.trim(),
      });
      return;
    }
    outcome.needsSearch.push({
      item,
      hint: status === 'contradicted' ? String(entry?.correct_info || '') : undefined,
      factIds,
    });
  });
  return outcome;
}

// 検索での確認を省略した主張の扱い（矛盾は誤りの疑い、それ以外は未確認）
export function resultsForUnsearchedClaims(pending: ComparisonOutcome['needsSearch']): FactCheckResult[] {
  return pending.map(({ item, hint }) => (hint
    ? {
      claim: item.claim,
      verdict: 'incorrect' as const,
      confidence: 60,
      correctInfo: hint,
      sourceUrl: '',
      explanation: '根拠メモと食い違っています（検索での確認は省略しました）。',
    }
    : {
      claim: item.claim,
      verdict: 'unverified' as const,
      confidence: 0,
      sourceUrl: '',
      explanation: '根拠メモに該当がなく、検索での確認も省略しました。',
    }));
}

// --- 3. 検索での確認 ---

const hostnameOf = (url: string): string => {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
};

// モデルが返す source_url は作り話のことがあるため、検索結果の出典と照らして採用する
function pickSourceUrl(modelUrl: string, response: ParsedGeminiResponse, resolved: Record<string, string>): string {
  const groundingUrls = response.sources
    .map((s) => (isGroundingRedirectUrl(s.uri) ? resolved[s.uri] || '' : s.uri))
    .filter(Boolean);
  const groundingHosts = new Set([
    ...groundingUrls.map(hostnameOf),
    ...response.sources.map((s) => s.title.replace(/^www\./, '').toLowerCase()),
  ].filter(Boolean));
  const modelHost = hostnameOf(modelUrl);
  if (modelHost && groundingHosts.has(modelHost)) return modelUrl;
  return groundingUrls[0] || '';
}

export class SearchNotUsedError extends Error {
  constructor() {
    super('Google 検索が使われませんでした');
    this.name = 'SearchNotUsedError';
  }
}

// 「JSON だけを返す」と指示すると Gemini が検索せずに記憶だけで答えるため、行形式で書かせる
export function buildGroundedVerifyPrompt(batch: FactCheckItem[], keyword: string, hintText = ''): string {
  const claimsList = batch
    .map((item, idx) => `${idx + 1}. 主張: ${item.claim}\n   文脈: ${item.context}`)
    .join('\n\n');
  return [
    '次の主張を Google 検索で調べ、最新の公開情報で検証してください。',
    '',
    '【チェック対象】',
    claimsList,
    '',
    `【関連キーワード】${keyword}`,
    hintText ? `\n${hintText}` : '',
    '',
    '判定ルール: 金額や数値が欠落している表現（例: いくらか,000円 / ,000円）は incorrect にする。',
    '判定ルール: 主張の一部でも重大な数値誤り・相場誤りがあれば partially_correct ではなく incorrect にする。',
    '判定ルール: 検索しても信頼できる情報で確認できない場合は unverified にする。',
    // 2026-11-11 の記事で、無申告加算税の軽い区分だけを書いた説明が見逃されたため
    '判定ルール: 税率・料金・罰則・条件などで、一部の区分だけを書いて基本の区分やより重い区分を省き、読者が実際より軽く・狭く受け取る書き方は partially_correct にし、「正しい情報」に省かれた区分を書く。',
    '判定ルール: 古い年度の数字を最新のように書いている場合は partially_correct にし、「正しい情報」に最新の数字と年度を書く。',
    '',
    '主張ごとに、次の形式で書いてください（JSON やコードフェンスは使わない）。',
    '### 1',
    '判定: correct / incorrect / partially_correct / unverified のどれか 1 つ',
    '確信度: 0〜100 の整数',
    '正しい情報: 誤り・一部誤りのときの正しい内容（なければ空）',
    '理由: 判定理由を 1〜2 文',
    '出典: 確認に使ったページの URL',
  ].filter((line) => line !== '').join('\n');
}

const VERDICT_PATTERNS: Array<[RegExp, FactCheckResult['verdict']]> = [
  [/partially[_\s-]?correct|一部/i, 'partially_correct'],
  [/incorrect|誤り/i, 'incorrect'],
  [/unverified|確認でき/i, 'unverified'],
  [/correct|正しい/i, 'correct'],
];

// 行形式（### 番号 ＋「項目: 値」）の検証結果を読む。読めなければ JSON として読む（以前の形式）
export function parseGroundedVerifyResults(batch: FactCheckItem[], text: string): FactCheckResult[] {
  const blocks = new Map<number, string>();
  const parts = String(text || '').split(/^#{2,4}\s*(\d+)\s*[.．)]?\s*$/m);
  for (let i = 1; i + 1 < parts.length; i += 2) {
    blocks.set(Number(parts[i]), parts[i + 1]);
  }
  if (blocks.size === 0) return parseFactCheckBatchResults(batch, text);

  const field = (block: string, label: string): string => {
    // 値が空の行で次の行を拾わないよう、行内の空白だけを読み飛ばす
    const match = block.match(new RegExp(`^[ \\t]*[-*]?[ \\t]*\\**${label}\\**[ \\t]*[:：][ \\t]*(.*)$`, 'm'));
    return match ? match[1].replace(/\*\*/g, '').trim() : '';
  };

  return batch.map((item, idx) => {
    const block = blocks.get(idx + 1);
    if (!block) {
      return { claim: item.claim, verdict: 'unverified' as const, confidence: 0, sourceUrl: '', explanation: '検証結果が返されませんでした' };
    }
    const verdictText = field(block, '判定');
    const verdict = VERDICT_PATTERNS.find(([pattern]) => pattern.test(verdictText))?.[1] ?? 'unverified';
    const correctInfo = field(block, '正しい情報');
    const sourceUrl = field(block, '出典').match(/https?:\/\/[^\s)）>」]+/)?.[0] ?? '';
    return {
      claim: item.claim,
      verdict,
      confidence: Number(field(block, '確信度').match(/\d+/)?.[0] ?? 0),
      ...(correctInfo && !/^(なし|空|-|—|n\/a)$/i.test(correctInfo) ? { correctInfo } : {}),
      sourceUrl,
      explanation: field(block, '理由'),
    };
  });
}

async function verifyBatchWithSearch(params: {
  batch: FactCheckItem[];
  hints: Array<string | undefined>;
  keyword: string;
  call: GeminiCaller;
  resolveUrls?: UrlResolver;
}): Promise<{ results: FactCheckResult[]; grounded: boolean }> {
  const hintText = params.hints
    .map((hint, i) => (hint ? `${i + 1}番の参考: 根拠メモでは「${hint}」となっています。` : ''))
    .filter(Boolean)
    .join('\n');
  const prompt = buildGroundedVerifyPrompt(params.batch, params.keyword, hintText);
  const callOnce = () =>
    params.call(prompt, {
      role: 'base',
      useSearch: true,
      maxOutputTokens: 4096,
      temperature: 0.1,
      thinkingBudget: 0,
    });

  let response = await callOnce();
  // 検索せずに答えた場合は 1 回だけやり直す。それでも検索しなければ「検索で確認した」とは扱わない
  if (!response.grounded) response = await callOnce();
  if (!response.grounded) throw new SearchNotUsedError();

  let resolved: Record<string, string> = {};
  const redirectUrls = response.sources.map((s) => s.uri).filter(isGroundingRedirectUrl);
  if (params.resolveUrls && redirectUrls.length > 0) {
    try {
      resolved = await params.resolveUrls(redirectUrls);
    } catch {
      resolved = {};
    }
  }

  const results = parseGroundedVerifyResults(params.batch, response.text).map((result) => ({
    ...result,
    confidence: normalizeFactCheckConfidence(result.confidence),
    sourceUrl: pickSourceUrl(result.sourceUrl, response, resolved),
  }));
  return { results, grounded: response.grounded };
}

// --- 全体の流れ ---

export interface GeminiFactCheckRun {
  results: FactCheckResult[];
  itemsChecked: number;
  searchedClaims: number;
  skippedSearchClaims: number;
  usedRuleBasedExtraction: boolean;
  searchUsed: boolean;
}

export async function runGeminiFactCheck(params: {
  content: string;
  keyword: string;
  userMarkedText?: string | null;
  factSheet?: FactSheet | null;
  call: GeminiCaller;
  resolveUrls?: UrlResolver;
  // false を返したら検索での確認を打ち切る（自動投稿の時間管理用）
  canSearch?: () => boolean;
  concurrency?: number;
  // 指定した主張だけを確認する（自動修正後の再確認用）
  onlyClaims?: FactCheckItem[];
  onProgress?: (progress: { total: number; processed: number }) => void;
}): Promise<GeminiFactCheckRun> {
  let usedRuleBasedExtraction = false;
  let items: FactCheckItem[];
  if (params.onlyClaims) {
    items = params.onlyClaims;
  } else {
    const extracted = await extractClaimsWithAI({
      content: params.content,
      userMarkedText: params.userMarkedText,
      call: params.call,
    });
    items = extracted.items;
    usedRuleBasedExtraction = extracted.usedFallback;
  }

  const run: GeminiFactCheckRun = {
    results: [],
    itemsChecked: items.length,
    searchedClaims: 0,
    skippedSearchClaims: 0,
    usedRuleBasedExtraction,
    searchUsed: false,
  };
  if (items.length === 0) return run;
  params.onProgress?.({ total: items.length, processed: 0 });

  // 2. 根拠メモとの照合
  let pending: ComparisonOutcome['needsSearch'] = items.map((item) => ({ item, factIds: [] }));
  // 検索で作られた根拠メモだけを照合に使う（AI の知識だけのメモで「正しい」と判定しないため）
  if (hasUsableFacts(params.factSheet) && params.factSheet.searchUsed) {
    try {
      const response = await params.call(buildFactSheetComparisonPrompt(items, params.factSheet), {
        role: 'base',
        jsonOutput: true,
        maxOutputTokens: 4096,
        temperature: 0.1,
        thinkingBudget: 0,
      });
      const outcome = parseFactSheetComparison(items, response.text, params.factSheet);
      run.results.push(...outcome.resolved);
      pending = outcome.needsSearch;
    } catch (error) {
      console.warn('Fact sheet comparison failed; verifying all claims with search:', error);
    }
  }
  params.onProgress?.({ total: items.length, processed: run.results.length });

  // 3. 検索での確認
  const batches: Array<typeof pending> = [];
  for (let i = 0; i < pending.length; i += GROUNDED_VERIFY_BATCH_SIZE) {
    batches.push(pending.slice(i, i + GROUNDED_VERIFY_BATCH_SIZE));
  }
  const unsearched: typeof pending = [];

  await mapWithConcurrency(batches, Math.max(1, params.concurrency ?? 1), async (batch) => {
    if (params.canSearch && !params.canSearch()) {
      unsearched.push(...batch);
      return;
    }
    try {
      const { results, grounded } = await verifyBatchWithSearch({
        batch: batch.map((b) => b.item),
        hints: batch.map((b) => b.hint),
        keyword: params.keyword,
        call: params.call,
        resolveUrls: params.resolveUrls,
      });
      run.results.push(...results);
      run.searchedClaims += batch.length;
      run.searchUsed = run.searchUsed || grounded;
    } catch (error) {
      console.warn('Grounded fact verification failed for a batch:', error);
      unsearched.push(...batch);
    }
    params.onProgress?.({ total: items.length, processed: run.results.length });
  });

  if (unsearched.length > 0) {
    run.skippedSearchClaims = unsearched.length;
    run.results.push(...resultsForUnsearchedClaims(unsearched));
  }

  // 記事内の順番に並べ直す
  const order = new Map(items.map((item, i) => [item.claim, i]));
  run.results.sort((a, b) => (order.get(a.claim) ?? 0) - (order.get(b.claim) ?? 0));
  params.onProgress?.({ total: items.length, processed: items.length });
  return run;
}

// --- 4. 自動修正 ---

export async function applyGeminiFactCheckFixes(params: {
  content: string;
  results: FactCheckResult[];
  keyword: string;
  call: GeminiCaller;
}): Promise<{ content: string; usedFallback: boolean }> {
  const issues = getFixableFactCheckIssues(params.results);
  const prompt = buildFactCheckCorrectionPrompt(params.content, params.results, params.keyword);
  if (!prompt || issues.length === 0) return { content: params.content, usedFallback: false };

  try {
    const maxOutputTokens = Math.min(16000, Math.max(4096, Math.ceil(params.content.length * 2.2)));
    const response = await params.call(prompt, {
      role: 'base',
      maxOutputTokens,
      temperature: 0.2,
      thinkingBudget: 0,
    });
    const cleaned = cleanFactCheckModelText(response.text);
    if (cleaned && response.finishReason !== 'MAX_TOKENS') {
      return { content: cleaned, usedFallback: false };
    }
  } catch (error) {
    console.error('Gemini fact-check auto-fix failed:', error);
  }
  return { content: applyFallbackFactCheckFixes(params.content, issues), usedFallback: true };
}

// --- 4b. 直す文だけを返させる修正（ChatGPT・Claude 向け。仕様書 4.3） ---
// 記事全体を書き直させると時間がかかり、直す必要のない所まで変わるため、
// 「元の文 → 直した文」の組だけを返させてプログラムで置き換える

export interface FactCheckPatch {
  // 何番の指摘を直す組か（1 から）
  issue: number;
  before: string;
  after: string;
}

const MIN_PATCH_BEFORE_CHARS = 6;

// withSearch: 直す前に Web 検索で正しい内容を確かめさせる（ChatGPT・Claude）。
// 2026-11-12 検索なしで直させたら、ChatGPT が記憶違いで正しい税率を誤った税率に変えた
export function buildFactCheckPatchPrompt(content: string, issues: FactCheckResult[], keyword: string, withSearch = false): string {
  const issuesText = issues
    .map((result, idx) => {
      const evidence = result.correctInfo ? `\n- 正しい情報: ${result.correctInfo}` : '';
      const source = result.sourceUrl ? `\n- 出典: ${result.sourceUrl}` : '';
      return `${idx + 1}. 主張: ${result.claim}\n- 判定: ${result.verdict}（確信度 ${normalizeFactCheckConfidence(result.confidence)}%）\n- 理由: ${result.explanation}${evidence}${source}`;
    })
    .join('\n\n');
  return [
    '次の記事で、ファクトチェックで指摘された誤りを直します。記事全体は書き直さず、直す文だけを返してください。',
    '',
    ...(withSearch
      ? [
        '【直す前に】',
        '- 指摘ごとに、公式情報（国税庁・法令・省庁・自治体など）を Web 検索で確かめてから直してください。記憶だけで数字や条件を書かないでください。',
        '- 指摘の「理由」や「正しい情報」が間違っていることもあります。検索した結果、元の文が正しいと確かめられたら、その指摘は直さずに {"issue":番号,"keep":true,"reason":"確かめた内容と出典"} を返してください。',
        '',
      ]
      : []),
    '【返し方】',
    'JSON だけを返してください。形式: {"fixes":[{"issue":指摘の番号,"before":"元の文","after":"直した文"}]}',
    '- 「〜場合があります」「〜ことがあります」とぼかして逃げず、確かめた正しい内容をはっきり書いてください。条件によって変わるなら、その条件を書いてください。',
    '- 計算例を直すときは、計算をやり直して、式と答えが合っていることを確かめてください。',
    '- before は、記事本文から 1 文字も変えずにそのまま写してください（空白・記号・** なども含めて同じに）。1 文、または表の 1 行を単位にします。',
    '- after は、before を直した文です。誤りの部分だけを最小限に直し、文体・言い回し・Markdown の書式はそのまま保ってください。',
    '- 同じ誤りが、指摘された文の前後・別の段落（まとめなど）・表にもあれば、その文も別の組として返してください（issue は同じ番号）。',
    '- 誤った前提に立った説明（「だから〜しないと損をする」など）も合わせて直してください。',
    '- 確かめられなかった主張（unverified）は、断定をやめるか、具体的な数字を外すなど、言い過ぎない書き方にしてください。',
    '- 「（修正: …）」のような注記や、直したことの説明は本文に入れないでください。',
    '- 見出し（# で始まる行）は、見出しそのものが誤っているときだけ直してください。',
    withSearch
      ? '- どの指摘にも、少なくとも 1 つの組か、直さない理由（keep）を返してください。'
      : '- どの指摘にも、少なくとも 1 つの組を返してください。',
    '',
    `【キーワード】${keyword}`,
    '',
    '【指摘】',
    issuesText,
    '',
    '【記事本文】',
    content,
  ].join('\n');
}

// 検索で確かめた結果、元の文が正しかったので直さなかった指摘（番号と理由）
export function parseFactCheckKeeps(text: string, issueCount: number): Array<{ issue: number; reason: string }> {
  const value = extractJsonValue(text) as any;
  const list = Array.isArray(value) ? value : Array.isArray(value?.fixes) ? value.fixes : [];
  return list
    .filter((raw: any) => raw?.keep === true)
    .map((raw: any) => ({ issue: Number(raw?.issue), reason: String(raw?.reason || '').slice(0, 300) }))
    .filter((k: { issue: number }) => Number.isInteger(k.issue) && k.issue >= 1 && k.issue <= issueCount);
}

export function parseFactCheckPatches(text: string, issueCount: number): FactCheckPatch[] {
  const value = extractJsonValue(text) as any;
  const list = Array.isArray(value) ? value : Array.isArray(value?.fixes) ? value.fixes : [];
  const patches: FactCheckPatch[] = [];
  for (const raw of list) {
    const issue = Number(raw?.issue);
    const before = String(raw?.before ?? '');
    const after = String(raw?.after ?? '');
    if (!Number.isInteger(issue) || issue < 1 || issue > issueCount) continue;
    if (before.trim().length < MIN_PATCH_BEFORE_CHARS || before === after) continue;
    if (hasCorrectionArtifacts(after)) continue;
    patches.push({ issue, before, after });
  }
  return patches;
}

// 元の文を本文から探す。そのままで見つからなければ、前後の空白と行頭の箇条書き記号を外して探す
function locatePatchBefore(content: string, before: string): string | null {
  if (content.includes(before)) return before;
  const trimmed = before.trim().replace(/^(?:[-*+]|\d+[.)])\s+/, '');
  if (trimmed.length >= MIN_PATCH_BEFORE_CHARS && content.includes(trimmed)) return trimmed;
  return null;
}

export function applyFactCheckPatches(content: string, patches: FactCheckPatch[]): {
  content: string;
  applied: FactCheckPatch[];
  failed: FactCheckPatch[];
} {
  let next = content;
  const applied: FactCheckPatch[] = [];
  const failed: FactCheckPatch[] = [];
  for (const patch of patches) {
    const found = locatePatchBefore(next, patch.before);
    if (!found) {
      failed.push(patch);
      continue;
    }
    const after = found === patch.before ? patch.after : patch.after.trim().replace(/^(?:[-*+]|\d+[.)])\s+/, '');
    next = next.split(found).join(after);
    applied.push(patch);
  }
  return { content: next, applied, failed };
}

export async function fixFactCheckIssuesWithPatches(params: {
  content: string;
  results: FactCheckResult[];
  keyword: string;
  // 直す文の組を作る AI（AI 設定の「ファクトチェック・修正」）
  call: GeminiCaller;
  // 組で直せなかった指摘を、記事全体の書き直しで直す AI（Gemini）
  rewriteCall: GeminiCaller;
  // 直す前に Web 検索で確かめさせる
  useSearch?: boolean;
}): Promise<{
  content: string;
  applied: FactCheckPatch[];
  kept: Array<{ claim: string; reason: string }>;
  rewrittenIssues: number;
  usedFallback: boolean;
  searchUsed: boolean;
}> {
  const issues = getFixableFactCheckIssues(params.results).slice(0, 20);
  if (issues.length === 0) {
    return { content: params.content, applied: [], kept: [], rewrittenIssues: 0, usedFallback: false, searchUsed: false };
  }

  let patches: FactCheckPatch[] = [];
  let keeps: Array<{ issue: number; reason: string }> = [];
  let searchUsed = false;
  try {
    const response = await params.call(buildFactCheckPatchPrompt(params.content, issues, params.keyword, Boolean(params.useSearch)), {
      role: 'base',
      useSearch: Boolean(params.useSearch),
      maxOutputTokens: 6000,
      temperature: 0.2,
      thinkingBudget: 0,
    });
    searchUsed = response.grounded;
    if (response.finishReason !== 'MAX_TOKENS') {
      patches = parseFactCheckPatches(response.text, issues.length);
      // 検索で確かめていないのに「直さない」とした指摘は認めない（直す側に回す）
      keeps = searchUsed ? parseFactCheckKeeps(response.text, issues.length) : [];
    }
  } catch (error) {
    console.error('Fact-check patch generation failed:', error);
  }

  const patched = applyFactCheckPatches(params.content, patches);
  const fixedIssues = new Set(patched.applied.map((p) => p.issue));
  const keptIssues = new Set(keeps.filter((k) => !fixedIssues.has(k.issue)).map((k) => k.issue));
  const kept = [...keptIssues].map((n) => ({ claim: issues[n - 1].claim, reason: keeps.find((k) => k.issue === n)?.reason || '' }));
  const remaining = issues.filter((_, idx) => !fixedIssues.has(idx + 1) && !keptIssues.has(idx + 1));
  if (remaining.length === 0) {
    return { content: patched.content, applied: patched.applied, kept, rewrittenIssues: 0, usedFallback: false, searchUsed };
  }
  // 組で直せなかった指摘だけ、今までの書き直し方式で直す
  const rewritten = await applyGeminiFactCheckFixes({
    content: patched.content,
    results: remaining,
    keyword: params.keyword,
    call: params.rewriteCall,
  });
  return {
    content: rewritten.content,
    applied: patched.applied,
    kept,
    rewrittenIssues: remaining.length,
    usedFallback: rewritten.usedFallback,
    searchUsed,
  };
}

// 直す文の組で書き換えた文そのものも確かめ直す。
// 2026-11-12 ChatGPT が正しい税率（15%・20%・30%）を誤った税率に「直し」、計算も間違えたのに、
// 元の主張に似た文だけを確かめ直していたため見逃した
export function claimsFromPatches(afters: string[], fixedContent: string): FactCheckItem[] {
  const paragraphs = fixedContent.split(/\n{2,}/);
  const items: FactCheckItem[] = [];
  for (const after of afters) {
    const text = after.trim();
    if (text.length < 8) continue;
    const paragraph = paragraphs.find((p) => p.includes(text));
    // あとの回でさらに書き換えられて本文に無い文は、確かめなくてよい
    if (!paragraph) continue;
    items.push({ claim: text, context: paragraph.slice(0, 400), priority: 'high' });
  }
  return items;
}

export function mergeRecheckClaims(...groups: FactCheckItem[][]): FactCheckItem[] {
  const seen = new Set<string>();
  const merged: FactCheckItem[] = [];
  for (const item of groups.flat()) {
    const key = item.claim.replace(/\s+/g, '');
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push(item);
  }
  return merged.slice(0, MAX_AI_EXTRACTED_CLAIMS);
}

// 修正対象だった主張のうち、修正後の本文にまだ残っているもの・書き換わったものを再確認の対象にする
// 2 文字ずつの組の重なり（0〜1）。書き換えられた文を探すのに使う
function bigramSimilarity(a: string, b: string): number {
  const grams = (text: string) => {
    const compact = text.replace(/\s+/g, '');
    const set = new Set<string>();
    for (let i = 0; i < compact.length - 1; i++) set.add(compact.slice(i, i + 2));
    return set;
  };
  const ga = grams(a);
  const gb = grams(b);
  if (ga.size === 0 || gb.size === 0) return 0;
  let common = 0;
  for (const g of ga) if (gb.has(g)) common++;
  return common / Math.min(ga.size, gb.size);
}

// 書き換え後の文がこれより似ていなければ、元の文は消されたとみなす
const RECHECK_MIN_SIMILARITY = 0.35;

export function claimsForRecheck(before: FactCheckResult[], fixedContent: string): FactCheckItem[] {
  const paragraphs = fixedContent.split(/\n{2,}/);
  const sentences = paragraphs.flatMap((p) =>
    p.split(/(?<=[。！？])/).map((s) => ({ sentence: s.trim(), paragraph: p })).filter((x) => x.sentence.length >= 8)
  );
  const items: FactCheckItem[] = [];
  for (const issue of getFixableFactCheckIssues(before)) {
    const probe = issue.claim.slice(0, 12);
    const exact = sentences.find((x) => probe && x.sentence.includes(probe));
    // 書き換えられて元の文が無い場合は、いちばん似ている文を確かめ直す。
    // 元の文をそのまま確かめ直すと、直したのに「誤り」と判定され続けるため（2026-11-12）
    let match = exact;
    if (!match) {
      let best: { sentence: string; paragraph: string; score: number } | null = null;
      for (const x of sentences) {
        const score = Math.max(bigramSimilarity(issue.claim, x.sentence), issue.correctInfo ? bigramSimilarity(issue.correctInfo, x.sentence) : 0);
        if (!best || score > best.score) best = { ...x, score };
      }
      match = best && best.score >= RECHECK_MIN_SIMILARITY ? best : undefined;
    }
    // 似た文もなければ、誤りの文は消されたので確かめ直さない（解消済み）
    if (!match) continue;
    items.push({ claim: match.sentence, context: match.paragraph.slice(0, 400), priority: 'high' });
  }
  return items;
}
