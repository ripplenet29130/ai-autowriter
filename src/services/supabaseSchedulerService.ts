import { supabase } from './supabaseClient';
import { WordPressConfig, AIConfig, ScheduleSettings } from '../types';

class SupabaseSchedulerService {
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

    const { data, error } = await supabase
      .from('wordpress_configs')
      .upsert({
        id: configId,
        name: wpConfig.name,
        url: wpConfig.url,
        username: wpConfig.username,
        password: wpConfig.applicationPassword,
        category: normalizedCategory,
        post_type: normalizedPostType,
        style_reference_url: normalizedStyleReferenceUrl,
        is_active: wpConfig.isActive,
      })
      .select()
      .single();

    if (error) {
      console.error('Error saving WordPress config:', error);
      throw new Error(`WordPress設定の保存に失敗しました: ${error.message}`);
    }

    const { error: legacySyncError } = await supabase
      .from('wp_configs')
      .upsert({
        id: configId,
        name: wpConfig.name,
        url: wpConfig.url,
        username: wpConfig.username,
        app_password: wpConfig.applicationPassword,
        default_category: normalizedCategory,
        post_type: normalizedPostType,
        style_reference_url: normalizedStyleReferenceUrl,
        is_active: wpConfig.isActive,
      });

    if (legacySyncError) {
      console.error('Error syncing wp_configs:', legacySyncError);
      throw new Error(`wp_configs との同期に失敗しました: ${legacySyncError.message}`);
    }

    if (scheduleSettings) {
      await this.saveScheduleSettings(configId, scheduleSettings);
    }

    return data.id;
  }

  async saveScheduleSettings(wpConfigId: string, settings: ScheduleSettings): Promise<void> {
    if (!supabase) return;

    const { data: existing } = await supabase
      .from('schedule_settings')
      .select('id')
      .eq('wp_config_id', wpConfigId)
      .maybeSingle();

    const scheduleData = {
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
        .eq('id', existing.id);

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

    const [{ data: configsData, error: configsError }, { data: schedulesData, error: schedulesError }] = await Promise.all([
      supabase
        .from('wordpress_configs')
        .select('*')
        .order('created_at', { ascending: false }),
      supabase
        .from('schedule_settings')
        .select('wp_config_id, status, frequency, post_time, related_keywords, post_status'),
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

    const { error: scheduleError } = await supabase
      .from('schedule_settings')
      .delete()
      .eq('wp_config_id', id);

    if (scheduleError) {
      console.error('Error deleting schedule settings:', scheduleError);
      throw new Error(`スケジュール設定の削除に失敗しました: ${scheduleError.message}`);
    }

    const { error } = await supabase
      .from('wordpress_configs')
      .delete()
      .eq('id', id);

    if (error) {
      console.error('Error deleting WordPress config:', error);
      throw new Error(`WordPress設定の削除に失敗しました: ${error.message}`);
    }

    const { error: legacyDeleteError } = await supabase
      .from('wp_configs')
      .delete()
      .eq('id', id);

    if (legacyDeleteError) {
      console.error('Error deleting legacy wp_config:', legacyDeleteError);
      throw new Error(`wp_configs の削除に失敗しました: ${legacyDeleteError.message}`);
    }
  }

  async saveAIConfig(config: AIConfig): Promise<string> {
    if (!supabase) return '';

    const aiData: Record<string, any> = {
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
      .limit(1)
      .maybeSingle();

    // 他にアクティブな設定があるか確認
    const { count } = await supabase
      .from('ai_configs')
      .select('*', { count: 'exact', head: true })
      .eq('is_active', true);

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
      result = await supabase
        .from('ai_configs')
        .update(dataToSave)
        .eq('id', existing.id)
        .select()
        .single();
    } else {
      // Insert new config
      result = await supabase
        .from('ai_configs')
        .insert(dataToSave)
        .select()
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
        .neq('id', result.data.id);
    }

    return result.data.id;
  }

  /**
   * 全てのAI設定を取得
   */
  async loadAIConfigs(): Promise<AIConfig[]> {
    if (!supabase) return [];

    const { data, error } = await supabase
      .from('ai_configs')
      .select('*')
      .order('created_at', { ascending: false });

    if (error) {
      console.error('Error loading AI configs:', error);
      return [];
    }

    return (data || []).map((item: any) => ({
      id: item.id,
      name: `${item.provider} (${item.model})`, // 名前カラムがないため生成
      provider: item.provider as any,
      apiKey: item.api_key,
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

    // 全ての設定を一旦非アクティブにする（PostgRESTの安全制限を回避するためフィルタを追加）
    const { error: resetError } = await supabase
      .from('ai_configs')
      .update({ is_active: false })
      .neq('id', '00000000-0000-0000-0000-000000000000');

    if (resetError) {
      console.error('Error resetting AI configs:', resetError);
      throw new Error('AI設定のリセットに失敗しました');
    }

    // 指定された設定をアクティブにする
    const { error: activateError } = await supabase
      .from('ai_configs')
      .update({ is_active: true })
      .eq('id', id);

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

    const { data, error } = await supabase
      .from('ai_configs')
      .select('*')
      .order('is_active', { ascending: false })
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error || !data) {
      if (error) console.error('Error loading active AI config:', error);
      return null;
    }

    return {
      id: data.id,
      name: `${data.provider} (${data.model})`,
      provider: data.provider as any,
      apiKey: data.api_key,
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

    const { error } = await supabase
      .from('ai_configs')
      .delete()
      .eq('id', id);

    if (error) {
      console.error('Error deleting AI config:', error);
      throw new Error(`AI設定の削除に失敗しました: ${error.message}`);
    }
  }

  async getExecutionHistory(limit = 50) {
    if (!supabase) return [];

    const { data, error } = await supabase
      .from('execution_history')
      .select(`
        *,
        wordpress_configs (name, url)
      `)
      .order('executed_at', { ascending: false })
      .limit(limit);

    if (error) {
      console.error('Error loading execution history:', error);
      return [];
    }

    return data || [];
  }

  async triggerScheduler(forceExecute = true, scheduleId?: string): Promise<any> {
    if (!supabase) {
      throw new Error('Supabase is not initialized');
    }

    const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
    const supabaseKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

    if (!supabaseUrl || !supabaseKey) {
      throw new Error('Supabase URL or Key is not configured');
    }

    const functionUrl = `${supabaseUrl}/functions/v1/scheduler-executor`;
    console.log('Triggering scheduler:', { forceExecute, scheduleId, functionUrl });

    const response = await fetch(functionUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${supabaseKey}`,
        'apikey': supabaseKey,
      },
      body: JSON.stringify({ forceExecute, scheduleId }),
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
