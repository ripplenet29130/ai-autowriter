// 根拠メモ（記事に使ってよい事実と出典の一覧）の作成・整形・参考資料の組み立て
// 自動投稿（scheduler-executor）と手動生成（ブラウザ）で共用する。
import {
  extractJsonValue,
  isGroundingRedirectUrl,
  type GeminiCaller,
  type ParsedGeminiResponse,
  type UrlResolver,
} from './geminiCore.ts';

export interface FactSheetSource {
  id: number;
  title: string;
  // 元のページの URL。取得できなかった場合は空文字（参考資料には使わない）
  url: string;
  redirectUrl?: string;
}

export interface FactSheetFact {
  id: string; // F1, F2, ...
  statement: string;
  asOf: string;
  sourceIds: number[];
}

export interface FactSheet {
  facts: FactSheetFact[];
  sources: FactSheetSource[];
  cautions: string[];
  searchQueries: string[];
  // Google 検索が実際に使われたか（使われていなければ AI の知識だけで作ったメモ）
  searchUsed: boolean;
  warnings: string[];
  createdAt: string;
}

export const MAX_FACT_SHEET_FACTS = 25;
export const REFERENCES_HEADING = '参考資料';

export function createEmptyFactSheet(): FactSheet {
  return {
    facts: [],
    sources: [],
    cautions: [],
    searchQueries: [],
    searchUsed: false,
    warnings: [],
    createdAt: new Date().toISOString(),
  };
}

export function hasUsableFacts(sheet: FactSheet | null | undefined): sheet is FactSheet {
  return Boolean(sheet && sheet.facts.length > 0);
}

const formatJapaneseDate = (date: Date): string =>
  `${date.getFullYear()}年${date.getMonth() + 1}月${date.getDate()}日`;

