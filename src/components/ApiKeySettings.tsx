import React, { useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { Check, ExternalLink } from 'lucide-react';
import { supabase } from '../services/supabaseClient';
import { apiKeyManager } from '../services/apiKeyManager';
import { getCurrentAccountId, getRequiredAccountId } from '../services/accountScope';

const DEFAULT_CHATWORK_TEMPLATE = `いつもお世話になっております。
記事の投稿が完了しましたので、ご報告いたします。

■ 記事タイトル
{title}

■ キーワード
{keyword}

■ 投稿URL
{url}

■ 投稿状態
{status}

問題などございましたら、お気軽にお知らせください。

今後ともよろしくお願いいたします。`;

type ApiKeySettingsState = {
  serpApiKey: string;
  chatworkApiToken: string;
  chatworkRoomId: string;
  chatworkMessageTemplate: string;
};

const useApiKeySettings = () => {
  const [settings, setSettings] = useState<ApiKeySettingsState>({
    serpApiKey: '',
    chatworkApiToken: '',
    chatworkRoomId: '',
    chatworkMessageTemplate: DEFAULT_CHATWORK_TEMPLATE,
  });
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    const existingSerpKey = apiKeyManager.getApiKey('serpapi');
    if (existingSerpKey) {
      setSettings((prev) => ({ ...prev, serpApiKey: existingSerpKey }));
    }

    const loadAccountSettings = async () => {
      if (!supabase) return;
      const accountId = getCurrentAccountId();
      if (!accountId) return;

      const { data } = await supabase
        .from('app_settings')
        .select('key,value')
        .eq('account_id', accountId)
        .in('key', [
          'serpapi_key',
          'chatwork_api_token',
          'chatwork_room_id',
          'chatwork_message_template',
        ]);

      const map = new Map<string, string>();
      (data || []).forEach((setting) => {
        map.set(String(setting.key), String(setting.value ?? ''));
      });

      setSettings((prev) => ({
        serpApiKey: map.get('serpapi_key') || prev.serpApiKey,
        chatworkApiToken: map.get('chatwork_api_token') || prev.chatworkApiToken,
        chatworkRoomId: map.get('chatwork_room_id') || prev.chatworkRoomId,
        chatworkMessageTemplate: map.get('chatwork_message_template') || prev.chatworkMessageTemplate,
      }));

      const accountSerpKey = map.get('serpapi_key');
      if (accountSerpKey) {
        apiKeyManager.setApiKey('serpapi', accountSerpKey);
      }
    };

    void loadAccountSettings();
  }, []);

  const updateSettings = (patch: Partial<ApiKeySettingsState>) => {
    setSettings((prev) => ({ ...prev, ...patch }));
  };

  const saveSettings = async (values: Partial<ApiKeySettingsState>) => {
    if (!supabase) {
      toast.error('データベースに接続できません');
      return;
    }

    const accountId = getRequiredAccountId();
    const settingsToSave = [
      values.serpApiKey !== undefined
        ? {
            key: 'serpapi_key',
            value: values.serpApiKey.trim(),
            description: 'SerpAPI key for keyword search',
          }
        : null,
      values.chatworkApiToken !== undefined
        ? {
            key: 'chatwork_api_token',
            value: values.chatworkApiToken.trim(),
            description: 'ChatWork API token for notifications',
          }
        : null,
      values.chatworkRoomId !== undefined
        ? {
            key: 'chatwork_room_id',
            value: values.chatworkRoomId.trim(),
            description: 'Default ChatWork room IDs for scheduled post notifications',
          }
        : null,
      values.chatworkMessageTemplate !== undefined
        ? {
            key: 'chatwork_message_template',
            value: values.chatworkMessageTemplate.trim() || DEFAULT_CHATWORK_TEMPLATE,
            description: 'Default ChatWork message template for scheduled post notifications',
          }
        : null,
    ].filter((setting): setting is { key: string; value: string; description: string } =>
      Boolean(setting)
    );

    if (values.serpApiKey?.trim()) {
      apiKeyManager.setApiKey('serpapi', values.serpApiKey.trim());
    }

    for (const setting of settingsToSave) {
      const { error } = await supabase
        .from('app_settings')
        .upsert(
          {
            account_id: accountId,
            key: setting.key,
            value: setting.value,
            description: setting.description,
          },
          { onConflict: 'account_id,key' }
        );

      if (error) {
        console.error(`Failed to save ${setting.key}:`, error);
        toast.error('設定の保存に失敗しました');
        return;
      }
    }

    setSaved(true);
    toast.success('設定を保存しました');
    setTimeout(() => setSaved(false), 3000);
  };

  return {
    settings,
    updateSettings,
    saved,
    saveSettings,
  };
};

