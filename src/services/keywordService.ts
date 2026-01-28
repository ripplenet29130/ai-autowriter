import { supabase } from './supabaseClient';

export interface Keyword {
    id: string;
    keyword: string;
    created_at: string;
}

class KeywordService {
    /**
     * キーワード一覧を取得
     */
    async getKeywords(): Promise<Keyword[]> {
        if (!supabase) {
            console.error('Supabase is not initialized');
            return [];
        }

        const { data, error } = await supabase
            .from('keywords')
            .select('*')
            .order('created_at', { ascending: false });

        if (error) {
            console.error('Error fetching keywords:', error);
            throw new Error(`キーワードの取得に失敗しました: ${error.message}`);
        }

        return data || [];
    }

    /**
     * キーワードを追加
     */
    async addKeyword(keyword: string): Promise<Keyword | null> {
        if (!supabase) {
            return null;
        }

        // 重複チェック
        const { data: existing } = await supabase
            .from('keywords')
            .select('id')
            .eq('keyword', keyword)
            .maybeSingle();

        if (existing) {
            // 既に存在する場合はnullを返して何もしない（エラーにはしない）
            return null;
        }

        const { data, error } = await supabase
            .from('keywords')
            .insert({ keyword })
            .select()
            .single();

        if (error) {
            console.error('Error adding keyword:', error);
            throw new Error(`キーワードの追加に失敗しました: ${error.message}`);
        }

        return data;
    }

    /**
     * キーワードを一括追加
     */
    async addKeywords(keywords: string[]): Promise<void> {
        if (!supabase || keywords.length === 0) {
            return;
        }

        // 既存のキーワードを取得して重複を除外
        const { data: existingData } = await supabase
            .from('keywords')
            .select('keyword')
            .in('keyword', keywords);

        const existingKeywords = new Set((existingData || []).map((k: any) => k.keyword));

        const newKeywords = keywords
            .filter(k => !existingKeywords.has(k))
            .map(k => ({ keyword: k }));

        if (newKeywords.length === 0) {
            return;
        }

        const { error } = await supabase
            .from('keywords')
            .insert(newKeywords);

        if (error) {
            console.error('Error adding keywords:', error);
            throw new Error(`キーワードの一括追加に失敗しました: ${error.message}`);
        }
    }

    /**
     * キーワードを削除
     */
    async deleteKeyword(id: string): Promise<void> {
        if (!supabase) {
            return;
        }

        const { error } = await supabase
            .from('keywords')
            .delete()
            .eq('id', id);

        if (error) {
            console.error('Error deleting keyword:', error);
            throw new Error(`キーワードの削除に失敗しました: ${error.message}`);
        }
    }
}

export const keywordService = new KeywordService();
