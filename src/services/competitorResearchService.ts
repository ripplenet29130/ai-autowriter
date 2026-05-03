import { supabase } from './supabaseClient';
import { getCurrentAccountId } from './accountScope';

export interface CompetitorArticle {
    title: string;
    url: string;
    domain: string;
    headings: string[];
    metaDescription: string;
    wordCount: number;
    excerpt?: string;
}

export interface CompetitorResearchResult {
    keyword: string;
    articles: CompetitorArticle[];
    averageLength: number;
    commonTopics: string[];
}

function normalizeCompetitorArticle(raw: any): CompetitorArticle | null {
    if (!raw) return null;
    const title = String(raw.title || raw.name || '').trim();
    const url = String(raw.url || raw.link || '').trim();
    if (!title || !url) return null;

    const headings = Array.isArray(raw.headings)
        ? raw.headings
            .map((heading: unknown) => String(heading || '').trim())
            .filter((heading: string) => heading.length > 0)
        : [];
    const metaDescription = String(raw.metaDescription || raw.snippet || raw.description || '').trim();
    const excerpt = String(raw.excerpt || metaDescription || '').trim();
    const domain = String(raw.domain || (() => {
        try {
            return new URL(url).hostname;
        } catch {
            return '';
        }
    })()).trim();
    const wordCount = Number(raw.wordCount);

    return {
        title,
        url,
        domain,
        headings: headings.length > 0 ? headings : [title],
        metaDescription,
        wordCount: Number.isFinite(wordCount) && wordCount >= 0 ? wordCount : excerpt.length,
        excerpt,
    };
}

function normalizeCompetitorArticles(data: any): CompetitorArticle[] {
    const candidates = Array.isArray(data?.topArticles)
        ? data.topArticles
        : Array.isArray(data?.articles)
            ? data.articles
            : Array.isArray(data?.organic_results)
                ? data.organic_results
                : [];

    return candidates
        .map(normalizeCompetitorArticle)
        .filter((article: CompetitorArticle | null): article is CompetitorArticle => article !== null);
}

function extractCommonTopics(articles: CompetitorArticle[]): string[] {
    const headingCount = new Map<string, number>();
    const headingOriginal = new Map<string, string>();
    for (const article of articles) {
        const seen = new Set<string>();
        for (const h of article.headings) {
            const normalized = h.replace(/[　\s]+/g, '').replace(/[!！?？。、]/g, '').toLowerCase();
            if (!normalized || normalized.length < 4 || seen.has(normalized)) continue;
            seen.add(normalized);
            headingCount.set(normalized, (headingCount.get(normalized) || 0) + 1);
            if (!headingOriginal.has(normalized)) headingOriginal.set(normalized, h);
        }
    }
    const sorted = [...headingCount.entries()].sort((a, b) => b[1] - a[1]);
    return sorted.map(([key]) => headingOriginal.get(key) ?? key).slice(0, 12);
}

class CompetitorResearchService {
    /**
     * 競合調査を実行（キャッシュがあれば再利用）
     */
    async conductResearch(keyword: string, limit: number = 3, serpApiKey?: string): Promise<CompetitorResearchResult> {
        try {
            // まずキャッシュを確認（APIキーがある場合は最新情報を取得するためキャッシュをスキップすることも検討できますが、ここでは単純化のため継続）
            const cached = await this.getCachedResearch(keyword);
            if (cached && !serpApiKey) {
                console.log(`[competitor debug] cache hit keyword="${keyword}" articles=${cached.articles.length}`);
                if (cached.articles.length === 0) {
                    console.warn(`[competitor debug] cached result is empty; refetching keyword="${keyword}"`);
                } else {
                    return cached;
                }
            }

            // キャッシュがなければAPI呼び出し
            console.log(`競合調査API呼び出し: ${keyword}`);
            const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
            const supabaseKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

            const response = await fetch(
                `${supabaseUrl}/functions/v1/competitor-search`,
                {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${supabaseKey}`,
                    },
                    body: JSON.stringify({ keyword, limit, serpApiKey }), // serpApiKeyを追加
                }
            );

            const data = await response.json().catch(() => null);
            console.debug('[competitor debug] api response', {
                keyword,
                status: response.status,
                ok: response.ok,
                keys: data ? Object.keys(data) : [],
                topArticles: Array.isArray(data?.topArticles) ? data.topArticles.length : undefined,
                articles: Array.isArray(data?.articles) ? data.articles.length : undefined,
                organicResults: Array.isArray(data?.organic_results) ? data.organic_results.length : undefined,
                error: data?.error,
            });

            if (!response.ok) {
                throw new Error(`競合調査APIエラー: ${response.status}${data?.error ? ` ${data.error}` : ''}`);
            }

            const articles = normalizeCompetitorArticles(data);
            if (articles.length === 0) {
                console.warn('[competitor debug] no competitor articles normalized', {
                    keyword,
                    data,
                });
            } else {
                console.debug('[competitor debug] normalized articles', articles.map((article) => ({
                    title: article.title,
                    domain: article.domain,
                    headings: article.headings.length,
                    excerptLength: article.excerpt?.length || 0,
                })));
            }

            return {
                keyword,
                articles,
                averageLength: data?.averageLength || (articles.reduce((sum, article) => sum + article.wordCount, 0) / (articles.length || 1)),
                commonTopics: Array.isArray(data?.commonTopics) && data.commonTopics.length > 0
                    ? data.commonTopics
                    : extractCommonTopics(articles)
            };
        } catch (error) {
            console.error('競合調査エラー:', error);
            throw new Error('競合調査に失敗しました');
        }
    }

    /**
     * キャッシュされた競合調査データを取得
     */
    private async getCachedResearch(keyword: string): Promise<CompetitorResearchResult | null> {
        if (!supabase) return null;
        const accountId = getCurrentAccountId();
        if (!accountId) return null;

        const { data, error } = await supabase
            .from('competitor_research')
            .select('*')
            .eq('keyword', keyword)
            .eq('account_id', accountId)
            .maybeSingle();

        if (error || !data) {
            return null;
        }

        const articles = data.articles as CompetitorArticle[];
        const commonTopics = extractCommonTopics(articles);
        return {
            keyword: data.keyword,
            articles,
            averageLength: articles.reduce((sum: number, a: CompetitorArticle) => sum + a.wordCount, 0) / (articles.length || 1),
            commonTopics,
        };
    }

    /**
     * 競合調査履歴を取得
     */
    async getHistory(limit: number = 10) {
        if (!supabase) return [];
        const accountId = getCurrentAccountId();
        if (!accountId) return [];

        const { data, error } = await supabase
            .from('competitor_research')
            .select('keyword, created_at')
            .eq('account_id', accountId)
            .order('created_at', { ascending: false })
            .limit(limit);

        if (error) {
            console.error('履歴取得エラー:', error);
            return [];
        }

        return data || [];
    }
}

export const competitorResearchService = new CompetitorResearchService();
