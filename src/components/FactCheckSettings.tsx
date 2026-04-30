import React, { useEffect, useState } from 'react';
import { ExternalLink, Info, Key, Save, ShieldCheck } from 'lucide-react';
import toast from 'react-hot-toast';
import { supabase } from '../services/supabaseClient';
import { IS_CLIENT_DEPLOYMENT } from '@aw/config';
import { getCurrentAccountId, getRequiredAccountId } from '../services/accountScope';

type SettingsState = {
  enabled: boolean;
  autoFixEnabled: boolean;
  perplexityApiKey: string;
  maxItemsToCheck: number;
};

const LOCAL_STORAGE_KEY = 'fact_check_settings_local';

export const FactCheckSettings: React.FC = () => {
  const [settings, setSettings] = useState<SettingsState>({
    enabled: IS_CLIENT_DEPLOYMENT,
    autoFixEnabled: false,
    perplexityApiKey: '',
    maxItemsToCheck: 50,
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
          enabled: IS_CLIENT_DEPLOYMENT ? true : Boolean(local.enabled ?? prev.enabled),
          autoFixEnabled: Boolean(local.autoFixEnabled ?? prev.autoFixEnabled),
          perplexityApiKey: String(local.perplexityApiKey ?? prev.perplexityApiKey ?? ''),
          maxItemsToCheck: Number.parseInt(String(local.maxItemsToCheck ?? prev.maxItemsToCheck ?? 50), 10) || 50,
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

        if (data) {
          setSettings({
            enabled: IS_CLIENT_DEPLOYMENT ? true : (data.enabled ?? false),
            autoFixEnabled: data.auto_fix_enabled ?? false,
            perplexityApiKey: data.perplexity_api_key ?? '',
            maxItemsToCheck: data.max_items_to_check ?? 50,
          });
          return;
        }
      }

      const { data: globalRows, error: globalError } = await supabase
        .from('app_settings')
        .select('key, value')
        .eq('account_id', accountId)
        .in('key', [
          'perplexity_api_key',
          'fact_check_enabled',
          'fact_check_max_items',
          'fact_check_auto_fix_enabled',
        ]);

      if (globalError) {
        console.error('Global settings load error details:', globalError);
      }

      if (globalRows && globalRows.length > 0) {
        const map = new Map<string, string>();
        globalRows.forEach((row: { key: string; value: string | null }) => {
          map.set(String(row.key), String(row.value ?? ''));
        });
        setSettings({
          enabled: IS_CLIENT_DEPLOYMENT
            ? true
            : ['1', 'true', 'yes', 'on'].includes((map.get('fact_check_enabled') ?? '').toLowerCase()),
          autoFixEnabled: ['1', 'true', 'yes', 'on'].includes(
            (map.get('fact_check_auto_fix_enabled') ?? '').toLowerCase()
          ),
          perplexityApiKey: map.get('perplexity_api_key') ?? '',
          maxItemsToCheck: Number.parseInt(map.get('fact_check_max_items') || '50', 10) || 50,
        });
      }
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
          enabled: IS_CLIENT_DEPLOYMENT ? true : settings.enabled,
          autoFixEnabled: settings.autoFixEnabled,
          perplexityApiKey: settings.perplexityApiKey,
          maxItemsToCheck: settings.maxItemsToCheck,
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
          enabled: IS_CLIENT_DEPLOYMENT ? true : settings.enabled,
          auto_fix_enabled: settings.autoFixEnabled,
          perplexity_api_key: settings.perplexityApiKey,
          max_items_to_check: settings.maxItemsToCheck,
          updated_at: new Date().toISOString(),
        };

        const result = existingSettings
          ? await supabase.from('fact_check_settings').update(payload).eq('id', existingSettings.id)
          : await supabase.from('fact_check_settings').insert([payload]);

        if (result.error) {
          throw result.error;
        }

        toast.success('ファクトチェック設定を保存しました');
        return;
      }

      const globalSettingsToSave = [
        { key: 'perplexity_api_key', value: settings.perplexityApiKey, description: 'Perplexity API key' },
        { key: 'fact_check_enabled', value: String(IS_CLIENT_DEPLOYMENT ? true : settings.enabled), description: 'Enable fact check' },
        { key: 'fact_check_max_items', value: String(settings.maxItemsToCheck), description: 'Max fact-check items' },
        {
          key: 'fact_check_auto_fix_enabled',
          value: String(settings.autoFixEnabled),
          description: 'Enable fact-check auto-fix',
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
          console.warn(`Failed to save ${item.key} to app_settings:`, error);
        }
      }

      toast.success('ファクトチェック設定を保存しました（ローカル/グローバル）');
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
      <div className="flex justify-center items-center py-12">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600" />
      </div>
    );
  }

  return (
    <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6 space-y-6">
      <div className="flex items-center space-x-3">
        <ShieldCheck className="w-6 h-6 text-green-600" />
        <h3 className="text-lg font-semibold text-gray-900">Perplexity ファクトチェック設定</h3>
      </div>

      {!IS_CLIENT_DEPLOYMENT && (
        <label className="flex items-center justify-between rounded-lg border p-3">
          <span className="text-sm font-medium text-gray-700">ファクトチェックを有効化</span>
          <input
            type="checkbox"
            checked={settings.enabled}
            onChange={(e) => setSettings({ ...settings, enabled: e.target.checked })}
            className="h-4 w-4"
          />
        </label>
      )}

      {IS_CLIENT_DEPLOYMENT && (
        <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800">
          クライアントモードのため、ファクトチェックは常時有効です。
        </div>
      )}

      <label className="flex items-center justify-between rounded-lg border p-3">
        <span className="text-sm font-medium text-gray-700">問題があればAIで自動修正</span>
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
            <Key className="w-4 h-4 mr-1.5 text-gray-400" />
            Perplexity API Key
          </label>
          <a
            href="https://www.perplexity.ai/settings/api"
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs text-blue-600 hover:text-blue-500 flex items-center"
          >
            APIキーを取得
            <ExternalLink className="w-3 h-3 ml-1" />
          </a>
        </div>
        <input
          type="password"
          value={settings.perplexityApiKey}
          onChange={(e) => setSettings({ ...settings, perplexityApiKey: e.target.value })}
          placeholder="pplx-..."
          className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent font-mono text-sm"
        />
      </div>

      <div className="space-y-2">
        <label className="block text-sm font-medium text-gray-700">1記事あたりの最大チェック件数</label>
        <input
          type="number"
          min="1"
          max="50"
          value={settings.maxItemsToCheck}
          onChange={(e) =>
            setSettings({
              ...settings,
              maxItemsToCheck: Math.max(1, Math.min(50, Number.parseInt(e.target.value || '50', 10))),
            })
          }
          className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
        />
      </div>

      <div className="p-4 bg-blue-50 rounded-lg border border-blue-100 flex items-start space-x-3">
        <Info className="w-5 h-5 text-blue-600 mt-0.5" />
        <div className="text-sm text-blue-800">
          <p className="font-semibold mb-1 text-blue-900">補足</p>
          <ul className="list-disc list-inside space-y-1">
            <li>APIキー未設定時はファクトチェックを実行しません。</li>
            <li>件数を増やすと精度は上がりますが、APIコストも増えます。</li>
            <li>本文中で [[ ]] で囲んだ箇所を優先的に検証します。</li>
            <li>自動修正をONにすると、誤り検出後に本文の修正まで自動で行います。</li>
          </ul>
        </div>
      </div>

      <button
        onClick={handleSave}
        disabled={loading}
        className="w-full flex items-center justify-center space-x-2 py-2.5 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors disabled:opacity-50 font-medium"
      >
        <Save className="w-5 h-5" />
        <span>{loading ? '保存中...' : '設定を保存'}</span>
      </button>
    </div>
  );
};
