import { supabase } from './supabaseClient';
import { ScheduleSetting } from '../types';
import { getCurrentAccountId, getRequiredAccountId } from './accountScope';

class ScheduleService {
    private readonly maxSchemaRetryCount = 48;
    private readonly schemaOptionalColumns = [
        'user_id',
        'ai_provider_override',
        'ai_model_override',
        'image_generation_enabled',
        'images_per_article',
        'chatwork_message_template',
        'keyword_set_id',
        'title_set_id',
        'generation_mode',
        'enable_fact_check',
        'fact_check_note',
        'fact_check_alert_chatwork_room_id',
        'fact_check_notify_on_anomaly',
        'fact_check_notify_on_every_run',
    ] as const;

    private isMissingTableError(error: any, tableName: string): boolean {
        const text = this.getErrorText(error).toLowerCase();
        const table = String(tableName || '').toLowerCase();
        if (!table) return false;
        return text.includes(`relation "${table}" does not exist`)
            || text.includes(`could not find the table '${table}'`)
            || text.includes(`table "${table}" does not exist`)
            || text.includes(`table '${table}' does not exist`);
    }

    private async ensureWpConfigReference(wpConfigId: string): Promise<void> {
        if (!supabase) {
            throw new Error('Supabase is not initialized');
        }
        const targetId = String(wpConfigId || '').trim();
        const accountId = getCurrentAccountId();
        if (!targetId) {
            throw new Error('WordPress設定IDが空です。設定を選択し直してください。');
        }

        let currentWpConfigQuery = supabase
            .from('wp_configs')
            .select('id')
            .eq('id', targetId)
            .limit(1);

        if (accountId) {
            currentWpConfigQuery = currentWpConfigQuery.eq('account_id', accountId);
        }

        const { data: currentWpConfig, error: currentWpConfigError } = await currentWpConfigQuery.maybeSingle();

        if (!currentWpConfigError && currentWpConfig?.id) {
            return;
        }

        if (currentWpConfigError && !this.isMissingTableError(currentWpConfigError, 'wp_configs')) {
            throw new Error(`wp_configsの確認に失敗しました: ${this.getErrorText(currentWpConfigError)}`);
        }

        // If wp_configs table does not exist, there is no compatibility action needed.
        if (currentWpConfigError && this.isMissingTableError(currentWpConfigError, 'wp_configs')) {
            return;
        }

        // Compatibility path: copy matching row from legacy wordpress_configs into wp_configs.
        let legacyQuery = supabase
            .from('wordpress_configs')
            .select('id, name, url, username, password, category, is_active, post_type, style_reference_url')
            .eq('id', targetId)
            .limit(1);

        if (accountId) {
            legacyQuery = legacyQuery.eq('account_id', accountId);
        }

        const { data: legacyRow, error: legacyError } = await legacyQuery.maybeSingle();

        if (legacyError) {
            if (this.isMissingTableError(legacyError, 'wordpress_configs')) {
                throw new Error(
                    `選択したWordPress設定(${targetId})が wp_configs に存在しません。` +
                    ' WordPress設定を開いて保存し直してください。'
                );
            }
            throw new Error(`wordpress_configsの確認に失敗しました: ${this.getErrorText(legacyError)}`);
        }

        if (!legacyRow?.id) {
            throw new Error(
                `選択したWordPress設定(${targetId})が wp_configs に存在しません。` +
                ' WordPress設定を開いて保存し直してください。'
            );
        }

        let compatPayload: Record<string, any> = {
            id: legacyRow.id,
            account_id: accountId,
            name: legacyRow.name,
            url: legacyRow.url,
            username: legacyRow.username,
            password: legacyRow.password,
            category: legacyRow.category ?? '',
            is_active: legacyRow.is_active ?? true,
            post_type: legacyRow.post_type ?? 'posts',
            style_reference_url: legacyRow.style_reference_url ?? null,
        };

        const maxRetries = Math.max(8, Object.keys(compatPayload).length + 1);
        for (let i = 0; i < maxRetries; i += 1) {
            const { error } = await supabase
                .from('wp_configs')
                .upsert(compatPayload, { onConflict: 'id' });

            if (!error) {
                return;
            }

            if (this.isMissingTableError(error, 'wp_configs')) {
                // Table disappeared between checks; nothing else to do.
                return;
            }

            const missingColumn = this.extractMissingColumn(error);
            if (missingColumn && Object.prototype.hasOwnProperty.call(compatPayload, missingColumn)) {
                const nextPayload = { ...compatPayload };
                delete nextPayload[missingColumn];
                compatPayload = nextPayload;
                continue;
            }

            throw new Error(`wp_configsへの互換同期に失敗しました: ${this.getErrorText(error)}`);
        }

        throw new Error('wp_configsへの互換同期に失敗しました。DBスキーマを確認してください。');
    }