const normalizeForMatch = (text: string): string =>
  String(text || '')
    .replace(/\\n/g, '')
    .replace(/["'{}[\]:,\s]/g, '')
    .replace(/statement|as_of|facts|cautions/g, '')
    .toLowerCase();

export type FactSheetFocus = 'basic' | 'latest';

export function buildFactSheetPrompt(params: {
  keyword: string;
  title?: string | null;
  relatedKeywords?: string[];
  competitorHeadings?: string[];
  focus: FactSheetFocus;
  today?: Date;
  maxFacts?: number;
}): string {
  const maxFacts = params.maxFacts ?? (params.focus === 'basic' ? 18 : 10);
  const focusText = params.focus === 'basic'
    ? '定義・仕組み・手順・費用や数値の目安・関係する制度や法令・注意点'
    : '直近1〜2年の制度改定・最新の料金や価格・最新の統計値・今後予定されている変更';

  return [
    'あなたは記事執筆の下調べ担当です。Google 検索で調べ、次のテーマについて記事に使える事実を集めてください。',
    '',
    `テーマ（キーワード）: ${params.keyword}`,
    params.title ? `記事タイトル: ${params.title}` : '',
    params.relatedKeywords?.length ? `関連キーワード: ${params.relatedKeywords.slice(0, 8).join('、')}` : '',
    params.competitorHeadings?.length
      ? `上位記事の主な見出し（参考）:\n${params.competitorHeadings.slice(0, 12).map((h) => `- ${h}`).join('\n')}`
      : '',
    `調べる観点: ${focusText}`,
    `今日の日付: ${formatJapaneseDate(params.today ?? new Date())}`,
    '',
    'ルール:',
    '- 検索で確認できた事実だけを書く。推測や一般論は書かない。',
    '- 数値・日付・料金・制度名は正確に書く。いつ時点の情報かを「｜」の後ろに書く（不明なら空にする）。',
    // 11/11 のテストで、根拠メモの古い数字（前年度の利用率など）が記事に入り誤りと判定されたため（新方式の仕様書 工程 1b）
    '- 統計・利用率・料金・税率などは、今日の日付で確認できる最新の年度・最新の発表の数字を書く。新しい数字が見つかったときは古い年度の数字を書かない。',
    '- 公的機関・公式サイト・業界団体の情報を優先する。',
    '- 情報源によって内容が割れている点や、変わりやすい点は【注意点】に書く。',
    '- 1件の事実は1文（80字以内）で書く。',
    `- 事実は最大${maxFacts}件。`,
    '',
    // 「JSON だけを返す」と指示すると Gemini が検索せずに記憶だけで答えるため、行形式で書かせる
    '次の形式で書いてください（JSON やコードフェンスは使わない）。',
    '【事実】',
    '- 事実の内容｜2026年4月時点',
    '- 事実の内容｜',
    '【注意点】',
    '- 注意点',
  ].filter(Boolean).join('\n');
}

// 行形式の応答（【事実】【注意点】の箇条書き）を読む。箇条書きが 1 件もなければ null
export function parseFactSheetLines(
  text: string,
): { facts: Array<{ statement: string; as_of: string }>; cautions: string[] } | null {
  const facts: Array<{ statement: string; as_of: string }> = [];
  const cautions: string[] = [];
  let section: 'facts' | 'cautions' = 'facts';
  for (const rawLine of String(text || '').split('\n')) {
    const line = rawLine.trim();
    if (!line) continue;
    if (/^[【#\s]*注意点/.test(line)) {
      section = 'cautions';
      continue;
    }
    if (/^[【#\s]*事実/.test(line)) {
      section = 'facts';
      continue;
    }
    const bullet = line.match(/^(?:[-・*•]|\d+[.)．、])\s*(.+)$/);
    if (!bullet) continue;
    const body = bullet[1].trim();
    if (section === 'cautions') {
      cautions.push(body);
      continue;
    }
    const separator = Math.max(body.lastIndexOf('｜'), body.lastIndexOf('|'));
    facts.push(separator >= 0
      ? { statement: body.slice(0, separator).trim(), as_of: body.slice(separator + 1).trim() }
      : { statement: body, as_of: '' });
  }
  return facts.length > 0 || cautions.length > 0 ? { facts, cautions } : null;
}

// 1 回分の検索結果を根拠メモに変換する。出典は検索結果（groundingChunks）から取り、
// どの事実がどの出典に支えられているかは groundingSupports の文字列一致で対応づける。
export function parseFactSheetResponse(response: ParsedGeminiResponse): FactSheet {
  const sheet = createEmptyFactSheet();
  // JSON で返ってきた場合（以前の形式）も読めるようにしておく
  const trimmedText = response.text.trim().replace(/^```(?:json)?\s*/i, '');
  const looksLikeJson = trimmedText.startsWith('{') || trimmedText.startsWith('[');
  const parsed = (looksLikeJson ? extractJsonValue(response.text) : parseFactSheetLines(response.text)) as any;
  const rawFacts: any[] = Array.isArray(parsed?.facts) ? parsed.facts : Array.isArray(parsed) ? parsed : [];
  const rawCautions: any[] = Array.isArray(parsed?.cautions) ? parsed.cautions : [];

  sheet.sources = response.sources
    .map((source, index) => ({
      id: index + 1,
      title: source.title,
      url: isGroundingRedirectUrl(source.uri) ? '' : source.uri,
      redirectUrl: source.uri,
    }));

  const normalizedSupports = response.supports.map((support) => ({
    text: normalizeForMatch(support.text),
    sourceIds: support.chunkIndices.map((i) => i + 1).filter((id) => id <= sheet.sources.length),
  }));

  rawFacts.forEach((raw) => {
    const statement = String(raw?.statement ?? raw?.fact ?? raw ?? '').replace(/\s+/g, ' ').trim();
    if (!statement || statement.length < 6) return;
    const normalizedStatement = normalizeForMatch(statement);
    const sourceIds = new Set<number>();
    for (const support of normalizedSupports) {
      if (!support.text) continue;
      const overlaps =
        support.text.includes(normalizedStatement) ||
        (support.text.length >= 10 && normalizedStatement.includes(support.text));
      if (overlaps) support.sourceIds.forEach((id) => sourceIds.add(id));
    }
    sheet.facts.push({
      id: '',
      statement,
      asOf: String(raw?.as_of ?? raw?.asOf ?? '').trim(),
      sourceIds: Array.from(sourceIds).sort((a, b) => a - b),
    });
  });

  sheet.cautions = rawCautions
    .map((c) => String(c ?? '').replace(/\s+/g, ' ').trim())
    .filter((c) => c.length > 0)
    .slice(0, 8);
  sheet.searchQueries = response.searchQueries;
  sheet.searchUsed = response.grounded;
  return sheet;
}

// 複数回分の根拠メモを 1 つにまとめ、事実に F1〜 の番号を振り直す
export function mergeFactSheets(sheets: FactSheet[], maxFacts = MAX_FACT_SHEET_FACTS): FactSheet {
  const merged = createEmptyFactSheet();
  const seenStatements = new Set<string>();
  const sourceKeyToId = new Map<string, number>();

  for (const sheet of sheets) {
    const idMap = new Map<number, number>();
    for (const source of sheet.sources) {
      const key = source.url || source.redirectUrl || `${source.title}#${source.id}`;
      let newId = sourceKeyToId.get(key);
      if (!newId) {
        newId = merged.sources.length + 1;
        sourceKeyToId.set(key, newId);
        merged.sources.push({ ...source, id: newId });
      }
      idMap.set(source.id, newId);
    }
    for (const fact of sheet.facts) {
      const key = normalizeForMatch(fact.statement);
      if (!key || seenStatements.has(key)) continue;
      if (merged.facts.length >= maxFacts) break;
      seenStatements.add(key);
      merged.facts.push({
        ...fact,
        id: `F${merged.facts.length + 1}`,
        sourceIds: fact.sourceIds.map((id) => idMap.get(id)).filter((id): id is number => typeof id === 'number'),
      });
    }
    merged.cautions.push(...sheet.cautions.filter((c) => !merged.cautions.includes(c)));
    merged.searchQueries.push(...sheet.searchQueries);
    merged.searchUsed = merged.searchUsed || sheet.searchUsed;
    merged.warnings.push(...sheet.warnings);
  }

  merged.cautions = merged.cautions.slice(0, 8);
  return merged;
}

export function applyResolvedSourceUrls(sheet: FactSheet, resolved: Record<string, string>): FactSheet {
  return {
    ...sheet,
    sources: sheet.sources.map((source) => {
      if (source.url) return source;
      const target = source.redirectUrl ? resolved[source.redirectUrl] : '';
      return target ? { ...source, url: target } : source;
    }),
  };
}

// 根拠メモを作る（基本情報 → 必要なら最新情報 → 出典 URL の取得）
interface BuildFactSheetParams {
  keyword: string;
  title?: string | null;
  relatedKeywords?: string[];
  competitorHeadings?: string[];
  call: GeminiCaller;
  resolveUrls?: UrlResolver;
  includeLatest?: () => boolean;
  today?: Date;
  // Gemini が検索を使わずに答えたとき、1 回だけ作り直す（既定: する）
  retryIfSearchUnused?: boolean;
}

// Gemini は検索するかどうかを自分で決めるため、検索を使わずに答えることがある。
// その場合は 1 回だけ作り直し、検索を使った方を返す（記事改善プラン・新方式の仕様書 11 章の 0）
export async function buildFactSheet(params: BuildFactSheetParams): Promise<FactSheet> {
  const first = await buildFactSheetOnce(params);
  if (first.searchUsed || params.retryIfSearchUnused === false) return first;
  console.warn('[factSheet] Google search was not used; retrying once');
  try {
    const second = await buildFactSheetOnce(params);
    if (second.searchUsed) {
      second.warnings.push('1 回目は Google 検索が使われなかったため、作り直しました。');
      return second;
    }
  } catch (error) {
    console.warn('[factSheet] Retry failed; keeping the first result:', error);
  }
  return first;
}

async function buildFactSheetOnce(params: BuildFactSheetParams): Promise<FactSheet> {
  const today = params.today ?? new Date();
  const runFocus = async (focus: FactSheetFocus) => {
    const response = await params.call(
      buildFactSheetPrompt({
        keyword: params.keyword,
        title: params.title,
        relatedKeywords: params.relatedKeywords,
        competitorHeadings: params.competitorHeadings,
        focus,
        today,
      }),
      { role: 'base', useSearch: true, maxOutputTokens: 4096, temperature: 0.2, thinkingBudget: 0 },
    );
    return parseFactSheetResponse(response);
  };

  // 基本情報と最新情報の検索は同時に行う（待ち時間を短くするため）
  const includeLatest = params.includeLatest?.() ?? true;
  const [basicResult, latestResult] = await Promise.allSettled([
    runFocus('basic'),
    includeLatest ? runFocus('latest') : Promise.resolve(null),
  ]);
  if (basicResult.status === 'rejected') throw basicResult.reason;
  const sheets: FactSheet[] = [basicResult.value];
  if (latestResult.status === 'fulfilled' && latestResult.value) {
    sheets.push(latestResult.value);
  } else if (latestResult.status === 'rejected') {
    const reason = latestResult.reason;
    const message = reason instanceof Error ? reason.message : String(reason || '');
    sheets[0].warnings.push(`最新情報の検索に失敗しました: ${message.slice(0, 160)}`);
  }

  let sheet = mergeFactSheets(sheets);
  if (!sheet.searchUsed) {
    sheet.warnings.push('Google 検索が使われなかったため、根拠メモは AI の知識だけで作られています。');
  }

  if (params.resolveUrls) {
    const redirectUrls = sheet.sources.filter((s) => !s.url && s.redirectUrl).map((s) => s.redirectUrl as string);
    if (redirectUrls.length > 0) {
      try {
        sheet = applyResolvedSourceUrls(sheet, await params.resolveUrls(redirectUrls));
      } catch (error) {
        console.warn('Failed to resolve fact sheet source URLs:', error);
      }
    }
  }
  return sheet;
}

export function excludeFacts(sheet: FactSheet, excludedIds: string[]): FactSheet {
  if (!excludedIds.length) return sheet;
  const excluded = new Set(excludedIds);
  return { ...sheet, facts: sheet.facts.filter((fact) => !excluded.has(fact.id)) };
}

export function formatFactLines(sheet: FactSheet, factIds?: string[]): string {
  const wanted = factIds ? new Set(factIds) : null;
  return sheet.facts
    .filter((fact) => !wanted || wanted.has(fact.id))
    .map((fact) => `[${fact.id}] ${fact.statement}${fact.asOf ? `（${fact.asOf}）` : ''}`)
    .join('\n');
}

export const FACT_GROUNDED_WRITING_RULES = [
  '【根拠メモの使い方】',
  '- 数字・日付・料金・制度名・法令名・統計は、下の根拠メモにあるものだけを使う。',
  '- 根拠メモにない具体的な数字は書かない。必要なら「一般的には」「目安として」のように断定を避ける。',
  '- 料金・制度・統計など変わりやすい情報には、根拠メモにある時点を添える（例: 「2026年11月時点」）。',
  '- 根拠メモの「注意」にある点は断定しない。',
  '- 根拠メモの番号（[F1] など）や出典名は本文に書かない。',
].join('\n');

const formatCautions = (sheet: FactSheet): string =>
  sheet.cautions.length > 0 ? `注意:\n${sheet.cautions.map((c) => `- ${c}`).join('\n')}` : '';

// 構成案・タイトル用（全体の要約）
export function buildFactSheetOutlineInstructions(sheet: FactSheet | null | undefined, maxFacts = 15): string {
  if (!hasUsableFacts(sheet)) return '';
  const ids = sheet.facts.slice(0, maxFacts).map((f) => f.id);
  return [
    '【根拠メモ（検索で確認した事実）】',
    '読者の役に立つ事実を活かせる見出しを含めてください。根拠メモにない数字を見出しに入れないでください。',
    formatFactLines(sheet, ids),
    formatCautions(sheet),
  ].filter(Boolean).join('\n');
}

// 本文の見出しごとの指示
export function buildSectionFactInstructions(sheet: FactSheet | null | undefined, factIds: string[]): string {
  if (!hasUsableFacts(sheet)) return '';
  const lines = formatFactLines(sheet, factIds);
  return [
    FACT_GROUNDED_WRITING_RULES,
    '',
    '【この見出しで使える根拠メモ】',
    lines || 'この見出しに使える根拠はありません。具体的な数字・料金・制度名は書かず、一般的な説明にとどめてください。',
    formatCautions(sheet),
  ].filter(Boolean).join('\n');
}

// 記事全体の指示（見直し・一括執筆用）
export function buildArticleFactInstructions(sheet: FactSheet | null | undefined): string {
  if (!hasUsableFacts(sheet)) return '';
  return [
    FACT_GROUNDED_WRITING_RULES,
    '',
    '【根拠メモ】',
    formatFactLines(sheet),
    formatCautions(sheet),
  ].filter(Boolean).join('\n');
}

// --- 見出しへの根拠の割り当て ---

export function buildFactAssignmentPrompt(
  sheet: FactSheet,
  sections: Array<{ title: string; description?: string }>,
): string {
  return [
    '次の記事構成の各見出しに、下の「根拠メモ」から使う事実の番号を割り当ててください。',
    '- 1つの見出しに0〜5件。関係のない事実は割り当てない。',
    '- 同じ事実を複数の見出しに割り当ててもよい。',
    '',
    '見出し:',
    sections.map((s, i) => `${i + 1}. ${s.title}${s.description ? ` — ${s.description}` : ''}`).join('\n'),
    '',
    '根拠メモ:',
    formatFactLines(sheet),
    '',
    '次の形式の JSON だけを返してください:',
    '{"assignments":[{"section":1,"facts":["F1","F4"]}]}',
  ].join('\n');
}

export function parseFactAssignment(text: string, sectionCount: number, sheet: FactSheet): string[][] | null {
  const parsed = extractJsonValue(text) as any;
  const list: any[] = Array.isArray(parsed?.assignments) ? parsed.assignments : Array.isArray(parsed) ? parsed : [];
  if (list.length === 0) return null;
  const validIds = new Set(sheet.facts.map((f) => f.id));
  const result: string[][] = Array.from({ length: sectionCount }, () => []);
  for (const entry of list) {
    const index = Number(entry?.section) - 1;
    if (!Number.isInteger(index) || index < 0 || index >= sectionCount) continue;
    const facts: unknown[] = Array.isArray(entry?.facts) ? entry.facts : [];
    result[index] = Array.from(new Set(
      facts.map((f) => String(f || '').trim().toUpperCase()).filter((f) => validIds.has(f)),
    )).slice(0, 5);
  }
  return result;
}

// AI での割り当てに失敗したときの簡易版（見出しと事実の語の重なりで割り当てる）
export function assignFactsByOverlap(
  sheet: FactSheet,
  sections: Array<{ title: string; description?: string }>,
): string[][] {
  const tokenize = (text: string): Set<string> =>
    new Set((String(text || '').match(/[一-龠々]{2,}|[ァ-ヶー]{2,}|[A-Za-z0-9]{2,}/g) || []).map((t) => t.toLowerCase()));
  const factTokens = sheet.facts.map((fact) => ({ id: fact.id, tokens: tokenize(fact.statement) }));
  return sections.map((section) => {
    const sectionTokens = tokenize(`${section.title} ${section.description || ''}`);
    return factTokens
      .map((fact) => ({
        id: fact.id,
        score: Array.from(fact.tokens).filter((t) => sectionTokens.has(t)).length,
      }))
      .filter((f) => f.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 4)
      .map((f) => f.id);
  });
}

export async function assignFactsToSections(params: {
  sheet: FactSheet;
  sections: Array<{ title: string; description?: string }>;
  call?: GeminiCaller;
}): Promise<string[][]> {
  if (!hasUsableFacts(params.sheet) || params.sections.length === 0) {
    return params.sections.map(() => []);
  }
  if (params.call) {
    try {
      const response = await params.call(buildFactAssignmentPrompt(params.sheet, params.sections), {
        role: 'base',
        jsonOutput: true,
        maxOutputTokens: 2048,
        temperature: 0.1,
        thinkingBudget: 0,
      });
      const assigned = parseFactAssignment(response.text, params.sections.length, params.sheet);
      if (assigned) return assigned;
    } catch (error) {
      console.warn('Fact assignment via AI failed; falling back to keyword overlap:', error);
    }
  }
  return assignFactsByOverlap(params.sheet, params.sections);
}

// --- 参考資料 ---

const hostnameOf = (url: string): string => {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
};

const sourcePriority = (source: FactSheetSource): number => {
  const host = hostnameOf(source.url) || source.title.toLowerCase();
  if (/\.(go|lg)\.jp$/.test(host) || /\.gov(\.[a-z]{2})?$/.test(host)) return 3;
  if (/\.(ac|or|ed)\.jp$/.test(host) || /\.edu$/.test(host)) return 2;
  return 1;
};

export function selectReferenceSources(sheet: FactSheet | null | undefined, maxItems = 5): FactSheetSource[] {
  if (!sheet) return [];
  const usage = new Map<number, number>();
  sheet.facts.forEach((fact) => fact.sourceIds.forEach((id) => usage.set(id, (usage.get(id) || 0) + 1)));
  const hasSupportLinks = usage.size > 0;
  const seenHosts = new Set<string>();

  return sheet.sources
    .filter((source) => source.url && /^https?:\/\//i.test(source.url))
    // 事実との対応が取れている場合は、事実を支えている出典だけを使う
    .filter((source) => !hasSupportLinks || usage.has(source.id))
    .sort((a, b) =>
      sourcePriority(b) - sourcePriority(a) ||
      (usage.get(b.id) || 0) - (usage.get(a.id) || 0) ||
      a.id - b.id)
    .filter((source) => {
      const key = source.url.replace(/[#?].*$/, '');
      if (seenHosts.has(key)) return false;
      seenHosts.add(key);
      return true;
    })
    .slice(0, maxItems);
}

const escapeLinkText = (text: string): string => text.replace(/[[\]]/g, '').trim();

export function buildReferencesMarkdown(sheet: FactSheet | null | undefined, maxItems = 5): string {
  const sources = selectReferenceSources(sheet, maxItems);
  if (sources.length === 0) return '';
  const lines = sources.map((source) => {
    const label = escapeLinkText(source.title) || hostnameOf(source.url) || source.url;
    return `- [${label}](${source.url})`;
  });
  return `## ${REFERENCES_HEADING}\n\n${lines.join('\n')}`;
}

const REFERENCES_SECTION_PATTERN = new RegExp(`(^|\\n)#{2,3}\\s*${REFERENCES_HEADING}\\s*\\n[\\s\\S]*?(?=\\n#{1,2}\\s|$)`);

// 本文と参考資料を分ける（文字数調整や見出し検査は本文だけに行うため）
export function splitReferencesSection(content: string): { body: string; references: string } {
  const text = String(content || '');
  const match = text.match(REFERENCES_SECTION_PATTERN);
  if (!match || match.index === undefined) return { body: text.trim(), references: '' };
  const body = (text.slice(0, match.index) + text.slice(match.index + match[0].length)).trim();
  return { body, references: match[0].trim() };
}

export function appendReferencesSection(content: string, referencesMarkdown: string): string {
  const { body } = splitReferencesSection(content);
  if (!referencesMarkdown.trim()) return body;
  return `${body}\n\n${referencesMarkdown.trim()}\n`;
}
