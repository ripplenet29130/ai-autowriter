import React, { useState } from 'react';
import { Bell, Bot, Globe, Key, Plug, ShieldCheck } from 'lucide-react';
import { ChatWorkNotificationSettings, SearchApiSettings } from './ApiKeySettings';
import { FactCheckSettings } from './FactCheckSettings';
import { AIConfigComponent } from './AIConfig';
import { WordPressConfigComponent } from './WordPressConfig';
import { useAuthStore } from '../store/useAuthStore';

type Requirement = '必須' | '任意';
type SettingsTab = 'wordpress' | 'ai' | 'search-api' | 'notifications' | 'fact-check';

const baseTabs: Array<{
  id: SettingsTab;
  label: string;
  description: string;
  requirement: Requirement;
  icon: React.ComponentType<{ className?: string }>;
}> = [
  {
    id: 'wordpress',
    label: 'WordPress設定',
    description: '投稿先サイトとSearch Console連携',
    requirement: '必須',
    icon: Globe,
  },
  {
    id: 'ai',
    label: 'AI設定',
    description: '記事作成に使うAI API',
    requirement: '必須',
    icon: Bot,
  },
  {
    id: 'search-api',
    label: '検索API設定',
    description: 'キーワード検索と競合確認',
    requirement: '必須',
    icon: Key,
  },
  {
    id: 'notifications',
    label: '通知設定',
    description: '予約投稿のChatWork通知',
    requirement: '任意',
    icon: Bell,
  },
  {
    id: 'fact-check',
    label: 'ファクトチェック設定',
    description: 'Perplexityによる事実確認',
    requirement: '任意',
    icon: ShieldCheck,
  },
];

export const SettingsComponent: React.FC = () => {
  const factCheckAllowed = useAuthStore((state) => state.account?.feature_flags?.fact_check !== false);
  const tabs = factCheckAllowed ? baseTabs : baseTabs.filter((tab) => tab.id !== 'fact-check');
  const [activeTab, setActiveTab] = useState<SettingsTab>(() => {
    const savedTab = window.localStorage.getItem('settings_active_tab') as SettingsTab | null;
    return savedTab ?? 'wordpress';
  });

  const visibleActiveTab = tabs.some((tab) => tab.id === activeTab) ? activeTab : tabs[0].id;

  const handleTabClick = (tabId: SettingsTab) => {
    window.localStorage.setItem('settings_active_tab', tabId);
    setActiveTab(tabId);
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Plug className="h-8 w-8 text-gray-700" />
        <div>
          <h2 className="text-2xl font-bold text-gray-900">接続・API設定</h2>
          <p className="text-gray-600">
            必須設定と任意設定を分けて、外部サービスとの連携を管理します。
          </p>
        </div>
      </div>

      <div className="border-b border-gray-200">
        <div className="flex flex-wrap gap-2">
          {tabs.map((tab) => {
            const Icon = tab.icon;
            const isActive = visibleActiveTab === tab.id;
            const isRequired = tab.requirement === '必須';

            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => handleTabClick(tab.id)}
                className={`flex min-w-[180px] items-center gap-3 rounded-t-lg border border-b-0 px-4 py-3 text-left transition-colors ${
                  isActive
                    ? 'border-gray-200 bg-white text-blue-700'
                    : 'border-transparent text-gray-600 hover:bg-gray-100 hover:text-gray-900'
                }`}
              >
                <Icon className={`h-5 w-5 ${isActive ? 'text-blue-600' : 'text-gray-500'}`} />
                <span className="min-w-0">
                  <span className="flex items-center gap-2">
                    <span className="block text-sm font-semibold">{tab.label}</span>
                    <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${
                      isRequired ? 'bg-red-50 text-red-700' : 'bg-gray-100 text-gray-600'
                    }`}>
                      {tab.requirement}
                    </span>
                  </span>
                  <span className="block text-xs text-gray-500">{tab.description}</span>
                </span>
              </button>
            );
          })}
        </div>
      </div>

      <div>
        {visibleActiveTab === 'wordpress' && <WordPressConfigComponent />}
        {visibleActiveTab === 'ai' && <AIConfigComponent />}
        {visibleActiveTab === 'search-api' && <SearchApiSettings />}
        {visibleActiveTab === 'notifications' && <ChatWorkNotificationSettings />}
        {visibleActiveTab === 'fact-check' && factCheckAllowed && <FactCheckSettings />}
      </div>
    </div>
  );
};
