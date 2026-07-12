import { supabase } from './supabaseClient';
import { WordPressConfig, AIConfig, ScheduleSettings } from '../types';
import {
  getRequiredAccountId,
  getRequiredUserId,
  scopeMutationToCurrentUser,
  scopeQueryToCurrentUser,
} from './accountScope';

class SupabaseSchedulerService {
  private isMissingStyleReferenceColumnError(error: any): boolean {
    return Boolean(
      error?.message?.includes("Could not find the 'style_reference_url' column") ||
      (error?.message?.includes('style_reference_url') && error?.code === 'PGRST204')
    );
  }

  async saveWordPressConfig(config: WordPressConfig): Promise<string> {
    if (!supabase) {
      console.warn('Supabase not initialized');
      return config.id;
    }

    const { scheduleSettings, ...wpConfig } = config;
    const configId = wpConfig.id;
    const normalizedCategory = wpConfig.category || wpConfig.defaultCategory || '';
    const normalizedPostType = wpConfig.postType || 'posts';
    const normalizedStyleReferenceUrl = wpConfig.styleReferenceUrl?.trim() || null;
    const accountId = getRequiredAccountId();
    const userId = getRequiredUserId();

    const { data: account } = await supabase
      .from('accounts')
      .select('wordpress_site_limit')
      .eq('id', accountId)
      .maybeSingle();

    const { data: existingConfig } = await supabase
      .from('wordpress_configs')
      .select('id')
      .eq('id', configId)
      .eq('account_id', accountId)
      .eq('user_id', userId)
      .maybeSingle();

    if (!existingConfig) {
      const { count, error: countError } = await supabase
        .from('wordpress_configs')
        .select('*', { count: 'exact', head: true })
        .eq('account_id', accountId)
        .eq('user_id', userId);

      if (countError) {
        console.error('Error checking WordPress config limit:', countError);
        throw new Error(`WordPress登録数の確認に失敗しました: ${countError.message}`);
      }

      const siteLimit = account?.wordpress_site_limit ?? 1;
      if ((count ?? 0) >= siteLimit) {
        throw new Error(`WordPress登録上限に達しています。現在の上限は${siteLimit}件です。`);
      }
    }

    const wordpressConfigData = {
      id: configId,
      account_id: accountId,
      user_id: userId,
      name: wpConfig.name,
      url: wpConfig.url,
      username: wpConfig.username,
      password: wpConfig.applicationPassword,
      category: normalizedCategory,
      post_type: normalizedPostType,
      style_reference_url: normalizedStyleReferenceUrl,
      is_active: wpConfig.isActive,
    };

    let result = await supabase
      .from('wordpress_configs')
      .upsert(wordpressConfigData)
      .select()
      .single();

    if (this.isMissingStyleReferenceColumnError(result.error)) {
      const { style_reference_url: _styleReferenceUrl, ...compatibleData } = wordpressConfigData;
      result = await supabase
        .from('wordpress_configs')
        .upsert(compatibleData)
        .select()
        .single();
    }

    if (result.error) {
      console.error('Error saving WordPress config:', result.error);
      throw new Error(`WordPress設定の保存に失敗しました: ${result.error.message}`);
    }

    const legacyConfigData = {
      id: configId,
      account_id: accountId,
      user_id: userId,
      name: wpConfig.name,
      url: wpConfig.url,
      username: wpConfig.username,
      app_password: wpConfig.applicationPassword,
      default_category: normalizedCategory,
      post_type: normalizedPostType,
      style_reference_url: normalizedStyleReferenceUrl,
      is_active: wpConfig.isActive,
    };

    let legacySyncResult = await supabase
      .from('wp_configs')
      .upsert(legacyConfigData);

    if (this.isMissingStyleReferenceColumnError(legacySyncResult.error)) {
      const { style_reference_url: _styleReferenceUrl, ...compatibleLegacyData } = legacyConfigData;
      legacySyncResult = await supabase
        .from('wp_configs')
        .upsert(compatibleLegacyData);
    }

    if (legacySyncResult.error) {
      console.error('Error syncing wp_configs:', legacySyncResult.error);
      throw new Error(`wp_configs との同期に失敗しました: ${legacySyncResult.error.message}`);
    }

    if (scheduleSettings) {
      await this.saveScheduleSettings(configId, scheduleSettings);
    }

    return result.data.id;
  }

