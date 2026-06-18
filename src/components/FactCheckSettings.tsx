import React, { useEffect, useState } from 'react';
import { ExternalLink, Info, Key, Save, ShieldCheck } from 'lucide-react';
import toast from 'react-hot-toast';
import { supabase } from '../services/supabaseClient';
import { getCurrentAccountId, getRequiredAccountId } from '../services/accountScope';

type SettingsState = {
  autoFixEnabled: boolean;
  perplexityApiKey: string;
  alertChatworkRoomId: string;
  notifyMode: 'anomaly' | 'every';
};

const LOCAL_STORAGE_KEY = 'fact_check_settings_local';
const parseBoolean = (value: string | null | undefined, fallback = false) => {
  if (value == null) return fallback;
  return ['1', 'true', 'yes', 'on'].includes(String(value).toLowerCase());
};

export const FactCheckSettings: React.FC = () => {
  const [settings, setSettings] = useState<SettingsState>({
    autoFixEnabled: false,
    perplexityApiKey: '',
    alertChatworkRoomId: '',
    notifyMode: 'anomaly',
  });
  const [loading, setLoading] = useState(false);
  const [initialLoading, setInitialLoading] = useState(true);

  useEffect(() => {
    void loadSettings();
  }, []);

  const loadSettings = async () => {
    try {
      const localRaw = window.localStorage.getItem(LOCAL_STORAGE_KEY);
      if (localRaw) {
        const local = JSON.parse(localRaw) as Partial<SettingsState>;
        setSettings((prev) => ({
          autoFixEnabled: Boolean(local.autoFixEnabled ?? prev.autoFixEnabled),
          perplexityApiKey: String(local.perplexityApiKey ?? prev.perplexityApiKey ?? ''),
          alertChatworkRoomId: String(local.alertChatworkRoomId ?? prev.alertChatworkRoomId ?? ''),
          notifyMode: local.notifyMode === 'every' ? 'every' : 'anomaly',
        }));
      }
    } catch (error) {
      console.warn('Failed to load local fact-check settings:', error);
    }

    if (!supabase) {
      setInitialLoading(false);
      return;
    }

    const accountId = getCurrentAccountId();
    if (!accountId) {
      setInitialLoading(false);
      return;
    }

    try {
      const {
        data: { user },
        error: authError,
      } = await supabase.auth.getUser();

      let userSettings: any = null;
      if (!authError && user) {
        const { data, error } = await supabase
          .from('fact_check_settings')
          .select('*')
          .eq('user_id', user.id)
          .eq('account_id', accountId)
          .order('updated_at', { ascending: false })
          .limit(1)
          .maybeSingle();

        if (error) {
          console.error('Initial load error details:', error);
        }

        userSettings = data;
      }

      const { data: globalRows, error: globalError } = await supabase
        .from('app_settings')
        .select('key, value')
        .eq('account_id', accountId)
        .in('key', [
          'perplexity_api_key',
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
        autoFixEnabled: Boolean(userSettings?.auto_fix_enabled ?? parseBoolean(map.get('fact_check_auto_fix_enabled'))),
        perplexityApiKey: userSettings?.perplexity_api_key ?? map.get('perplexity_api_key') ?? '',
        alertChatworkRoomId: map.get('fact_check_alert_chatwork_room_id') ?? '',
        notifyMode: map.get('fact_check_notify_mode') === 'every' ? 'every' : 'anomaly',
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
      window.localStorage.setItem(
        LOCAL_STORAGE_KEY,
        JSON.stringify({
          enabled: true,
          autoFixEnabled: settings.autoFixEnabled,
          perplexityApiKey: settings.perplexityApiKey,
          alertChatworkRoomId: settings.alertChatworkRoomId,
          notifyMode: settings.notifyMode,
          modelName: 'sonar',
        })
      );

      if (!supabase) {
        toast.success('ファクトチェック設定を保存しました（ローカル設定）');
        return;
      }

      const accountId = getRequiredAccountId();
      const {
        data: { user },
        error: authError,
      } = await supabase.auth.getUser();

      if (!authError && user) {
        const { data: existingSettings } = await supabase
          .from('fact_check_settings')
          .select('id')
          .eq('user_id', user.id)
          .eq('account_id', accountId)
          .order('updated_at', { ascending: false })
          .limit(1)
          .maybeSingle();

        const payload = {
          account_id: accountId,
          user_id: user.id,
          enabled: true,
          auto_fix_enabled: settings.autoFixEnabled,
          perplexity_api_key: settings.perplexityApiKey,
          updated_at: new Date().toISOString(),
        };

        const result = existingSettings
          ? await supabase.from('fact_check_settings').update(payload).eq('id', existingSettings.id)
          : await supabase.from('fact_check_settings').insert([payload]);

        if (result.error) {
          throw result.error;
        }
      }

      const globalSettingsToSave = [
        { key: 'perplexity_api_key', value: settings.perplexityApiKey, description: 'Perplexity API key' },
        { key: 'fact_check_enabled', value: 'true', description: 'Enable fact check' },
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
          account_id: accountId,
          key: item.key,
          value: item.value,
          description: item.description,
        }, { onConflict: 'account_id,key' });
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
            <div className="flex items-center gap-2">
              <h3 className="text-lg font-semibold text-gray-900">Perplexity ファクトチェック設定</h3>
              <span className="rounded-full bg-gray-100 px-2.5 py-1 text-xs font-semibold text-gray-600">任意</span>
            </div>
            <p className="mt-1 text-sm text-gray-600">
              事実確認、ファクトチェック後の自動修正、結果通知を設定します。
            </p>
          </div>
        </div>
      </div>

      <label className="flex items-center justify-between rounded-lg border p-3">
        <span className="text-sm font-medium text-gray-700">問題があればAIで自動修正する</span>
        <input
          type="checkbox"
          checked={settings.autoFixEnabled}
          onChange={(e) => setSettings({ ...settings, autoFixEnabled: e.target.checked })}
          className="h-4 w-4"
        />
      </label>

      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <label className="flex items-center text-sm font-medium text-gray-700">
            <Key className="mr-1.5 h-4 w-4 text-gray-400" />
            Perplexity API Key
          </label>
          <a
            href="https://www.perplexity.ai/settings/api"
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center text-xs text-blue-600 hover:text-blue-500"
          >
            APIキーを取得
            <ExternalLink className="ml-1 h-3 w-3" />
          </a>
        </div>
        <input
          type="password"
          value={settings.perplexityApiKey}
          onChange={(e) => setSettings({ ...settings, perplexityApiKey: e.target.value })}
          placeholder="pplx-..."
          className="w-full rounded-lg border border-gray-300 px-4 py-2 font-mono text-sm focus:border-transparent focus:ring-2 focus:ring-blue-500"
        />
      </div>

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
            <li>APIキー未設定時はファクトチェックを実行しません。</li>
            <li>自動修正をONにすると、誤り検出後に本文の修正まで実行します。</li>
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
