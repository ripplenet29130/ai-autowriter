export interface SharedCompetitorTitleInput {
  title: string;
  headings?: string[];
}

export interface SharedTitleSuggestion {
  title: string;
  reason: string;
}

export interface GenerateTitleSuggestionsWithSharedCoreParams {
  keyword: string;
  relatedKeywords?: string[];
  hotTopics?: string[];
  competitors?: SharedCompetitorTitleInput[];
  count?: number;
  essentialKeywords?: string[];
  ngKeywords?: string[];
  callAI: (prompt: string, maxTokens: number) => Promise<string>;
}

function extractJsonArray(text: string): string | null {
  const trimmed = String(text || '').trim();
  if (!trimmed) return null;

  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced?.[1]) return fenced[1].trim();

  const start = trimmed.indexOf('[');
  const end = trimmed.lastIndexOf(']');
  if (start !== -1 && end !== -1 && end > start) {
    return trimmed.slice(start, end + 1);
  }
  return null;
}

function normalizeTitleText(value: string): string {
  return String(value || '')
    .replace(/^タイトル[:：]\s*/i, '')
    .replace(/^\*\*|\*\*$/g, '')
    .replace(/^["']|["']$/g, '')
    .replace(/[「」『』【】]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeComparable(value: string): string {
  return normalizeTitleText(value)
    .toLowerCase()
    .replace(/[｜|:：\-‐‑–—]/g, '')
    .replace(/\s+/g, '');
}

function hasRedundantTitlePattern(title: string, keyword: string): boolean {
  const normalizedTitle = normalizeComparable(title);
  const normalizedKeyword = normalizeComparable(keyword);
  if (!normalizedTitle) return false;

  if (/(選び方|おすすめ|比較|評判|費用|ポイント)の\1/.test(normalizedTitle)) {
    return true;
  }
  if (normalizedKeyword.length >= 4 && normalizedTitle.includes(`${normalizedKeyword}の${normalizedKeyword}`)) {
    return true;
  }
  return false;
}

function buildReasonFromTitle(title: string): string {
  const t = String(title || '');
  if (/費用|価格|相場|料金/.test(t)) {
    return '費用面の不安を先回りして解消し、比較検討層のクリック動機を高めるため。';
  }
  if (/比較|選び方|判断|基準|見極め/.test(t)) {
    return '比較軸を先に提示し、検討段階の読者が意思決定しやすくなるため。';
  }
  if (/失敗|後悔|注意|落とし穴|避ける/.test(t)) {
    return '失敗回避ニーズに直接応え、検索意図との一致率を高めるため。';
  }
  if (/始め方|手順|ステップ|初めて|入門/.test(t)) {
    return '実行手順を想起させ、これから始める読者の行動を後押しするため。';
  }
  if (/評判|口コミ|レビュー/.test(t)) {
    return '第三者評価を重視する層に刺さり、クリックの心理的ハードルを下げるため。';
  }
  if (/おすすめ|厳選|ランキング/.test(t)) {
    return '候補の絞り込みニーズに応え、短時間で比較したい読者に適合するため。';
  }
  return '検索意図に沿う切り口を明確にし、クリック後の期待値とのギャップを抑えるため。';
}

function parseJsonLikeTitles(raw: string): SharedTitleSuggestion[] {
  const titleMatches = [...String(raw || '').matchAll(/["“”](?:title|タイトル)["“”]\s*[:：]\s*["“”]([^"“”]+)["“”]/gi)];
  if (titleMatches.length === 0) return [];

  const reasonMatches = [...String(raw || '').matchAll(/["“”](?:reason|理由|狙い)["“”]\s*[:：]\s*["“”]([^"“”]+)["“”]/gi)];
  return titleMatches.map((match, index) => ({
    title: normalizeTitleText(String(match[1] || '')),
    reason: normalizeTitleText(String(reasonMatches[index]?.[1] || '')),
  }));
}

function parseMarkdownTableTitles(raw: string): SharedTitleSuggestion[] {
  const lines = String(raw || '')
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.startsWith('|') && line.endsWith('|'));

  const results: SharedTitleSuggestion[] = [];
  for (const line of lines) {
    if (/^\|\s*-+/.test(line)) continue;
    if (/タイトル|title/i.test(line) && /理由|reason|狙い/i.test(line)) continue;

    const cells = line
      .split('|')
      .map((cell) => cell.trim())
      .filter(Boolean);
    if (cells.length < 1) continue;

    const title = normalizeTitleText(cells[0] || '');
    if (!title || title.length < 6 || title.length > 120) continue;
    results.push({
      title,
      reason: normalizeTitleText(cells[1] || ''),
    });
  }

  return results;
}

function parseLineBasedTitles(raw: string): SharedTitleSuggestion[] {
  const lines = String(raw || '')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);

  const results: SharedTitleSuggestion[] = [];
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const looksLikeTitleLine =
      /^[-*]\s+/.test(line) ||
      /^\d+[.)、]\s+/.test(line) ||
      /^(?:タイトル案?|案|title)\s*\d*\s*[:：]/i.test(line) ||
      /^#{1,4}\s+/.test(line);

    if (!looksLikeTitleLine) continue;

    const cleaned = line
      .replace(/^#{1,4}\s+/, '')
      .replace(/^[-*]\s+/, '')
      .replace(/^\d+[.)、]\s+/, '')
      .replace(/^(?:タイトル案?|案|title)\s*\d*\s*[:：]\s*/i, '')
      .replace(/\*\*/g, '')
      .split(/\s+(?:-|--|ー|:|：)\s*(?:理由|狙い|reason)\s*[:：]?/i)[0]
      .split(/\s+\|\s+/)[0]
      .trim();

    if (!cleaned || cleaned.length < 6 || cleaned.length > 120) continue;
    if (/^(理由|狙い|reason)[:：]/i.test(cleaned)) continue;

    const nextLine = String(lines[index + 1] || '').trim();
    const reasonMatch = nextLine.match(/^(?:理由|狙い|reason)[:：]\s*(.+)$/i);

    results.push({
      title: normalizeTitleText(cleaned),
      reason: reasonMatch ? normalizeTitleText(reasonMatch[1]) : '',
    });
  }
  return results;
}

function normalizeAndFilterSuggestions(
  suggestions: SharedTitleSuggestion[],
  keyword: string,
  limit: number
): SharedTitleSuggestion[] {
  const seen = new Set<string>();
  const normalized: SharedTitleSuggestion[] = [];

  for (const item of suggestions) {
    const title = normalizeTitleText(String(item?.title || ''));
    if (!title) continue;
    if (hasRedundantTitlePattern(title, keyword)) continue;

    const comparable = normalizeComparable(title);
    if (!comparable || seen.has(comparable)) continue;
    seen.add(comparable);

    const reason = String(item?.reason || '').trim() || buildReasonFromTitle(title);
    normalized.push({ title, reason });
    if (normalized.length >= limit) break;
  }

  return normalized;
}

function ensureReasonDiversity(suggestions: SharedTitleSuggestion[]): SharedTitleSuggestion[] {
  if (suggestions.length <= 1) return suggestions;
  const uniqueReasons = new Set(
    suggestions.map((item) => String(item.reason || '').trim()).filter(Boolean)
  );
  if (uniqueReasons.size >= Math.min(3, suggestions.length)) return suggestions;

  return suggestions.map((item) => ({
    title: item.title,
    reason: buildReasonFromTitle(item.title),
  }));
}

function parseSuggestionsFromJsonValue(value: unknown): SharedTitleSuggestion[] {
  if (Array.isArray(value)) return value as SharedTitleSuggestion[];
  if (!value || typeof value !== 'object') return [];

  const record = value as Record<string, unknown>;
  const candidateKeys = ['titles', 'suggestions', 'titleSuggestions', 'candidates', 'items', 'タイトル候補'];
  for (const key of candidateKeys) {
    if (Array.isArray(record[key])) return record[key] as SharedTitleSuggestion[];
  }

  return [];
}

function parseAiTitleSuggestions(raw: string, keyword: string, count: number): SharedTitleSuggestion[] {
  const parsers = [
    () => parseJsonLikeTitles(raw),
    () => parseMarkdownTableTitles(raw),
    () => parseLineBasedTitles(raw),
  ];

  for (const parse of parsers) {
    const suggestions = normalizeAndFilterSuggestions(parse(), keyword, count);
    if (suggestions.length >= count) return ensureReasonDiversity(suggestions);
  }

  const jsonText = extractJsonArray(raw);
  if (jsonText) {
    try {
      const parsed = JSON.parse(jsonText);
      const parsedSuggestions = parseSuggestionsFromJsonValue(parsed);
      const suggestions = normalizeAndFilterSuggestions(parsedSuggestions, keyword, count);
      if (suggestions.length >= count) return ensureReasonDiversity(suggestions);
    } catch {
      return [];
    }
  }

  return [];
}

export async function generateTitleSuggestionsWithSharedCore(
  params: GenerateTitleSuggestionsWithSharedCoreParams
): Promise<SharedTitleSuggestion[]> {
  const count = Math.max(1, Math.min(8, Number(params.count) || 5));
  const keyword = String(params.keyword || '').trim();
  if (!keyword) {
    throw new Error('タイトル生成に必要なキーワードがありません。');
  }

  const ngKeywords = (params.ngKeywords || []).map((k) => String(k || '').trim()).filter(Boolean);
  const essentialKeywords = (params.essentialKeywords || []).map((k) => String(k || '').trim()).filter(Boolean);
  const relatedKeywords = (params.relatedKeywords || []).map((k) => String(k || '').trim()).filter(Boolean);
  const hotTopics = (params.hotTopics || []).map((k) => String(k || '').trim()).filter(Boolean);
  const competitors = (params.competitors || []).filter((c) => String(c?.title || '').trim().length > 0);

  const filteredRelated = relatedKeywords.filter((kw) => !ngKeywords.includes(kw));
  const filteredHotTopics = hotTopics.filter((topic) => !ngKeywords.some((ng) => topic.includes(ng)));
  const relatedLine = [...filteredRelated, ...filteredHotTopics].slice(0, 12).join('、') || 'なし';

  const competitorText = competitors.length > 0
    ? competitors.map((c) => {
      const title = String(c.title || '').trim();
      const headings = Array.isArray(c.headings) ? c.headings.filter(Boolean).slice(0, 5).join(', ') : '';
      return `- タイトル: ${title}${headings ? `\n  (主な見出し: ${headings})` : ''}`;
    }).join('\n')
    : '（データなし）';
  const outputExample = Array.from({ length: count }, (_, index) =>
    `  { "title": "タイトル${index + 1}", "reason": "この切り口にした理由" }`
  ).join(',\n');

  const prompt = `
あなたは日本語SEOライターです。以下のキーワードで、オリジナルのブログ記事タイトルを${count}件作成してください。

【メインキーワード】
${keyword}

【関連キーワード（記事内容の参考に）】
${relatedLine}

${essentialKeywords.length > 0 ? `【必ず含めるキーワード】\n${essentialKeywords.join('、')}\n` : ''}
${ngKeywords.length > 0 ? `【使用禁止キーワード】\n${ngKeywords.join('、')}\n` : ''}

${competitors.length > 0 ? `【既存記事（差別化のために参照、模倣しないこと）】
${competitorText}
` : ''}
【タイトル作成ルール】
1. 既存記事のタイトルを真似しない。構成・語順・語尾すべて独自に考える
2. 「○○の選び方」「後悔しない」「○○年版」などの使い古した定型句を避ける
3. ${count}件それぞれ異なる切り口・視点・文体にする（同じ型の繰り返し禁止）
4. 読者の「なぜ？」「どうやって？」「何が違う？」などの問いに直接答えるタイトルにする
5. キーワードは文脈に合わせて自然に含め、無理な詰め込みをしない
6. 記事の具体的な内容・価値が伝わるタイトルにする（曖昧な表現を避ける）
7. 各タイトルに、そのタイトルにした理由（読者視点での狙い）を1文で添える

【出力形式（JSON配列のみ、前置き不要）】
[
${outputExample}
]
`.trim();

  try {
    const raw = await params.callAI(prompt, 1800);
    const suggestions = parseAiTitleSuggestions(raw, keyword, count);
    if (suggestions.length >= 1) return suggestions;

    const retryPrompt = `
次のキーワードから、ブログ記事タイトル案を必ず${count}件作成してください。

キーワード: ${keyword}
関連キーワード: ${relatedLine}

条件:
- 返答はJSON配列のみ
- 配列の要素数は必ず${count}件
- 各要素は title と reason を持つ
- titleは記事タイトルとしてそのまま使える日本語にする
- reasonは1文で書く

出力例:
[
${outputExample}
]
`.trim();
    const retryRaw = await params.callAI(retryPrompt, 1200);
    const retrySuggestions = parseAiTitleSuggestions(retryRaw, keyword, count);
    if (retrySuggestions.length >= 1) return retrySuggestions;

    throw new Error(`AIのタイトル候補を1件も取得できませんでした。`);
  } catch (error) {
    if (error instanceof Error) throw error;
    throw new Error('AIタイトル生成に失敗しました。');
  }
}
