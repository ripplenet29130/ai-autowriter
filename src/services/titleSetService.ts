import { supabase } from './supabaseClient';
import { TitleSet } from '../types';
import { getCurrentAccountId, getRequiredAccountId } from './accountScope';

class TitleSetService {
    /**
     * タイトルセット一覧を取得
     */
    async getTitleSets(): Promise<TitleSet[]> {
        if (!supabase) return [];

        const accountId = getCurrentAccountId();
        let query = supabase
            .from('title_sets')
            .select('*')
            .order('created_at', { ascending: false });

        if (accountId) {
            query = query.eq('account_id', accountId);
        }

        const { data, error } = await query;

        if (error) {
            console.error('Error fetching title sets:', error);
            throw new Error(`タイトルセットの取得に失敗しました: ${error.message}`);
        }

        return data || [];
    }

    /**
     * タイトルセットを追加または更新
     */
    async saveTitleSet(set: Partial<TitleSet>): Promise<TitleSet | null> {
        if (!supabase) return null;

        if (set.id) {
            // 更新
            const { data, error } = await supabase
                .from('title_sets')
                .update({
                    name: set.name,
                    titles: set.titles,
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
                .from('title_sets')
                .insert({
                    account_id: getRequiredAccountId(),
                    name: set.name,
                    titles: set.titles
                })
                .select()
                .single();

            if (error) throw error;
            return data;
        }
    }

    /**
     * タイトルセットを削除
     */
    async deleteTitleSet(id: string): Promise<void> {
        if (!supabase) return;

        const { error } = await supabase
            .from('title_sets')
            .delete()
            .eq('id', id)
            .eq('account_id', getRequiredAccountId());

        if (error) {
            console.error('Error deleting title set:', error);
            throw new Error(`タイトルセットの削除に失敗しました: ${error.message}`);
        }
    }
}

export const titleSetService = new TitleSetService();
