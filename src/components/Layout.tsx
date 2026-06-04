import React, { useEffect, useMemo } from 'react';
import {
  Bot,
  BookOpen,
  Calendar,
  FileText,
  LayoutDashboard,
  ListChecks,
  LogOut,
  Plug,
  Search,
  UserCircle,
} from 'lucide-react';
import { useAppStore } from '../store/useAppStore';
import { useAuthStore } from '../store/useAuthStore';

export const Layout: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { activeView, setActiveView } = useAppStore();
  const { account, user, signOut } = useAuthStore();
  const featureFlags = account?.feature_flags ?? {};

  const navigationGroups = useMemo(() => [
    {
      label: 'はじめる',
      items: [
        {
          id: 'dashboard',
          label: '初期設定ガイド',
          icon: ListChecks,
          description: '順番に設定を進める',
        },
      ],
    },
    {
      label: '記事を作る',
      items: [
        {
          id: 'generator',
          label: '新規記事作成',
          icon: Bot,
          description: 'AIで記事を作成・編集',
        },
        {
          id: 'templates',
          label: 'キーワード・型',
          icon: BookOpen,
          description: 'キーワード、タイトル、プロンプト',
        },
      ],
    },
    {
      label: '自動投稿',
      items: [
        {
          id: 'scheduler',
          label: '予約投稿設定',
          icon: Calendar,
          description: '投稿頻度と実行内容',
          enabled: featureFlags.scheduler !== false,
        },
        {
          id: 'operations',
          label: '稼働状況',
          icon: LayoutDashboard,
          description: '投稿予定と実行状況',
        },
      ],
    },
    {
      label: '記事を管理する',
      items: [
        {
          id: 'articles',
          label: '作成した記事',
          icon: FileText,
          description: '下書き・公開済みを確認',
        },
      ],
    },
    {
      label: '分析',
      items: [
        {
          id: 'seo-report',
          label: '分析・改善',
          icon: Search,
          description: 'Search Consoleレポート',
          enabled: featureFlags.wordpress_publish !== false,
        },
      ],
    },
    {
      label: '設定',
      items: [
        {
          id: 'connections',
          label: '接続・API設定',
          icon: Plug,
          description: 'WordPress、AI、検索API',
          enabled: featureFlags.wordpress_publish !== false,
        },
        {
          id: 'account',
          label: 'アカウント',
          icon: UserCircle,
          description: '利用状況とログアウト',
        },
      ],
    },
  ], [featureFlags.scheduler, featureFlags.wordpress_publish]);

  const visibleNavigationGroups = navigationGroups
    .map((group) => ({
      ...group,
      items: group.items.filter((item) => item.enabled !== false),
    }))
    .filter((group) => group.items.length > 0);

  const visibleNavigationItems = visibleNavigationGroups.flatMap((group) => group.items);
  const hiddenNavigationItemIds = ['wordpress', 'ai-config', 'keywords', 'titles', 'settings'];

  useEffect(() => {
    const isVisibleItem = visibleNavigationItems.some((item) => item.id === activeView);
    const isHiddenItem = hiddenNavigationItemIds.includes(activeView);

    if (!isVisibleItem && !isHiddenItem) {
      setActiveView('dashboard');
    }
  }, [activeView, setActiveView, visibleNavigationItems]);

  return (
    <div className="flex min-h-screen bg-gray-50">
      <aside className="w-64 border-r border-gray-200 bg-white shadow-lg">
        <div className="border-b border-gray-200 p-6">
          <h1 className="text-xl font-bold text-gray-900">AI Auto Writer ver.3.0</h1>
          <p className="mt-1 text-sm text-gray-600">AI記事作成・自動投稿ツール</p>
        </div>

        <nav className="space-y-5 p-4">
          {visibleNavigationGroups.map((group) => (
            <div key={group.label}>
              <div className="mb-2 px-2 text-xs font-semibold uppercase tracking-wide text-gray-400">{group.label}</div>
              <ul className="space-y-2">
                {group.items.map((item) => {
                  const Icon = item.icon;
                  const isActive = activeView === item.id;

                  return (
                    <li key={item.id}>
                      <button
                        type="button"
                        onClick={() => setActiveView(item.id)}
                        className={`flex w-full items-center space-x-3 rounded-lg px-4 py-3 text-left transition-all duration-200 ${
                          isActive
                            ? 'border border-blue-200 bg-blue-100 text-blue-700'
                            : 'text-gray-700 hover:bg-gray-100 hover:text-gray-900'
                        }`}
                      >
                        <Icon className={`h-5 w-5 ${isActive ? 'text-blue-600' : 'text-gray-500'}`} />
                        <div className="min-w-0 flex-1">
                          <div className="font-medium">{item.label}</div>
                          <div className="mt-0.5 text-xs text-gray-500">{item.description}</div>
                        </div>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </nav>
      </aside>

      <div className="flex-1 overflow-auto">
        <header className="border-b border-gray-200 bg-white px-8 py-4">
          <div className="flex items-center justify-between">
            <div>
              <div className="text-xl font-bold text-gray-900">{account?.name ?? '未設定アカウント'}</div>
            </div>
            <div className="flex items-center gap-3">
              <div className="text-sm text-gray-700">{user?.email}</div>
              <button
                type="button"
                onClick={() => signOut()}
                className="inline-flex items-center gap-2 rounded-lg border border-gray-300 px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
              >
                <LogOut className="h-4 w-4" />
                ログアウト
              </button>
            </div>
          </div>
        </header>
        <main className="p-8">
          {children}
        </main>
      </div>
    </div>
  );
};
