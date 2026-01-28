import { supabase } from './supabaseClient';

export interface CompetitorArticle {
    title: string;
    url: string;
    domain: string;
    headings: string[];
    metaDescription: string;
    wordCount: number;
}

export interface CompetitorResearchResult {
    keyword: string;
    articles: CompetitorArticle[];
    averageLength: number;
    commonTopics: string[];
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
                console.log(`キャッシュされた競合データを使用: ${keyword}`);
                return cached;
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

            if (!response.ok) {
                throw new Error(`競合調査APIエラー: ${response.status}`);
            }

            const data = await response.json();
            return {
                keyword,
                articles: data.topArticles || [],
                averageLength: data.averageLength || 0,
                commonTopics: data.commonTopics || []
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

        const { data, error } = await supabase
            .from('competitor_research')
            .select('*')
            .eq('keyword', keyword)
            .maybeSingle();

        if (error || !data) {
            return null;
        }

        return {
            keyword: data.keyword,
            articles: data.articles as CompetitorArticle[],
            averageLength: data.articles.reduce((sum: number, a: any) => sum + a.wordCount, 0) / data.articles.length,
            commonTopics: [] // DBには保存していないので空配列
        };
    }

    /**
     * 競合調査履歴を取得
     */
    async getHistory(limit: number = 10) {
        if (!supabase) return [];

        const { data, error } = await supabase
            .from('competitor_research')
            .select('keyword, created_at')
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
