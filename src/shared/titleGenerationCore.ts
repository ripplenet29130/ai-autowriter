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
  const base = String(keyword || '').trim() || '記事テーマ';
  const topic = pickTopicTerm(base, relatedKeywords, hotTopics);

  // フォールバックも多様なパターンで生成（定型語尾の連発を避ける）
  const patterns: [string, string][] = [
    [
      `${base}とは何か：仕組みと基本的な考え方`,
      'テーマの本質を問う形式で、基礎から理解したい読者に対応するため。',
    ],
    [
      `${base}を正しく理解するための重要ポイント`,
      '「正しく」という言葉で、情報の信頼性を求める読者の関心を引くため。',
    ],
    [
      `${base}における${topic}の役割と実践的な活用法`,
      '関連トピックとの関係を切り口に、実用性を重視する読者に訴求するため。',
    ],
    [
      `現場で役立つ${base}の知識と対処法`,
      '「現場」という具体性が実務者の共感を呼び、クリック動機を高めるため。',
    ],
    [
      `${base}の効果を最大化するための管理・運用のコツ`,
      '導入後の運用フェーズを意識した読者層に合致する切り口のため。',
    ],
    [
      `${base}に関してよく見落とされる注意点と対策`,
      '「見落とし」という表現が検索意図と合致し、情報収集層を引き込むため。',
    ],
    [
      `${base}の種類と特徴を整理：目的に応じた使い分け方`,
      '分類・整理の需要に応え、選定で迷う読者の意思決定を助けるため。',
    ],
    [
      `${base}の導入・設定で押さえるべき手順と判断軸`,
      '手順ベースの情報ニーズに応え、初めて取り組む読者にとって有益なため。',
    ],
  ];

  const seen = new Set<string>();
  const suggestions: SharedTitleSuggestion[] = [];
  for (const [rawTitle, reason] of patterns) {
    const title = normalizeTitleText(rawTitle);
    const comparable = normalizeComparable(title);
    if (!title || !comparable || seen.has(comparable)) continue;
    seen.add(comparable);
    suggestions.push({ title, reason });
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
  { "title": "タイトル1", "reason": "この切り口にした理由" },
  { "title": "タイトル2", "reason": "この切り口にした理由" }
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