export const SearchApiSettings: React.FC = () => {
  const { settings, updateSettings, saved, saveSettings } = useApiKeySettings();

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-2">
        <span className="rounded-full bg-red-50 px-2.5 py-1 text-xs font-semibold text-red-700">必須</span>
        <h3 className="text-base font-semibold text-gray-900">記事作成に必要な検索API</h3>
      </div>

      <div className="space-y-3 rounded-lg border border-gray-200 bg-white p-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h4 className="font-semibold text-gray-900">キーワード検索API設定</h4>
            <p className="mt-1 text-sm text-gray-600">
              記事作成時のキーワード検索と競合記事の確認に使用します。
            </p>
          </div>
          <a
            href="https://serpapi.com/"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 text-sm text-blue-600 hover:text-blue-700"
          >
            SerpAPI
            <ExternalLink className="h-4 w-4" />
          </a>
        </div>
        <label className="block">
          <span className="mb-1 block text-sm font-medium text-gray-700">SerpAPI Key</span>
          <input
            type="password"
            value={settings.serpApiKey}
            onChange={(event) => updateSettings({ serpApiKey: event.target.value })}
            placeholder="SerpAPI Keyを入力"
            className="input-field w-full font-mono text-sm"
          />
        </label>
      </div>

      <div className="rounded-lg border border-blue-100 bg-blue-50 p-4">
        <h4 className="text-sm font-semibold text-blue-900">簡単な設定手順</h4>
        <ol className="mt-3 list-decimal space-y-2 pl-5 text-sm leading-6 text-blue-900">
          <li>SerpAPIのサイトでアカウントを作成します。</li>
          <li>ダッシュボードでAPI Keyをコピーします。</li>
          <li>上の入力欄にAPI Keyを貼り付けて保存します。</li>
          <li>保存後、記事作成時のキーワード検索と競合確認が使えるようになります。</li>
        </ol>
      </div>

      <button
        type="button"
        onClick={() => saveSettings({ serpApiKey: settings.serpApiKey })}
        className="btn-primary inline-flex items-center gap-2"
      >
        <Check className="h-4 w-4" />
        保存
      </button>

      {saved && (
        <div className="rounded-lg border border-green-200 bg-green-50 p-3 text-sm text-green-800">
          検索API設定を保存しました。
        </div>
      )}
    </div>
  );
};

export const ChatWorkNotificationSettings: React.FC = () => {
  const { settings, updateSettings, saved, saveSettings } = useApiKeySettings();

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-2">
        <span className="rounded-full bg-gray-100 px-2.5 py-1 text-xs font-semibold text-gray-600">任意</span>
        <h3 className="text-base font-semibold text-gray-900">予約投稿の通知設定</h3>
      </div>

      <div className="space-y-4 rounded-lg border border-gray-200 bg-white p-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h4 className="font-semibold text-gray-900">ChatWork通知設定</h4>
            <p className="mt-1 text-sm text-gray-600">
              予約投稿の完了通知をChatWorkへ送る場合だけ設定します。
            </p>
          </div>
          <a
            href="https://www.chatwork.com/service/packages/chatwork/subpackages/api/token.php"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 text-sm text-blue-600 hover:text-blue-700"
          >
            APIトークン
            <ExternalLink className="h-4 w-4" />
          </a>
        </div>

        <label className="block">
          <span className="mb-1 block text-sm font-medium text-gray-700">ChatWork API Token</span>
          <input
            type="password"
            value={settings.chatworkApiToken}
            onChange={(event) => updateSettings({ chatworkApiToken: event.target.value })}
            placeholder="ChatWork API Tokenを入力"
            className="input-field w-full font-mono text-sm"
          />
        </label>

        <label className="block">
          <span className="mb-1 block text-sm font-medium text-gray-700">通知先ルームID</span>
          <input
            type="text"
            value={settings.chatworkRoomId}
            onChange={(event) => updateSettings({ chatworkRoomId: event.target.value })}
            placeholder="例: 123456789"
            className="input-field w-full"
          />
          <span className="mt-1 block text-xs text-gray-500">
            複数のルームへ送る場合はカンマで区切ってください。
          </span>
        </label>

        <label className="block">
          <span className="mb-1 block text-sm font-medium text-gray-700">通知メッセージテンプレート</span>
          <textarea
            value={settings.chatworkMessageTemplate}
            onChange={(event) => updateSettings({ chatworkMessageTemplate: event.target.value })}
            rows={7}
            className="input-field w-full font-mono text-sm"
          />
          <span className="mt-1 block text-xs text-gray-500">
            使用可能な変数: {'{title}'}, {'{url}'}, {'{keyword}'}, {'{status}'}
          </span>
        </label>
      </div>

      <button
        type="button"
        onClick={() => saveSettings({
          chatworkApiToken: settings.chatworkApiToken,
          chatworkRoomId: settings.chatworkRoomId,
          chatworkMessageTemplate: settings.chatworkMessageTemplate,
        })}
        className="btn-primary inline-flex items-center gap-2"
      >
        <Check className="h-4 w-4" />
        保存
      </button>

      {saved && (
        <div className="rounded-lg border border-green-200 bg-green-50 p-3 text-sm text-green-800">
          ChatWork通知設定を保存しました。
        </div>
      )}
    </div>
  );
};

export const ApiKeySettings: React.FC = () => (
  <div className="space-y-8">
    <SearchApiSettings />
    <ChatWorkNotificationSettings />
  </div>
);
