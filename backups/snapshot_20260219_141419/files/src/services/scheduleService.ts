import { supabase } from './supabaseClient';
import { ScheduleSetting } from '../types';

class ScheduleService {
    private readonly maxSchemaRetryCount = 12;

    private extractMissingColumn(error: any): string | null {
        const message = String(error?.message || '');
        const match = message.match(/Could not find the '([^']+)' column/i);
        return match?.[1] || null;
    }

    async createSchedule(schedule: Omit<ScheduleSetting, 'id' | 'created_at' | 'updated_at'>): Promise<ScheduleSetting> {
        if (!supabase) {
            throw new Error('Supabase is not initialized');
        }

        let insertPayload: Record<string, any> = {
            ai_config_id: schedule.ai_config_id,
            ai_provider_override: schedule.ai_provider_override || null,
            ai_model_override: schedule.ai_model_override || null,
            wp_config_id: schedule.wp_config_id,
            post_time: schedule.post_time,
            frequency: schedule.frequency,
            status: schedule.status,
            keyword: schedule.keyword,
            related_keywords: schedule.related_keywords,
            post_status: schedule.post_status,
            start_date: schedule.start_date || null,
            end_date: schedule.end_date || null,
            chatwork_room_id: schedule.chatwork_room_id || null,
            prompt_set_id: schedule.prompt_set_id || null,
            target_word_count: schedule.target_word_count,
            writing_tone: schedule.writing_tone,
            keyword_set_id: schedule.keyword_set_id || null,
            title_set_id: schedule.title_set_id || null,
            generation_mode: schedule.generation_mode || 'keyword',
            enable_fact_check: schedule.enable_fact_check || false,
            fact_check_note: schedule.fact_check_note || null,
            image_generation_enabled: schedule.image_generation_enabled ?? false,
            images_per_article: schedule.images_per_article ?? 0,
        };

        for (let i = 0; i < this.maxSchemaRetryCount; i += 1) {
            const { data, error } = await supabase
                .from('schedule_settings')
                .insert(insertPayload)
                .select()
                .single();

            if (!error) {
                return data;
            }

            const missingColumn = this.extractMissingColumn(error);
            if (missingColumn && Object.prototype.hasOwnProperty.call(insertPayload, missingColumn)) {
                console.warn(`createSchedule: retrying without unknown column "${missingColumn}"`);
                const nextPayload = { ...insertPayload };
                delete nextPayload[missingColumn];
                insertPayload = nextPayload;
                continue;
            }

            console.error('Error creating schedule:', error);
            throw new Error(`スケジュールの作成に失敗しました: ${error.message}`);
        }

        throw new Error('スケジュールの作成に失敗しました: DBスキーマが古い可能性があります。マイグレーションを適用してください。');
    }

    async getSchedules(): Promise<ScheduleSetting[]> {
        if (!supabase) {
            console.error('getSchedules: Supabase is not initialized');
            throw new Error('Supabase is not initialized');
        }

        console.log('getSchedules: Fetching schedules...');
        const { data, error } = await supabase
            .from('schedule_settings')
            .select('*');

        if (error) {
            console.error('getSchedules: Error fetching schedules:', error);
            throw new Error(`スケジュールの取得に失敗しました: ${error.message}`);
        }

        console.log('getSchedules: Fetched data:', data);
        return data || [];
    }

    async getScheduleById(id: string): Promise<ScheduleSetting | null> {
        if (!supabase) {
            throw new Error('Supabase is not initialized');
        }

        const { data, error } = await supabase
            .from('schedule_settings')
            .select('*')
            .eq('id', id)
            .single();

        if (error) {
            console.error('Error fetching schedule:', error);
            return null;
        }

        return data;
    }

    async updateSchedule(id: string, updates: Partial<ScheduleSetting>): Promise<ScheduleSetting> {
        if (!supabase) {
            throw new Error('Supabase is not initialized');
        }

        const cleanUpdates = { ...updates };
        if (cleanUpdates.start_date === '') cleanUpdates.start_date = null as any;
        if (cleanUpdates.end_date === '') cleanUpdates.end_date = null as any;
        if (cleanUpdates.prompt_set_id === '') cleanUpdates.prompt_set_id = null as any;
        if (cleanUpdates.chatwork_room_id === '') cleanUpdates.chatwork_room_id = null as any;
        if (cleanUpdates.keyword_set_id === '') cleanUpdates.keyword_set_id = null as any;
        if (cleanUpdates.title_set_id === '') cleanUpdates.title_set_id = null as any;
        if (cleanUpdates.ai_provider_override === '') cleanUpdates.ai_provider_override = null as any;
        if (cleanUpdates.ai_model_override === '') cleanUpdates.ai_model_override = null as any;

        let updatePayload: Record<string, any> = { ...cleanUpdates };

        for (let i = 0; i < this.maxSchemaRetryCount; i += 1) {
            const { data, error } = await supabase
                .from('schedule_settings')
                .update(updatePayload)
                .eq('id', id)
                .select()
                .single();

            if (!error) {
                return data;
            }

            const missingColumn = this.extractMissingColumn(error);
            if (missingColumn && Object.prototype.hasOwnProperty.call(updatePayload, missingColumn)) {
                console.warn(`updateSchedule: retrying without unknown column "${missingColumn}"`);
                const nextPayload = { ...updatePayload };
                delete nextPayload[missingColumn];
                updatePayload = nextPayload;
                continue;
            }

            console.error('Error updating schedule:', error);
            throw new Error(`スケジュールの更新に失敗しました: ${error.message}`);
        }

        throw new Error('スケジュールの更新に失敗しました: DBスキーマが古い可能性があります。マイグレーションを適用してください。');
    }

    async deleteSchedule(id: string): Promise<void> {
        if (!supabase) {
            throw new Error('Supabase is not initialized');
        }

        const { error } = await supabase
            .from('schedule_settings')
            .delete()
            .eq('id', id);

        if (error) {
            console.error('Error deleting schedule:', error);
            throw new Error(`スケジュールの削除に失敗しました: ${error.message}`);
        }
    }

    async toggleScheduleStatus(id: string): Promise<ScheduleSetting> {
        const schedule = await this.getScheduleById(id);
        if (!schedule) {
            throw new Error('対象のスケジュールが見つかりません');
        }

        return this.updateSchedule(id, { status: !schedule.status });
    }

    async getSchedulesByWpConfigId(wpConfigId: string): Promise<ScheduleSetting[]> {
        if (!supabase) {
            throw new Error('Supabase is not initialized');
        }

        const { data, error } = await supabase
            .from('schedule_settings')
            .select('*')
            .eq('wp_config_id', wpConfigId)
            .order('created_at', { ascending: false });

        if (error) {
            console.error('Error fetching schedules by wp_config_id:', error);
            throw new Error(`スケジュールの取得に失敗しました: ${error.message}`);
        }

        return data || [];
    }

    async getSchedulesByAiConfigId(aiConfigId: string): Promise<ScheduleSetting[]> {
        if (!supabase) {
            throw new Error('Supabase is not initialized');
        }

        const { data, error } = await supabase
            .from('schedule_settings')
            .select('*')
            .eq('ai_config_id', aiConfigId)
            .order('created_at', { ascending: false });

        if (error) {
            console.error('Error fetching schedules by ai_config_id:', error);
            throw new Error(`スケジュールの取得に失敗しました: ${error.message}`);
        }

        return data || [];
    }

    async getUsedKeywords(scheduleId: string): Promise<string[]> {
        if (!supabase) {
            throw new Error('Supabase is not initialized');
        }

        const { data, error } = await supabase
            .from('execution_history')
            .select('keyword_used')
            .eq('schedule_id', scheduleId);

        if (error) {
            console.error('Error fetching used keywords:', error);
            return [];
        }

        return (data || []).map((item: any) => item.keyword_used);
    }

    async restoreKeyword(scheduleId: string, keyword: string): Promise<void> {
        if (!supabase) {
            throw new Error('Supabase is not initialized');
        }

        const normalized = String(keyword || '').trim();
        if (!normalized) return;

        const { error } = await supabase
            .from('execution_history')
            .delete()
            .eq('schedule_id', scheduleId)
            .eq('keyword_used', normalized);

        if (error) {
            console.error('Error restoring keyword:', error);
            throw new Error(`キーワード復活に失敗しました: ${error.message}`);
        }
    }

    async resetUsedKeywords(scheduleId: string, keywords: string[]): Promise<void> {
        if (!supabase) {
            throw new Error('Supabase is not initialized');
        }

        const targets = (keywords || [])
            .map((k) => String(k || '').trim())
            .filter((k) => k.length > 0);

        if (targets.length === 0) return;

        const { error } = await supabase
            .from('execution_history')
            .delete()
            .eq('schedule_id', scheduleId)
            .in('keyword_used', targets);

        if (error) {
            console.error('Error resetting used keywords:', error);
            throw new Error(`キーワード消化の解除に失敗しました: ${error.message}`);
        }
    }

    async getUsedTitles(scheduleId: string): Promise<string[]> {
        if (!supabase) {
            throw new Error('Supabase is not initialized');
        }

        const { data, error } = await supabase
            .from('execution_history')
            .select('article_title')
            .eq('schedule_id', scheduleId);

        if (error) {
            console.error('Error fetching used titles:', error);
            return [];
        }

        return (data || []).map((item: any) => item.article_title);
    }

    async getLastExecution(scheduleId: string): Promise<string | null> {
        if (!supabase) {
            throw new Error('Supabase is not initialized');
        }

        const { data, error } = await supabase
            .from('execution_history')
            .select('executed_at')
            .eq('schedule_id', scheduleId)
            .order('executed_at', { ascending: false })
            .limit(1)
            .maybeSingle();

        if (error || !data) {
            return null;
        }

        return data.executed_at;
    }
}

export const scheduleService = new ScheduleService();
