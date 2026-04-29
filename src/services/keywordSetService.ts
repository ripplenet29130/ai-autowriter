import { supabase } from './supabaseClient';
import { KeywordSet } from '../types';
import { getCurrentAccountId, getRequiredAccountId } from './accountScope';

class KeywordSetService {
    /**
     * キーワードセット一覧を取得
     */
    async getKeywordSets(): Promise<KeywordSet[]> {
        if (!supabase) return [];

        const accountId = getCurrentAccountId();
        let query = supabase
            .from('keyword_sets')
            .select('*')
            .order('created_at', { ascending: false });

        if (accountId) {
            query = query.eq('account_id', accountId);
        }

        const { data, error } = await query;

        if (error) {
            console.error('Error fetching keyword sets:', error);
            throw new Error(`キーワードセットの取得に失敗しました: ${error.message}`);
        }

        return data || [];
    }

    /**
     * キーワードセットを追加または更新
     */
    async saveKeywordSet(set: Partial<KeywordSet>): Promise<KeywordSet | null> {
        if (!supabase) return null;

        if (set.id) {
            // 更新
            const { data, error } = await supabase
                .from('keyword_sets')
                .update({
                    name: set.name,
                    keywords: set.keywords,
                    updated_at: new Date().toISOString()
                })
                .eq('id', set.id)
                .eq('account_id', getRequiredAccountId())
                .select()
                .single();

            if (error) throw error;
            return data;
        } else {
            // 新規作成
            const { data, error } = await supabase
                .from('keyword_sets')
                .insert({
                    account_id: getRequiredAccountId(),
                    name: set.name,
                    keywords: set.keywords
                })
                .select()
                .single();

            if (error) throw error;
            return data;
        }
    }

    /**
     * キーワードセットを削除
     */
    async deleteKeywordSet(id: string): Promise<void> {
        if (!supabase) return;

        const { error } = await supabase
            .from('keyword_sets')
            .delete()
            .eq('id', id)
            .eq('account_id', getRequiredAccountId());

        if (error) {
            console.error('Error deleting keyword set:', error);
            throw new Error(`キーワードセットの削除に失敗しました: ${error.message}`);
        }
    }
}

export const keywordSetService = new KeywordSetService();
