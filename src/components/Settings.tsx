import React from 'react';
import { Bot, Globe, Key, Plug, ShieldCheck } from 'lucide-react';
import { ApiKeySettings } from './ApiKeySettings';
import { FactCheckSettings } from './FactCheckSettings';
import { AIConfigComponent } from './AIConfig';
import { WordPressConfigComponent } from './WordPressConfig';
import { useAuthStore } from '../store/useAuthStore';

export const SettingsComponent: React.FC = () => {
  const factCheckAllowed = useAuthStore((state) => state.account?.feature_flags?.fact_check !== false);

  return (
    <div className="space-y-6">
      <div className="flex items-center space-x-3">
        <Plug className="w-8 h-8 text-gray-700" />
        <div>
          <h2 className="text-2xl font-bold text-gray-900">接続設定</h2>
          <p className="text-gray-600">記事作成と投稿に必要な外部サービスを管理します。</p>
        </div>
      </div>

      <section className="space-y-4">
        <div className="flex items-center gap-2 mb-4">
          <Globe className="w-5 h-5 text-blue-600" />
          <h3 className="text-lg font-semibold text-gray-900">WordPress</h3>
        </div>
        <WordPressConfigComponent />
      </section>

      <section className="space-y-4">
        <div className="flex items-center gap-2 mb-4">
          <Bot className="w-5 h-5 text-green-600" />
          <h3 className="text-lg font-semibold text-gray-900">AI API</h3>
        </div>
        <AIConfigComponent />
      </section>

      <section className="space-y-4">
        <div className="flex items-center gap-2 mb-4">
          <Key className="w-5 h-5 text-purple-600" />
          <h3 className="text-lg font-semibold text-gray-900">キーワード検索・ChatWork通知</h3>
        </div>
        <ApiKeySettings />
      </section>

      {factCheckAllowed && (
        <details className="rounded-lg border border-amber-200 bg-amber-50 p-4">
          <summary className="flex cursor-pointer items-center gap-2 text-lg font-semibold text-gray-900">
            <ShieldCheck className="w-5 h-5 text-amber-600" />
            事実確認（ベータ）
          </summary>
          <p className="mt-3 text-sm text-gray-600">
            AIによる補助確認です。公開前に必ず内容をご確認ください。
          </p>
          <div className="mt-4">
            <FactCheckSettings />
          </div>
        </details>
      )}
    </div>
  );
};