    private ensureAutoFixEnabledPersisted(requestedEnabled: boolean, row: any): void {
        if (!requestedEnabled) return;
        if (row?.fact_check_auto_fix_enabled === true) return;
        throw new Error(
            '「ファクトチェック後に自動修正」をONに保存できませんでした。DBスキーマが古い可能性があります。schedule_settings.fact_check_auto_fix_enabled を追加してください。'
        );
    }

    private getErrorText(error: any): string {
        return [
            String(error?.message || ''),
            String(error?.details || ''),
            String(error?.hint || ''),
            String(error?.error_description || ''),
        ].join(' | ');
    }

    private extractMissingColumn(error: any): string | null {
        const message = this.getErrorText(error);
        const patterns = [
            /Could not find the '([^']+)' column/i,
            /column ["']([^"']+)["'] of relation ["'][^"']+["'] does not exist/i,
            /column ["']?([a-zA-Z0-9_]+)["']? does not exist/i,
            /record ["'][^"']+["'] has no field ["']([^"']+)["']/i,
            /schema cache.*column ["']([^"']+)["']/i,
        ];

        for (const pattern of patterns) {
            const match = message.match(pattern);
            if (match?.[1]) return match[1];
        }
        return null;
    }

    private isSchemaMismatchError(error: any): boolean {
        const text = this.getErrorText(error).toLowerCase();
        return text.includes('schema cache')
            || (text.includes('column') && text.includes('does not exist'))
            || text.includes('could not find the');
    }

    private dropFirstOptionalColumn(payload: Record<string, any>): string | null {
        for (const column of this.schemaOptionalColumns) {
            if (Object.prototype.hasOwnProperty.call(payload, column)) {
                delete payload[column];
                return column;
            }
        }
        return null;
    }

    async createSchedule(schedule: Omit<ScheduleSetting, 'id' | 'created_at' | 'updated_at'>): Promise<ScheduleSetting> {
        if (!supabase) {
            throw new Error('Supabase is not initialized');
        }

        await this.ensureWpConfigReference(schedule.wp_config_id);
        const accountId = getRequiredAccountId();

        const { data: existingSchedules, error: existingSchedulesError } = await supabase
            .from('schedule_settings')
            .select('id')
            .eq('account_id', accountId)
            .order('created_at', { ascending: true })
            .limit(1);

        if (existingSchedulesError) {
            throw new Error(`既存スケジュールの確認に失敗しました: ${this.getErrorText(existingSchedulesError)}`);
        }

        if (existingSchedules && existingSchedules.length > 0) {
            return this.updateSchedule(existingSchedules[0].id, schedule);
        }

        let currentUserId: string | null = null;
        try {
            const {
                data: { user },
            } = await supabase.auth.getUser();
            currentUserId = user?.id || null;
        } catch {
            currentUserId = null;
        }

        const requestedAutoFixEnabled = schedule.fact_check_auto_fix_enabled === true;
        let insertPayload: Record<string, any> = {
            user_id: currentUserId,
            account_id: accountId,
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
            fact_check_auto_fix_enabled: schedule.fact_check_auto_fix_enabled ?? null,
            fact_check_alert_chatwork_room_id: schedule.fact_check_alert_chatwork_room_id || null,
            fact_check_notify_on_anomaly: schedule.fact_check_notify_on_anomaly ?? true,
            fact_check_notify_on_every_run: schedule.fact_check_notify_on_every_run ?? false,
            image_generation_enabled: schedule.image_generation_enabled ?? false,
            images_per_article: schedule.images_per_article ?? 0,
        };

        const maxRetries = Math.max(this.maxSchemaRetryCount, Object.keys(insertPayload).length + 2);
        for (let i = 0; i < maxRetries; i += 1) {
            if (Object.keys(insertPayload).length === 0) {
                throw new Error('スケジュールの作成に失敗しました: 送信可能なカラムがありません。DBスキーマを更新してください。');
            }

            const { data, error } = await supabase
                .from('schedule_settings')
                .insert(insertPayload)
                .select()
                .single();

            if (!error) {
                this.ensureAutoFixEnabledPersisted(requestedAutoFixEnabled, data);
                return data;
            }

            const missingColumn = this.extractMissingColumn(error);
            if (missingColumn && Object.prototype.hasOwnProperty.call(insertPayload, missingColumn)) {
                if (missingColumn === 'fact_check_auto_fix_enabled' && requestedAutoFixEnabled) {
                    throw new Error(
                        '「ファクトチェック後に自動修正」をONに保存できませんでした。DBスキーマが古い可能性があります。schedule_settings.fact_check_auto_fix_enabled を追加してください。'
                    );
                }
                console.warn(`createSchedule: retrying without unknown column "${missingColumn}"`);
                const nextPayload = { ...insertPayload };
                delete nextPayload[missingColumn];
                insertPayload = nextPayload;
                continue;
            }

            if (this.isSchemaMismatchError(error)) {
                const nextPayload = { ...insertPayload };
                const dropped = this.dropFirstOptionalColumn(nextPayload);
                if (dropped) {
                    console.warn(`createSchedule: schema mismatch fallback dropped optional column "${dropped}"`);
                    insertPayload = nextPayload;
                    continue;
                }
            }

            console.error('Error creating schedule:', error);
            throw new Error(`スケジュールの作成に失敗しました: ${this.getErrorText(error)}`);
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
            .select('*')
            .eq('account_id', getRequiredAccountId());

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
            .eq('account_id', getRequiredAccountId())
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

        if (typeof updates.wp_config_id === 'string' && updates.wp_config_id.trim().length > 0) {
            await this.ensureWpConfigReference(updates.wp_config_id);
        }
        const accountId = getRequiredAccountId();

        let currentUserId: string | null = null;
        try {
            const {
                data: { user },
            } = await supabase.auth.getUser();
            currentUserId = user?.id || null;
        } catch {
            currentUserId = null;
        }

        const requestedAutoFixEnabled = updates.fact_check_auto_fix_enabled === true;
        const cleanUpdates = { ...updates };
        if (!('user_id' in cleanUpdates) && currentUserId) {
            (cleanUpdates as any).user_id = currentUserId;
        }
        if (cleanUpdates.start_date === '') cleanUpdates.start_date = null as any;
        if (cleanUpdates.end_date === '') cleanUpdates.end_date = null as any;
        if (cleanUpdates.prompt_set_id === '') cleanUpdates.prompt_set_id = null as any;
        if (cleanUpdates.chatwork_room_id === '') cleanUpdates.chatwork_room_id = null as any;
        if (cleanUpdates.fact_check_alert_chatwork_room_id === '') cleanUpdates.fact_check_alert_chatwork_room_id = null as any;
        if (cleanUpdates.keyword_set_id === '') cleanUpdates.keyword_set_id = null as any;
        if (cleanUpdates.title_set_id === '') cleanUpdates.title_set_id = null as any;
        if (cleanUpdates.ai_provider_override === '') cleanUpdates.ai_provider_override = null as any;
        if (cleanUpdates.ai_model_override === '') cleanUpdates.ai_model_override = null as any;

        let updatePayload: Record<string, any> = { ...cleanUpdates };
        updatePayload.account_id = accountId;

        const maxRetries = Math.max(this.maxSchemaRetryCount, Object.keys(updatePayload).length + 2);
        for (let i = 0; i < maxRetries; i += 1) {
            if (Object.keys(updatePayload).length === 0) {
                throw new Error('スケジュールの更新に失敗しました: 更新可能なカラムがありません。DBスキーマを更新してください。');
            }

            const { data, error } = await supabase
                .from('schedule_settings')
                .update(updatePayload)
                .eq('id', id)
                .eq('account_id', accountId)
                .select()
                .single();

            if (!error) {
                this.ensureAutoFixEnabledPersisted(requestedAutoFixEnabled, data);
                return data;
            }

            const missingColumn = this.extractMissingColumn(error);
            if (missingColumn && Object.prototype.hasOwnProperty.call(updatePayload, missingColumn)) {
                if (missingColumn === 'fact_check_auto_fix_enabled' && requestedAutoFixEnabled) {
                    throw new Error(
                        '「ファクトチェック後に自動修正」をONに保存できませんでした。DBスキーマが古い可能性があります。schedule_settings.fact_check_auto_fix_enabled を追加してください。'
                    );
                }
                console.warn(`updateSchedule: retrying without unknown column "${missingColumn}"`);
                const nextPayload = { ...updatePayload };
                delete nextPayload[missingColumn];
                updatePayload = nextPayload;
                continue;
            }

            if (this.isSchemaMismatchError(error)) {
                const nextPayload = { ...updatePayload };
                const dropped = this.dropFirstOptionalColumn(nextPayload);
                if (dropped) {
                    console.warn(`updateSchedule: schema mismatch fallback dropped optional column "${dropped}"`);
                    updatePayload = nextPayload;
                    continue;
                }
            }

            console.error('Error updating schedule:', error);
            throw new Error(`スケジュールの更新に失敗しました: ${this.getErrorText(error)}`);
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
            .eq('id', id)
            .eq('account_id', getRequiredAccountId());

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
            .eq('account_id', getRequiredAccountId())
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
            .eq('account_id', getRequiredAccountId())
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
            .eq('schedule_id', scheduleId)
            .eq('account_id', getRequiredAccountId());

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
            .eq('account_id', getRequiredAccountId())
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
            .eq('account_id', getRequiredAccountId())
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
            .eq('schedule_id', scheduleId)
            .eq('account_id', getRequiredAccountId());

        if (error) {
            console.error('Error fetching used titles:', error);
            return [];
        }

        return (data || []).map((item: any) => item.article_title);
    }

    async restoreTitle(scheduleId: string, title: string): Promise<void> {
        if (!supabase) {
            throw new Error('Supabase is not initialized');
        }

        const normalized = String(title || '').trim();
        if (!normalized) return;

        const { error } = await supabase
            .from('execution_history')
            .delete()
            .eq('schedule_id', scheduleId)
            .eq('account_id', getRequiredAccountId())
            .eq('article_title', normalized);

        if (error) {
            console.error('Error restoring title:', error);
            throw new Error(`タイトルの復活に失敗しました: ${error.message}`);
        }
    }

    async markTitleUsed(scheduleId: string, title: string): Promise<void> {
        if (!supabase) {
            throw new Error('Supabase is not initialized');
        }

        const normalized = String(title || '').trim();
        if (!normalized) return;

        const accountId = getRequiredAccountId();
        const { data: existing, error: existingError } = await supabase
            .from('execution_history')
            .select('id')
            .eq('schedule_id', scheduleId)
            .eq('account_id', accountId)
            .eq('article_title', normalized)
            .limit(1);

        if (existingError) {
            console.error('Error checking used title:', existingError);
            throw new Error(`タイトル消化状態の確認に失敗しました: ${existingError.message}`);
        }

        if (existing && existing.length > 0) return;

        const { error } = await supabase
            .from('execution_history')
            .insert({
                schedule_id: scheduleId,
                account_id: accountId,
                article_title: normalized,
                keyword_used: '',
                wordpress_post_id: '',
                status: 'manual_used',
                error_message: null,
            });

        if (error) {
            console.error('Error marking title used:', error);
            throw new Error(`タイトルを使用済みにできませんでした: ${error.message}`);
        }
    }

    async resetUsedTitles(scheduleId: string, titles: string[]): Promise<void> {
        if (!supabase) {
            throw new Error('Supabase is not initialized');
        }

        const targets = (titles || [])
            .map((title) => String(title || '').trim())
            .filter((title) => title.length > 0);

        if (targets.length === 0) return;

        const { error } = await supabase
            .from('execution_history')
            .delete()
            .eq('schedule_id', scheduleId)
            .eq('account_id', getRequiredAccountId())
            .in('article_title', targets);

        if (error) {
            console.error('Error resetting used titles:', error);
            throw new Error(`タイトル消化の解除に失敗しました: ${error.message}`);
        }
    }

    async getLastExecution(scheduleId: string): Promise<string | null> {
        if (!supabase) {
            throw new Error('Supabase is not initialized');
        }
        const accountId = getRequiredAccountId();
        const { data, error } = await supabase
            .from('execution_history')
            .select('executed_at')
            .eq('schedule_id', scheduleId)
            .eq('account_id', accountId)
            .order('executed_at', { ascending: false })
            .limit(1)
            .maybeSingle();

        if (!error && data) {
            return data.executed_at;
        }

        const errorMessage = String(error?.message || error?.details || '').toLowerCase();
        if (errorMessage.includes('account_id')) {
            const fallback = await supabase
                .from('execution_history')
                .select('executed_at')
                .eq('schedule_id', scheduleId)
                .order('executed_at', { ascending: false })
                .limit(1)
                .maybeSingle();
            if (!fallback.error && fallback.data) {
                return fallback.data.executed_at;
            }
        }

        if (error) {
            console.error('Error fetching last execution:', error);
            return null;
        }

        return null;
    }
}

export const scheduleService = new ScheduleService();
