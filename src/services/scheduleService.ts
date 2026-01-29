import { supabase } from './supabaseClient';
import { ScheduleSetting } from '../types';

class ScheduleService {
    /**
     * スケジュールを新規作成
     */
    async createSchedule(schedule: Omit<ScheduleSetting, 'id' | 'created_at' | 'updated_at'>): Promise<ScheduleSetting> {
        if (!supabase) {
            throw new Error('Supabase is not initialized');
        }

        const { data, error } = await supabase
            .from('schedule_settings')
            .insert({
                ai_config_id: schedule.ai_config_id,
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
            })
            .select()
            .single();

        if (error) {
            console.error('Error creating schedule:', error);
            throw new Error(`スケジュールの作成に失敗しました: ${error.message}`);
        }

        return data;
    }

    /**
     * 全スケジュールを取得
     */
    async getSchedules(): Promise<ScheduleSetting[]> {
        if (!supabase) {
            console.error('getSchedules: Supabase is not initialized');
            throw new Error('Supabase is not initialized');
        }

        console.log('getSchedules: Fetching schedules...');
        const { data, error } = await supabase
            .from('schedule_settings')
            .select('*');
        // .order('created_at', { ascending: false });

        if (error) {
            console.error('getSchedules: Error fetching schedules:', error);
            throw new Error(`スケジュールの取得に失敗しました: ${error.message}`);
        }

        console.log('getSchedules: Fetched data:', data);
        return data || [];
    }

    /**
     * 特定のスケジュールを取得
     */
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

    /**
     * スケジュールを更新
     */
    async updateSchedule(id: string, updates: Partial<ScheduleSetting>): Promise<ScheduleSetting> {
        if (!supabase) {
            throw new Error('Supabase is not initialized');
        }

        // Clean up date and uuid fields
        const cleanUpdates = { ...updates };
        if (cleanUpdates.start_date === '') cleanUpdates.start_date = null as any;
        if (cleanUpdates.end_date === '') cleanUpdates.end_date = null as any;
        if (cleanUpdates.prompt_set_id === '') cleanUpdates.prompt_set_id = null as any;
        if (cleanUpdates.chatwork_room_id === '') cleanUpdates.chatwork_room_id = null as any;

        const { data, error } = await supabase
            .from('schedule_settings')
            .update(cleanUpdates)
            .eq('id', id)
            .select()
            .single();

        if (error) {
            console.error('Error updating schedule:', error);
            throw new Error(`スケジュールの更新に失敗しました: ${error.message}`);
        }

        return data;
    }

    /**
     * スケジュールを削除
     */
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

    /**
     * スケジュールのステータスを切り替え
     */
    async toggleScheduleStatus(id: string): Promise<ScheduleSetting> {
        const schedule = await this.getScheduleById(id);
        if (!schedule) {
            throw new Error('スケジュールが見つかりません');
        }

        return this.updateSchedule(id, { status: !schedule.status });
    }

    /**
     * WordPress設定IDに紐づくスケジュールを取得
     */
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

    /**
     * AI設定IDに紐づくスケジュールを取得
     */
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
    /**
     * 特定のスケジュールで使用済みのキーワードを取得
     */
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
            // エラーでもUIを壊さないために空配列を返す
            return [];
        }

        return data.map(item => item.keyword_used);
    }
}

export const scheduleService = new ScheduleService();