  async saveScheduleSettings(wpConfigId: string, settings: ScheduleSettings): Promise<void> {
    if (!supabase) return;
    const accountId = getRequiredAccountId();
    const userId = getRequiredUserId();

    const { data: existing } = await supabase
      .from('schedule_settings')
      .select('id')
      .eq('wp_config_id', wpConfigId)
      .eq('account_id', accountId)
      .eq('user_id', userId)
      .maybeSingle();

    const scheduleData = {
      account_id: accountId,
      user_id: userId,
      wp_config_id: wpConfigId,
      status: settings.isActive,
      frequency: settings.frequency,
      post_time: settings.time,
      related_keywords: settings.targetKeywords,
      post_status: settings.publishStatus,
    };

    if (existing) {
      const { error } = await supabase
        .from('schedule_settings')
        .update(scheduleData)
        .eq('id', existing.id)
        .eq('account_id', accountId)
        .eq('user_id', userId);

      if (error) {
        console.error('Error updating schedule settings:', error);
        throw new Error(`スケジュール設定の更新に失敗しました: ${error.message}`);
      }
    } else {
      const { error } = await supabase
        .from('schedule_settings')
        .insert(scheduleData);

      if (error) {
        console.error('Error creating schedule settings:', error);
        throw new Error(`スケジュール設定の作成に失敗しました: ${error.message}`);
      }
    }
  }

  async loadWordPressConfigs(): Promise<WordPressConfig[]> {
    if (!supabase) return [];
    let configsQuery = supabase
      .from('wordpress_configs')
      .select('*')
      .order('created_at', { ascending: false });

    let schedulesQuery = supabase
      .from('schedule_settings')
      .select('wp_config_id, status, frequency, post_time, related_keywords, post_status');
    configsQuery = scopeQueryToCurrentUser(configsQuery);
    schedulesQuery = scopeQueryToCurrentUser(schedulesQuery);

    const [{ data: configsData, error: configsError }, { data: schedulesData, error: schedulesError }] = await Promise.all([
      configsQuery,
      schedulesQuery,
    ]);

    if (configsError) {
      console.error('Error loading WordPress configs:', configsError);
      throw new Error(`WordPress設定の読み込みに失敗しました: ${configsError.message}`);
    }

    if (schedulesError) {
      console.error('Error loading schedule settings:', schedulesError);
      throw new Error(`スケジュール設定の読み込みに失敗しました: ${schedulesError.message}`);
    }

    const scheduleByWpConfigId = new Map(
      (schedulesData || []).map((item: any) => [item.wp_config_id, item])
    );

    return (configsData || []).map((item: any) => {
      const schedule = scheduleByWpConfigId.get(item.id);
      return {
        id: item.id,
        name: item.name,
        url: item.url,
        username: item.username,
        applicationPassword: item.password,
        isActive: item.is_active,
        category: item.category,
        defaultCategory: item.category,
        postType: item.post_type,
        styleReferenceUrl: item.style_reference_url || '',
        scheduleSettings: schedule ? {
          isActive: schedule.status,
          frequency: schedule.frequency,
          time: schedule.post_time,
          targetKeywords: schedule.related_keywords || [],
          publishStatus: schedule.post_status,
          timezone: 'Asia/Tokyo',
        } : undefined,
      };
    });
  }

  async deleteWordPressConfig(id: string): Promise<void> {
    if (!supabase) return;

    const { error: scheduleError } = await scopeMutationToCurrentUser(supabase
      .from('schedule_settings')
      .delete()
      .eq('wp_config_id', id));

    if (scheduleError) {
      console.error('Error deleting schedule settings:', scheduleError);
      throw new Error(`スケジュール設定の削除に失敗しました: ${scheduleError.message}`);
    }

    const { error } = await scopeMutationToCurrentUser(supabase
      .from('wordpress_configs')
      .delete()
      .eq('id', id));

    if (error) {
      console.error('Error deleting WordPress config:', error);
      throw new Error(`WordPress設定の削除に失敗しました: ${error.message}`);
    }

    const { error: legacyDeleteError } = await scopeMutationToCurrentUser(supabase
      .from('wp_configs')
      .delete()
      .eq('id', id));

    if (legacyDeleteError) {
      console.error('Error deleting legacy wp_config:', legacyDeleteError);
      throw new Error(`wp_configs の削除に失敗しました: ${legacyDeleteError.message}`);
    }
  }

