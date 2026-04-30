import React, { useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { Check, ExternalLink, Key, MessageSquare, Search } from 'lucide-react';
import { supabase } from '../services/supabaseClient';
import { apiKeyManager } from '../services/apiKeyManager';
import { getCurrentAccountId, getRequiredAccountId } from '../services/accountScope';

export const ApiKeySettings: React.FC = () => {
  const [serpApiKey, setSerpApiKey] = useState('');
  const [chatworkApiToken, setChatworkApiToken] = useState('');
  const [saved, setSaved] = useState(false);
  const hasSearchKey = serpApiKey.trim().length > 0;
  const hasChatworkToken = chatworkApiToken.trim().length > 0;

  useEffect(() => {
    const existingSerpKey = apiKeyManager.getApiKey('serpapi');
    if (existingSerpKey) setSerpApiKey(existingSerpKey);

    const loadAccountSettings = async () => {
      if (!supabase) return;
      const accountId = getCurrentAccountId();
      if (!accountId) return;

      const { data } = await supabase
        .from('app_settings')
        .select('key,value')
        .eq('account_id', accountId)
        .in('key', ['serpapi_key', 'chatwork_api_token']);

      (data || []).forEach((setting) => {
        if (setting.key === 'serpapi_key' && setting.value) {
          setSerpApiKey(setting.value);
          apiKeyManager.setApiKey('serpapi', setting.value);
        }
        if (setting.key === 'chatwork_api_token' && setting.value) {
          setChatworkApiToken(setting.value);
        }
      });
    };

    void loadAccountSettings();
  }, []);

  const handleSave = async () => {
    if (!supabase) {
      toast.error('データベース接続エラー');
      return;
    }

    const accountId = getRequiredAccountId();
    const settingsToSave = [
      {
        key: 'serpapi_key',
        value: serpApiKey.trim(),
        description: 'SerpAPI key for keyword search',
      },
      {
        key: 'chatwork_api_token',
        value: chatworkApiToken.trim(),
        description: 'ChatWork API token for notifications',
      },
    ].filter((setting) => setting.value.length > 0);

    if (serpApiKey.trim()) {
      apiKeyManager.setApiKey('serpapi', serpApiKey.trim());
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
    toast.success('接続設定を保存しました');
    setTimeout(() => setSaved(false), 3000);
  };

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className={`rounded-lg border p-4 ${hasSearchKey ? 'border-green-200 bg-green-50' : 'border-yellow-200 bg-yellow-50'}`}>
          <div className="flex items-start gap-3">
            <Search className={`mt-0.5 h-5 w-5 ${hasSearchKey ? 'text-green-700' : 'text-yellow-700'}`} />
            <div>
              <div className="font-semibold text-gray-900">キーワード検索</div>
              <p className="mt-1 text-sm text-gray-600">
                {hasSearchKey ? '利用できます' : 'SerpAPIキーを設定してください'}
              </p>
            </div>
          </div>
        </div>
        <div className={`rounded-lg border p-4 ${hasChatworkToken ? 'border-green-200 bg-green-50' : 'border-gray-200 bg-gray-50'}`}>
          <div className="flex items-start gap-3">
            <MessageSquare className={`mt-0.5 h-5 w-5 ${hasChatworkToken ? 'text-green-700' : 'text-gray-500'}`} />
            <div>
              <div className="font-semibold text-gray-900">ChatWork通知</div>
              <p className="mt-1 text-sm text-gray-600">
                {hasChatworkToken ? '通知を送信できます' : '使う場合のみ設定してください'}
              </p>
            </div>
          </div>
        </div>
      </div>

      <div className="rounded-lg border border-gray-200 bg-white p-4 space-y-3">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h4 className="font-semibold text-gray-900">キーワード検索設定</h4>
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
            <ExternalLink className="w-4 h-4" />
          </a>
        </div>
        <label className="block">
          <span className="block text-sm font-medium text-gray-700 mb-1">SerpAPI Key</span>
          <div className="relative">
            <Key className="absolute left-3 top-2.5 w-4 h-4 text-gray-400" />
            <input
              type="password"
              value={serpApiKey}
              onChange={(event) => setSerpApiKey(event.target.value)}
              placeholder="SerpAPI Key を入力"
              className="input-field w-full pl-9 font-mono text-sm"
            />
          </div>
        </label>
      </div>

      <div className="rounded-lg border border-gray-200 bg-white p-4 space-y-3">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h4 className="font-semibold text-gray-900">ChatWork通知設定</h4>
            <p className="mt-1 text-sm text-gray-600">
              予約投稿の完了通知を送る場合に使用します。
            </p>
          </div>
          <a
            href="https://www.chatwork.com/service/packages/chatwork/subpackages/api/token.php"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 text-sm text-blue-600 hover:text-blue-700"
          >
            APIトークン
            <ExternalLink className="w-4 h-4" />
          </a>
        </div>
        <label className="block">
          <span className="block text-sm font-medium text-gray-700 mb-1">ChatWork API Token</span>
          <div className="relative">
            <MessageSquare className="absolute left-3 top-2.5 w-4 h-4 text-gray-400" />
            <input
              type="password"
              value={chatworkApiToken}
              onChange={(event) => setChatworkApiToken(event.target.value)}
              placeholder="ChatWork API Token を入力"
              className="input-field w-full pl-9 font-mono text-sm"
            />
          </div>
        </label>
      </div>

      <button
        type="button"
        onClick={handleSave}
        className="btn-primary inline-flex items-center gap-2"
      >
        <Check className="w-4 h-4" />
        保存
      </button>

      {saved && (
        <div className="rounded-lg border border-green-200 bg-green-50 p-3 text-sm text-green-800">
          接続設定を保存しました。
        </div>
      )}
    </div>
  );
};
