import { aiService } from './aiService';

export interface TitleKeywordInference {
  mainKeyword: string;
  subKeywords: string[];
  searchIntent: string;
  targetAudience: string;
  articleType: 'howto' | 'comparison' | 'review' | 'list' | 'guide' | 'news' | 'column' | 'other';
}

const ARTICLE_TYPES = new Set<TitleKeywordInference['articleType']>([
  'howto',
  'comparison',
  'review',
  'list',
  'guide',
  'news',
  'column',
  'other',
]);

function normalizeKeyword(value: unknown): string {
  return String(value || '')
    .replace(/[「」『』【】()（）]/g, ' ')
    .replace(/\[/g, ' ')
    .replace(/\]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function uniqueKeywords(values: unknown[], exclude: string[] = []): string[] {
  const seen = new Set(exclude.map((value) => value.toLowerCase()));
  const keywords: string[] = [];

  values.forEach((value) => {
    const keyword = normalizeKeyword(value);
    const key = keyword.toLowerCase();
    if (!keyword || seen.has(key)) return;
    seen.add(key);
    keywords.push(keyword);
  });

  return keywords;
}

function fallbackMainKeyword(title: string): string {
  const normalized = normalizeKeyword(title);
  const firstPhrase = normalized.split(/[？?！!：:｜|、。]/)[0]?.trim();
  const withoutNumbers = (firstPhrase || normalized)
    .replace(/\d+\s*(選|個|つ|ステップ|ポイント|社|件)/g, '')
    .replace(/(とは|について|を解説|徹底解説|完全ガイド|おすすめ|ランキング)$/g, '')
    .trim();

  return withoutNumbers || firstPhrase || normalized;
}

function fallbackSubKeywords(title: string, mainKeyword: string): string[] {
  const tokens = normalizeKeyword(title)
    .match(/[A-Za-z0-9ぁ-んァ-ン一-龠]{2,}/g) || [];

  return uniqueKeywords(tokens, [mainKeyword]).slice(0, 8);
}

function normalizeArticleType(value: unknown): TitleKeywordInference['articleType'] {
  const articleType = String(value || '').toLowerCase();
  return ARTICLE_TYPES.has(articleType as TitleKeywordInference['articleType'])
    ? articleType as TitleKeywordInference['articleType']
    : 'other';
}

function normalizeInference(raw: unknown, title: string): TitleKeywordInference {
  const data = raw && typeof raw === 'object' ? raw as Record<string, unknown> : {};
  const mainKeyword = normalizeKeyword(data.mainKeyword) || fallbackMainKeyword(title);
  const subKeywords = uniqueKeywords(
    Array.isArray(data.subKeywords) ? data.subKeywords : [],
    [mainKeyword]
  ).slice(0, 8);

  return {
    mainKeyword,
    subKeywords: subKeywords.length > 0 ? subKeywords : fallbackSubKeywords(title, mainKeyword),
    searchIntent: normalizeKeyword(data.searchIntent) || `${mainKeyword}について知りたい`,
    targetAudience: normalizeKeyword(data.targetAudience) || 'このテーマに関心がある読者',
    articleType: normalizeArticleType(data.articleType),
  };
}

export class TitleKeywordInferenceService {
  async inferFromTitle(title: string): Promise<TitleKeywordInference> {
    const normalizedTitle = normalizeKeyword(title);
    const fallback = normalizeInference(null, normalizedTitle);

    if (!normalizedTitle) return fallback;

    try {
      const result = await aiService.generateCustomJson(`
以下の記事タイトルをSEO記事生成用に解析してください。

【タイトル】
${normalizedTitle}

次のJSON形式で返してください。
{
  "mainKeyword": "検索・競合調査に使う主キーワード。読者が検索しそうな自然な語句",
  "subKeywords": ["補助キーワードを3〜8個。料金、口コミ、選び方などタイトルに含まれる観点を優先"],
  "searchIntent": "読者がこのタイトルで満たしたい検索意図",
  "targetAudience": "想定読者",
  "articleType": "howto | comparison | review | list | guide | news | column | other のいずれか"
}

ルール:
- mainKeywordはタイトル全文の単純コピーにしない
- 煽り文句、数字、句読点だけを主キーワードにしない
- subKeywordsにはmainKeywordと同じ語句を入れない
- 日本語の検索語として自然な短い表現にする
`);

      return normalizeInference(result, normalizedTitle);
    } catch (error) {
      console.warn('Title keyword inference failed. Falling back to local extraction.', error);
      return fallback;
    }
  }
}

export const titleKeywordInferenceService = new TitleKeywordInferenceService();
