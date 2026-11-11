import React, { useEffect, useState } from 'react';
import { Info, Save, ShieldCheck } from 'lucide-react';
import toast from 'react-hot-toast';
import { supabase } from '../services/supabaseClient';
import { getCurrentUserId, getOwnershipInsertFields } from '../services/accountScope';

type SettingsState = {
  enabled: boolean;
  autoFixEnabled: boolean;
  alertChatworkRoomId: string;
  notifyMode: 'off' | 'anomaly' | 'every';
};

// 旧 Perplexity 方式でブラウザに保存していた設定（APIキーを含む）。今は使わないので削除する
const LEGACY_LOCAL_STORAGE_KEY = 'fact_check_settings_local';
const parseBoolean = (value: string | null | undefined, fallback = false) => {
  if (value == null || value === '') return fallback;
  return ['1', 'true', 'yes', 'on'].includes(String(value).toLowerCase());
};

export const FactCheckSettings: React.FC = () => {
  const [settings, setSettings] = useState<SettingsState>({
    enabled: true,
    autoFixEnabled: false,
    alertChatworkRoomId: '',
    notifyMode: 'anomaly',
  });
  const [loading, setLoading] = useState(false);
  const [initialLoading, setInitialLoading] = useState(true);

  useEffect(() => {
    try {
      window.localStorage.removeItem(LEGACY_LOCAL_STORAGE_KEY);
    } catch {
      // ignore
    }
    void loadSettings();
  }, []);

  const loadSettings = async () => {
    if (!supabase) {
      setInitialLoading(false);
      return;
    }

    const userId = getCurrentUserId();
    if (!userId) {
      setInitialLoading(false);
      return;
    }

    try {
      const { data: userSettings, error } = await supabase
        .from('fact_check_settings')
        .select('id, enabled, auto_fix_enabled')
        .eq('user_id', userId)
        .order('updated_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (error) {
        console.error('Initial load error details:', error);
      }

      const { data: globalRows, error: globalError } = await supabase
        .from('app_settings')
        .select('key, value')
        .eq('user_id', userId)
        .in('key', [
          'fact_check_enabled',
          'fact_check_auto_fix_enabled',
          'fact_check_alert_chatwork_room_id',
          'fact_check_notify_mode',
        ]);

      if (globalError) {
        console.error('Global settings load error details:', globalError);
      }

      const map = new Map<string, string>();
      (globalRows || []).forEach((row: { key: string; value: string | null }) => {
        map.set(String(row.key), String(row.value ?? ''));
      });

      setSettings({
        enabled: userSettings ? userSettings.enabled !== false : parseBoolean(map.get('fact_check_enabled'), true),
        autoFixEnabled: Boolean(userSettings?.auto_fix_enabled ?? parseBoolean(map.get('fact_check_auto_fix_enabled'))),
        alertChatworkRoomId: map.get('fact_check_alert_chatwork_room_id') ?? '',
        notifyMode: ['off', 'anomaly', 'every'].includes(String(map.get('fact_check_notify_mode')))
          ? map.get('fact_check_notify_mode') as SettingsState['notifyMode']
          : 'anomaly',
      });
    } catch (error) {
      console.error('Failed to load fact check settings:', error);
    } finally {
      setInitialLoading(false);
    }
  };

  const handleSave = async () => {
    setLoading(true);
    try {
      if (!supabase) {
        toast.error('Supabase に接続できないため保存できませんでした');
        return;
      }

      const ownership = getOwnershipInsertFields();

      const { data: existingSettings } = await supabase
        .from('fact_check_settings')
        .select('id')
        .eq('user_id', ownership.user_id)
        .order('updated_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      const payload: Record<string, unknown> = {
        ...ownership,
        enabled: settings.enabled,
        auto_fix_enabled: settings.autoFixEnabled,
        updated_at: new Date().toISOString(),
      };

      const result = existingSettings
        ? await supabase.from('fact_check_settings').update(payload).eq('id', existingSettings.id)
        : await supabase.from('fact_check_settings').insert([payload]);

      if (result.error) {
        throw result.error;
      }

      const globalSettingsToSave = [
        { key: 'fact_check_enabled', value: String(settings.enabled), description: 'Enable fact check' },
        {
          key: 'fact_check_auto_fix_enabled',
          value: String(settings.autoFixEnabled),
          description: 'Enable fact-check auto-fix',
        },
        {
          key: 'fact_check_alert_chatwork_room_id',
          value: settings.alertChatworkRoomId.trim(),
          description: 'ChatWork room IDs for fact-check alerts',
        },
        {
          key: 'fact_check_notify_mode',
          value: settings.notifyMode,
          description: 'Fact-check ChatWork notification mode',
        },
      ];

      for (const item of globalSettingsToSave) {
        const { error } = await supabase.from('app_settings').upsert({
          ...ownership,
          key: item.key,
          value: item.value,
          description: item.description,
        }, { onConflict: 'user_id,key' });
        if (error) {
          throw error;
        }
      }

      toast.success('ファクトチェック設定を保存しました');
    } catch (error: unknown) {
      console.error('Failed to save settings:', error);
      const message = error instanceof Error ? error.message : '設定の保存に失敗しました';
      toast.error(message);
    } finally {
      setLoading(false);
    }
  };

  if (initialLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="h-8 w-8 animate-spin rounded-full border-b-2 border-blue-600" />
      </div>
    );
  }

  return (
    <div className="space-y-5 rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <ShieldCheck className="h-6 w-6 text-green-600" />
          <div>
            <h3 className="text-lg font-semibold text-gray-900">ファクトチェック設定</h3>
            <p className="mt-1 text-sm text-gray-600">
              Gemini の Google 検索で記事の事実を確認します。AI設定の Gemini APIキーを使うため、別のキーは不要です。
            </p>
          </div>
        </div>
      </div>

      <label className="flex items-center justify-between rounded-lg border p-3">
        <span className="text-sm font-medium text-gray-700">ファクトチェックを実行する</span>
        <input
          type="checkbox"
          checked={settings.enabled}
          onChange={(e) => setSettings({ ...settings, enabled: e.target.checked })}
          className="h-4 w-4"
        />
      </label>

      <label className="flex items-center justify-between rounded-lg border p-3">
        <span className="text-sm font-medium text-gray-700">問題があればAIで自動修正する</span>
        <input
          type="checkbox"
          checked={settings.autoFixEnabled}
          disabled={!settings.enabled}
          onChange={(e) => setSettings({ ...settings, autoFixEnabled: e.target.checked })}
          className="h-4 w-4"
        />
      </label>

      <div className="space-y-3 border-t border-gray-200 pt-4">
        <div>
          <h4 className="text-sm font-semibold text-gray-900">ChatWork通知</h4>
          <p className="mt-1 text-sm text-gray-600">
            ファクトチェックで重大な不整合やエラーが出た場合の通知先を設定します。
          </p>
        </div>

        <label className="block">
          <span className="mb-1 block text-sm font-medium text-gray-700">通知先ルームID</span>
          <input
            type="text"
            value={settings.alertChatworkRoomId}
            onChange={(e) => setSettings({ ...settings, alertChatworkRoomId: e.target.value })}
            placeholder="例: 123456789"
            className="input-field w-full"
          />
          <span className="mt-1 block text-xs text-gray-500">
            複数のルームへ送る場合はカンマで区切ってください。未入力の場合は通知設定のルームIDを使います。
          </span>
        </label>

        <div className="space-y-2">
          <p className="text-xs font-medium text-gray-600">通知モード</p>
          <label className="flex items-center gap-2 text-sm text-gray-700">
            <input
              type="radio"
              name="fact_check_notify_mode"
              checked={settings.notifyMode === 'off'}
              onChange={() => setSettings({ ...settings, notifyMode: 'off' })}
              className="h-4 w-4 text-blue-600"
            />
            <span>通知しない</span>
          </label>
          <label className="flex items-center gap-2 text-sm text-gray-700">
            <input
              type="radio"
              name="fact_check_notify_mode"
              checked={settings.notifyMode === 'anomaly'}
              onChange={() => setSettings({ ...settings, notifyMode: 'anomaly' })}
              className="h-4 w-4 text-blue-600"
            />
            <span>異常時だけ通知する</span>
          </label>
          <label className="flex items-center gap-2 text-sm text-gray-700">
            <input
              type="radio"
              name="fact_check_notify_mode"
              checked={settings.notifyMode === 'every'}
              onChange={() => setSettings({ ...settings, notifyMode: 'every' })}
              className="h-4 w-4 text-blue-600"
            />
            <span>毎回、ファクトチェック結果を通知する</span>
          </label>
        </div>
      </div>

      <div className="flex items-start gap-3 rounded-lg border border-blue-100 bg-blue-50 p-4">
        <Info className="mt-0.5 h-5 w-5 text-blue-600" />
        <div className="text-sm text-blue-800">
          <p className="mb-1 font-semibold text-blue-900">補足</p>
          <ul className="list-inside list-disc space-y-1">
            <li>確認の流れ: AI が確認の必要な主張を選ぶ → 根拠メモと照合 → 根拠メモにない主張だけ Google 検索で確認します。</li>
            <li>自動投稿では、重大な誤りが残った記事・確認を最後までできなかった記事は下書きで保存します。</li>
            <li>自動修正をONにすると、誤り検出後に本文の修正と、修正箇所の再確認まで実行します。</li>
            <li>ChatWork通知には、通知設定タブのAPIトークンが必要です。</li>
          </ul>
        </div>
      </div>

      <button
        onClick={handleSave}
        disabled={loading}
        className="flex w-full items-center justify-center gap-2 rounded-lg bg-blue-600 py-2.5 font-medium text-white transition-colors hover:bg-blue-700 disabled:opacity-50"
      >
        <Save className="h-5 w-5" />
        <span>{loading ? '保存中...' : '設定を保存'}</span>
      </button>
    </div>
  );
};
