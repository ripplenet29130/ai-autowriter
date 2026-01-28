import { supabase } from './supabaseClient';
import { WordPressConfig, AIConfig, ScheduleSettings } from '../types';

class SupabaseSchedulerService {
  async saveWordPressConfig(config: WordPressConfig): Promise<string> {
    if (!supabase) {
      console.warn('Supabase not initialized');
      return config.id;
    }

    const { scheduleSettings, ...wpConfig } = config;

    const { data, error } = await supabase
      .from('wordpress_configs')
      .upsert({
        id: wpConfig.id,
        name: wpConfig.name,
        url: wpConfig.url,
        username: wpConfig.username,
        password: wpConfig.applicationPassword,
        category: wpConfig.category || wpConfig.defaultCategory || '',
        post_type: wpConfig.postType || 'posts',
        is_active: wpConfig.isActive,
      })
      .select()
      .single();

    if (error) {
      console.error('Error saving WordPress config:', error);
      throw new Error(`WordPress設定の保存に失敗しました: ${error.message}`);
    }

    if (scheduleSettings) {
      await this.saveScheduleSettings(data.id, scheduleSettings);
    }

    return data.id;
  }

  async saveScheduleSettings(wpConfigId: string, settings: ScheduleSettings): Promise<void> {
    if (!supabase) return;

    const { data: existing } = await supabase
      .from('schedule_settings')
      .select('id')
      .eq('wordpress_config_id', wpConfigId)
      .maybeSingle();

    const scheduleData = {
      wordpress_config_id: wpConfigId,
      is_active: settings.isActive,
      frequency: settings.frequency,
      time: settings.time,
      target_keywords: settings.targetKeywords,
      publish_status: settings.publishStatus,
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

    const { data, error } = await supabase
      .from('wordpress_configs')
      .select(`
        *,
        schedule_settings (*)
      `)
      .order('created_at', { ascending: false });

    if (error) {
      console.error('Error loading WordPress configs:', error);
      throw new Error(`WordPress設定の読み込みに失敗しました: ${error.message}`);
    }

    return (data || []).map((item: any) => ({
      id: item.id,
      name: item.name,
      url: item.url,
      username: item.username,
      applicationPassword: item.password,
      isActive: item.is_active,
      category: item.category,
      defaultCategory: item.category,
      postType: item.post_type,
      scheduleSettings: item.schedule_settings?.[0] ? {
        isActive: item.schedule_settings[0].is_active,
        frequency: item.schedule_settings[0].frequency,
        time: item.schedule_settings[0].time,
        targetKeywords: item.schedule_settings[0].target_keywords,
        publishStatus: item.schedule_settings[0].publish_status,
        timezone: 'Asia/Tokyo',
      } : undefined,
    }));
  }

  async deleteWordPressConfig(id: string): Promise<void> {
    if (!supabase) return;

    const { error } = await supabase
      .from('wordpress_configs')
      .delete()
      .eq('id', id);

    if (error) {
      console.error('Error deleting WordPress config:', error);
      throw new Error(`WordPress設定の削除に失敗しました: ${error.message}`);
    }
  }

  async saveAIConfig(config: AIConfig): Promise<string> {
    if (!supabase) return '';

    const aiData = {
      provider: config.provider,
      api_key: config.apiKey,
      model: config.model,
      temperature: config.temperature || 0.7,
      max_tokens: config.maxTokens || 4000,
      image_enabled: config.imageGenerationEnabled,
      image_provider: config.imageProvider,
    };

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
      imageGenerationEnabled: item.image_enabled,
      imageProvider: item.image_provider as any,
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
      imageGenerationEnabled: data.image_enabled,
      imageProvider: data.image_provider as any,
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

  async triggerScheduler(forceExecute = true): Promise<any> {
    if (!supabase) {
      throw new Error('Supabase is not initialized');
    }

    const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
    const supabaseKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

    const response = await fetch(`${supabaseUrl}/functions/v1/scheduler-executor`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${supabaseKey}`,
      },
      body: JSON.stringify({ forceExecute }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Scheduler execution failed: ${errorText}`);
    }

    return await response.json();
  }
}

export const supabaseSchedulerService = new SupabaseSchedulerService();
