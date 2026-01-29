import { supabase } from './supabaseClient';
import { PromptSet } from '../types';

class PromptSetService {
    /**
     * プロンプトセット一覧を取得
     */
    async getPromptSets(): Promise<PromptSet[]> {
        if (!supabase) return [];

        const { data, error } = await supabase
            .from('prompt_sets')
            .select('*')
            .order('created_at', { ascending: false });

        if (error) {
            console.error('Error fetching prompt sets:', error);
            // テーブルが存在しない場合は空配列を返す（初回実行時など）
            if (error.code === 'PGRST116' || error.message.includes('relation "prompt_sets" does not exist')) {
                return [];
            }
            throw new Error(`プロンプトセットの取得に失敗しました: ${error.message}`);
        }

        return (data || []).map(item => ({
            id: item.id,
            name: item.name,
            customInstructions: item.custom_instructions,
            isDefault: item.is_default,
            createdAt: item.created_at
        }));
    }

    /**
     * プロンプトセットを追加または更新
     */
    async savePromptSet(set: Partial<PromptSet>): Promise<PromptSet | null> {
        if (!supabase) return null;

        const dbData = {
            id: set.id,
            name: set.name,
            custom_instructions: set.customInstructions,
            is_default: set.isDefault,
            updated_at: new Date().toISOString()
        };

        const { data, error } = await supabase
            .from('prompt_sets')
            .upsert(dbData)
            .select()
            .single();

        if (error) {
            console.error('Error saving prompt set:', error);
            throw error;
        }

        return {
            id: data.id,
            name: data.name,
            customInstructions: data.custom_instructions,
            isDefault: data.is_default,
            createdAt: data.created_at
        };
    }

    /**
     * プロンプトセットを削除
     */
    async deletePromptSet(id: string): Promise<void> {
        if (!supabase) return;

        const { error } = await supabase
            .from('prompt_sets')
            .delete()
            .eq('id', id);

        if (error) {
            console.error('Error deleting prompt set:', error);
            throw new Error(`プロンプトセットの削除に失敗しました: ${error.message}`);
        }
    }
}

export const promptSetService = new PromptSetService();