  async saveAIConfig(config: AIConfig): Promise<string> {
    if (!supabase) return '';
    const accountId = getRequiredAccountId();
    const userId = getRequiredUserId();

    const aiData: Record<string, any> = {
      account_id: accountId,
      user_id: userId,
      provider: config.provider,
      model: config.model,
      temperature: config.temperature || 0.7,
      max_tokens: config.maxTokens || 4000,
    };

    if (config.apiKey.trim()) {
      aiData.api_key = config.apiKey;
    }

    // Check for existing config for this provider
    const { data: existing } = await supabase
      .from('ai_configs')
      .select('id, is_active')
      .eq('provider', config.provider)
      .eq('account_id', accountId)
      .eq('user_id', userId)
      .limit(1)
      .maybeSingle();

    // 他にアクティブな設定があるか確認
    const { count } = await supabase
      .from('ai_configs')
      .select('id', { count: 'exact', head: true })
      .eq('is_active', true)
      .eq('account_id', accountId)
      .eq('user_id', userId);

    const isFirstActive = !count && !existing;

    if (!existing && !aiData.api_key) {
      throw new Error('APIキーを入力してください');
    }

    const dataToSave = {
      ...aiData,
      is_active: existing ? existing.is_active : isFirstActive
    };

    let result;

    if (existing) {
      // Update existing config for this provider
      // （api_key はクライアントから SELECT 不可のため、返却カラムは明示する）
      result = await supabase
        .from('ai_configs')
        .update(dataToSave)
        .eq('id', existing.id)
        .select('id')
        .single();
    } else {
      // Insert new config
      result = await supabase
        .from('ai_configs')
        .insert(dataToSave)
        .select('id')
        .single();
    }

    if (result.error) {
      console.error('Error saving AI config:', result.error);
      throw new Error(`AI設定の保存に失敗しました: ${result.error.message}`);
    }

    // Cleanup duplicates just in case (optional but safer)
    if (existing) {
      // 今回更新したID以外の同じプロバイダーの設定を削除
      await supabase
        .from('ai_configs')
        .delete()
        .eq('provider', config.provider)
        .eq('account_id', accountId)
        .eq('user_id', userId)
        .neq('id', result.data.id);
    }

    return result.data.id;
  }

  /**
   * 全てのAI設定を取得
   */
  async loadAIConfigs(): Promise<AIConfig[]> {
    if (!supabase) return [];
    let query = supabase
      .from('ai_configs')
      .select('id, provider, model, temperature, max_tokens, is_active, image_enabled, image_provider, images_per_article, created_at')
      .order('created_at', { ascending: false });
    query = scopeQueryToCurrentUser(query);

    const { data, error } = await query;

    if (error) {
      console.error('Error loading AI configs:', error);
      return [];
    }

    return (data || []).map((item: any) => ({
      id: item.id,
      name: `${item.provider} (${item.model})`, // 名前カラムがないため生成
      provider: item.provider as any,
      apiKey: '', // api_key はクライアントから読めない（保存済みキーは id の存在で判定する）
      model: item.model,
      temperature: item.temperature,
      maxTokens: item.max_tokens,
      imageGenerationEnabled: item.image_enabled ?? false,
      imageProvider: (item.image_provider ?? 'nanobanana') as any,
      imagesPerArticle: item.images_per_article ?? 0,
      isActive: item.is_active,
      createdAt: item.created_at,
    }));
  }

  /**
   * AI設定をアクティブ化する
   */
  async activateAIConfig(id: string): Promise<void> {
    if (!supabase) return;
    const accountId = getRequiredAccountId();
    const userId = getRequiredUserId();

    // 全ての設定を一旦非アクティブにする（PostgRESTの安全制限を回避するためフィルタを追加）
    const { error: resetError } = await supabase
      .from('ai_configs')
      .update({ is_active: false })
      .eq('account_id', accountId)
      .eq('user_id', userId)
      .neq('id', '00000000-0000-0000-0000-000000000000');

    if (resetError) {
      console.error('Error resetting AI configs:', resetError);
      throw new Error('AI設定のリセットに失敗しました');
    }

    // 指定された設定をアクティブにする
    const { error: activateError } = await supabase
      .from('ai_configs')
      .update({ is_active: true })
      .eq('id', id)
      .eq('account_id', accountId)
      .eq('user_id', userId);

    if (activateError) {
      console.error('Error activating AI config:', activateError);
      throw new Error('AI設定のアクティブ化に失敗しました');
    }
  }

