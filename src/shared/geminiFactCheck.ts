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

export const MAX_AI_EXTRACTED_CLAIMS = 20;
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
    '対象にしないもの: 意見・感想・一般的な助言、記事の構成の説明',
    `- 重要なものから最大${maxClaims}件`,
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
    '- supported: 根拠メモの事実と内容が一致する（数値・日付も一致）',
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

// 修正対象だった主張のうち、修正後の本文にまだ残っているもの・書き換わったものを再確認の対象にする
export function claimsForRecheck(before: FactCheckResult[], fixedContent: string): FactCheckItem[] {
  const paragraphs = fixedContent.split(/\n{2,}/);
  return getFixableFactCheckIssues(before).map((issue) => {
    const probe = issue.claim.slice(0, 12);
    const paragraph = paragraphs.find((p) => p.includes(probe));
    // 書き換えられて元の文が無い場合は、修正情報を含む段落を探す
    const correctedProbe = issue.correctInfo?.slice(0, 10) || '';
    const correctedParagraph = !paragraph && correctedProbe
      ? paragraphs.find((p) => p.includes(correctedProbe))
      : undefined;
    const context = paragraph || correctedParagraph || '';
    const sentence = context
      .split(/(?<=[。！？])/)
      .find((s) => (probe && s.includes(probe)) || (correctedProbe && s.includes(correctedProbe)));
    return {
      claim: (sentence || issue.claim).trim(),
      context: (context || issue.claim).slice(0, 400),
      priority: 'high' as const,
    };
  });
}
