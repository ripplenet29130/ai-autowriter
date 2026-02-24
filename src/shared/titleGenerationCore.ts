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

function pickTopicTerm(keyword: string, relatedKeywords: string[], hotTopics: string[]): string {
  const normalizedKeyword = normalizeComparable(keyword);
  const candidates = [...relatedKeywords, ...hotTopics]
    .map((v) => String(v || '').trim())
    .filter(Boolean);

  for (const candidate of candidates) {
    const n = normalizeComparable(candidate);
    if (!n || n === normalizedKeyword) continue;
    if (normalizedKeyword && n.includes(normalizedKeyword)) continue;
    if (candidate.length >= 2 && candidate.length <= 18) return candidate;
  }

  return '比較';
}

function fallbackTitleSuggestions(
  keyword: string,
  count: number,
  relatedKeywords: string[] = [],
  hotTopics: string[] = []
): SharedTitleSuggestion[] {
  const currentYear = new Date().getFullYear();
  const base = String(keyword || '').trim() || '記事テーマ';
  const topic = pickTopicTerm(base, relatedKeywords, hotTopics);
  const templates = [
    `${currentYear}年版 ${base}の選び方｜後悔しない比較ポイント`,
    `${base}で迷わないための基礎知識と判断基準`,
    `${base}の費用相場と${topic}で見る比較ポイント`,
    `${base}の失敗例から学ぶ、後悔しない進め方`,
    `はじめての${base}で確認すべき手順と注意点`,
    `${base}を比較する前に知っておきたいチェックリスト`,
    `${base}の評判・実例から見る向いている人の特徴`,
    `${base}のおすすめ候補を整理｜選定時に見るべき軸`,
  ];

  const seen = new Set<string>();
  const suggestions: SharedTitleSuggestion[] = [];
  for (const raw of templates) {
    const title = normalizeTitleText(raw);
    const comparable = normalizeComparable(title);
    if (!title || !comparable || seen.has(comparable)) continue;
    seen.add(comparable);
    suggestions.push({
      title,
      reason: buildReasonFromTitle(title),
    });
    if (suggestions.length >= Math.max(1, count)) break;
  }
  return suggestions;
}

function parseJsonLikeTitles(raw: string): SharedTitleSuggestion[] {
  const titleMatches = [...String(raw || '').matchAll(/"title"\s*:\s*"([^"]+)"/g)];
  if (titleMatches.length === 0) return [];

  const reasonMatches = [...String(raw || '').matchAll(/"reason"\s*:\s*"([^"]+)"/g)];
  return titleMatches.map((match, index) => ({
    title: normalizeTitleText(String(match[1] || '')),
    reason: normalizeTitleText(String(reasonMatches[index]?.[1] || '')),
  }));
}

function parseLineBasedTitles(raw: string, keyword: string): SharedTitleSuggestion[] {
  const lines = String(raw || '')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);

  const results: SharedTitleSuggestion[] = [];
  for (const line of lines) {
    const cleaned = line
      .replace(/^[-*]\s+/, '')
      .replace(/^\d+[.)]\s+/, '')
      .replace(/^(タイトル案?|title)\s*\d*\s*[:：]\s*/i, '')
      .trim();

    if (!cleaned || cleaned.length < 12 || cleaned.length > 80) continue;
    if (/^(理由|狙い|reason)[:：]/i.test(cleaned)) continue;
    if (/です。$|ます。$/.test(cleaned) && cleaned.length < 25) continue;
    if (!cleaned.includes(keyword) && !/(比較|選び方|費用|注意|始め方|評判)/.test(cleaned)) continue;

    results.push({
      title: normalizeTitleText(cleaned),
      reason: '',
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

function fillSuggestionsToCount(
  primary: SharedTitleSuggestion[],
  keyword: string,
  count: number,
  relatedKeywords: string[],
  hotTopics: string[]
): SharedTitleSuggestion[] {
  const normalizedPrimary = normalizeAndFilterSuggestions(primary, keyword, count);
  if (normalizedPrimary.length >= count) {
    return ensureReasonDiversity(normalizedPrimary.slice(0, count));
  }

  const fallback = fallbackTitleSuggestions(keyword, count, relatedKeywords, hotTopics);
  const merged = normalizeAndFilterSuggestions(
    [...normalizedPrimary, ...fallback],
    keyword,
    count
  );
  return ensureReasonDiversity(merged.slice(0, count));
}

export async function generateTitleSuggestionsWithSharedCore(
  params: GenerateTitleSuggestionsWithSharedCoreParams
): Promise<SharedTitleSuggestion[]> {
  const count = Math.max(1, Math.min(8, Number(params.count) || 5));
  const keyword = String(params.keyword || '').trim();
  if (!keyword) return fallbackTitleSuggestions('記事テーマ', count, [], []);

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

  const prompt = `
以下のキーワードと競合他社のタイトルを参考に、SEO的に強力で思わずクリックしたくなる魅力的なブログ記事のタイトル案を${count}件提案してください。

【メインキーワード】
${keyword}

【関連キーワード/トピック（SEO強化）】
${relatedLine}

${essentialKeywords.length > 0 ? `【必須キーワード（自然な範囲で優先）】\n${essentialKeywords.join('、')}\n` : ''}
${ngKeywords.length > 0 ? `【NGキーワード（使用禁止）】\n${ngKeywords.join('、')}\n` : ''}

【競合他社のタイトルと構成】
${competitorText}

【重要指示】
- 毎回異なる視点や切り口（比較、注意点、始め方、失敗回避、費用整理など）を混ぜる
- タイトルの語尾を毎回同じ型にしない（定型語尾の連発を避ける）
- 「2026年版」「後悔しない比較ポイント」などの定型句に偏らない
- キーワードは自然に含め、無理な詰め込みをしない
- 数字が有効な場合のみ使う（必須ではない）
- 各タイトル案に短い理由を付ける
- 出力はJSON配列のみ

出力形式:
[
  { "title": "タイトル案1", "reason": "狙い" },
  { "title": "タイトル案2", "reason": "狙い" }
]
`.trim();

  try {
    const raw = await params.callAI(prompt, 1800);
    const jsonLikeParsed = parseJsonLikeTitles(raw);
    if (jsonLikeParsed.length > 0) {
      return fillSuggestionsToCount(jsonLikeParsed, keyword, count, filteredRelated, filteredHotTopics);
    }

    const jsonText = extractJsonArray(raw);
    if (!jsonText) {
      const lineParsed = parseLineBasedTitles(raw, keyword);
      if (lineParsed.length > 0) {
        return fillSuggestionsToCount(lineParsed, keyword, count, filteredRelated, filteredHotTopics);
      }
      return fallbackTitleSuggestions(keyword, count, filteredRelated, filteredHotTopics);
    }

    const parsed = JSON.parse(jsonText);
    if (!Array.isArray(parsed)) {
      const lineParsed = parseLineBasedTitles(raw, keyword);
      if (lineParsed.length > 0) {
        return fillSuggestionsToCount(lineParsed, keyword, count, filteredRelated, filteredHotTopics);
      }
      return fallbackTitleSuggestions(keyword, count, filteredRelated, filteredHotTopics);
    }

    const suggestions = normalizeAndFilterSuggestions(parsed as SharedTitleSuggestion[], keyword, count);
    if (suggestions.length > 0) {
      return fillSuggestionsToCount(suggestions, keyword, count, filteredRelated, filteredHotTopics);
    }
    return fallbackTitleSuggestions(keyword, count, filteredRelated, filteredHotTopics);
  } catch {
    return fallbackTitleSuggestions(keyword, count, filteredRelated, filteredHotTopics);
  }
}