  /**
   *（互換性のため）アクティブな1件を取得。なければ最新の1件を取得
   */
  async loadAIConfig(): Promise<AIConfig | null> {
    if (!supabase) return null;
    let query = supabase
      .from('ai_configs')
      .select('id, provider, model, temperature, max_tokens, is_active, image_enabled, image_provider, images_per_article, created_at')
      .order('is_active', { ascending: false })
      .order('created_at', { ascending: false })
      .limit(1);
    query = scopeQueryToCurrentUser(query);

    const { data, error } = await query.maybeSingle();

    if (error || !data) {
      if (error) console.error('Error loading active AI config:', error);
      return null;
    }

    return {
      id: data.id,
      name: `${data.provider} (${data.model})`,
      provider: data.provider as any,
      apiKey: '', // api_key はクライアントから読めない（保存済みキーは id の存在で判定する）
      model: data.model,
      temperature: data.temperature,
      maxTokens: data.max_tokens,
      imageGenerationEnabled: data.image_enabled ?? false,
      imageProvider: (data.image_provider ?? 'nanobanana') as any,
      imagesPerArticle: data.images_per_article ?? 0,
      isActive: data.is_active,
      createdAt: data.created_at,
    };
  }

  async deleteAIConfig(id: string): Promise<void> {
    if (!supabase) return;

    const { error } = await scopeMutationToCurrentUser(supabase
      .from('ai_configs')
      .delete()
      .eq('id', id));

    if (error) {
      console.error('Error deleting AI config:', error);
      throw new Error(`AI設定の削除に失敗しました: ${error.message}`);
    }
  }

  async getExecutionHistory(limit = 50) {
    if (!supabase) return [];
    let query = supabase
      .from('execution_history')
      .select(`
        *,
        wordpress_configs (name, url)
      `)
      .order('executed_at', { ascending: false })
      .limit(limit);
    query = scopeQueryToCurrentUser(query);

    const { data, error } = await query;

    if (error) {
      const errorMessage = String(error.message || error.details || '').toLowerCase();
      let fallbackQuery = supabase
        .from('execution_history')
        .select('*')
        .order('executed_at', { ascending: false })
        .limit(limit);

      fallbackQuery = scopeQueryToCurrentUser(fallbackQuery);

      const fallback = await fallbackQuery;
      if (!fallback.error) {
        return fallback.data || [];
      }

      console.error('Error loading execution history:', error);
      return [];
    }

    return data || [];
  }

  async deleteFailedExecutionHistory(ids: string[]): Promise<void> {
    if (!supabase || ids.length === 0) return;

    let query = scopeQueryToCurrentUser(supabase
      .from('execution_history')
      .delete()
      .in('id', ids)
      .eq('status', 'failed'));

    const { error } = await query;

    if (error) {
      const errorMessage = String(error.message || error.details || '').toLowerCase();
      console.error('Error deleting failed execution history:', error);
      throw new Error(`失敗履歴の削除に失敗しました: ${error.message}`);
    }
  }

  async triggerScheduler(forceExecute = true, scheduleId?: string): Promise<any> {
    return this.callSchedulerFunction({ forceExecute, scheduleId });
  }

  async clearScheduleExecutionState(scheduleId: string): Promise<any> {
    return this.callSchedulerFunction({ action: 'clear_execution_state', scheduleId });
  }

  private async callSchedulerFunction(payload: Record<string, any>): Promise<any> {
    if (!supabase) {
      throw new Error('Supabase is not initialized');
    }

    const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
    const supabaseKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

    if (!supabaseUrl || !supabaseKey) {
      throw new Error('Supabase URL or Key is not configured');
    }

    // 強制実行・ロック解除はログインユーザーのトークンで認可される
    const { data: sessionData, error: sessionError } = await supabase.auth.getSession();
    const accessToken = sessionData?.session?.access_token;

    if (sessionError || !accessToken) {
      throw new Error('ログインセッションが見つかりません。再度ログインしてください。');
    }

    const functionUrl = `${supabaseUrl}/functions/v1/scheduler-executor`;
    console.log('Calling scheduler function:', { ...payload, functionUrl });

    const response = await fetch(functionUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${accessToken}`,
        'apikey': supabaseKey,
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('Scheduler execution failed:', response.status, errorText);
      throw new Error(`Scheduler execution failed: ${response.status} - ${errorText}`);
    }

    const data = await response.json();
    console.log('Scheduler execution result:', data);
    return data;
  }
}

export const supabaseSchedulerService = new SupabaseSchedulerService();
