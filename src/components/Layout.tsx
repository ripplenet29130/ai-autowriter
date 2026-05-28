import React, { useEffect, useMemo } from 'react';
import {
  Bot,
  BookOpen,
  Calendar,
  FileText,
  LayoutDashboard,
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

  const navigationItems = useMemo(() => [
    {
      id: 'dashboard',
      label: 'ホーム',
      icon: LayoutDashboard,
      description: '運用状況と次の操作',
    },
    {
      id: 'generator',
      label: '記事作成',
      icon: Bot,
      description: '確認しながら作成・おまかせ作成',
    },
    {
      id: 'articles',
      label: '記事管理',
      icon: FileText,
      description: '生成済み記事の管理',
    },
    {
      id: 'scheduler',
      label: '予約投稿',
      icon: Calendar,
      description: '自動投稿スケジュール',
      enabled: featureFlags.scheduler !== false,
    },
    {
      id: 'templates',
      label: 'テンプレート',
      icon: BookOpen,
      description: 'キーワード・タイトル管理',
    },
    {
      id: 'seo-report',
      label: 'SEOレポート',
      icon: Search,
      description: 'Search Console分析',
      enabled: featureFlags.wordpress_publish !== false,
    },
    {
      id: 'connections',
      label: '接続設定',
      icon: Plug,
      description: 'WordPress・AI・通知設定',
      enabled: featureFlags.wordpress_publish !== false,
    },
    {
      id: 'account',
      label: 'アカウント',
      icon: UserCircle,
      description: '利用状況とログアウト',
    },
  ], [featureFlags.scheduler, featureFlags.wordpress_publish]);

  const visibleNavigationItems = navigationItems.filter((item) => item.enabled !== false);

  useEffect(() => {
    if (!visibleNavigationItems.some((item) => item.id === activeView)) {
      setActiveView('dashboard');
    }
  }, [activeView, setActiveView, visibleNavigationItems]);

  return (
    <div className="flex min-h-screen bg-gray-50">
      <aside className="w-64 border-r border-gray-200 bg-white shadow-lg">
        <div className="border-b border-gray-200 p-6">
          <h1 className="text-xl font-bold text-gray-900">AI Auto Writer ver.3.0</h1>
          <p className="mt-1 text-sm text-gray-600">自動記事生成・投稿ツール</p>
        </div>

        <nav className="p-4">
          <ul className="space-y-2">
            {visibleNavigationItems.map((item) => {
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
        </nav>
      </aside>

      <div className="flex-1 overflow-auto">
        <header className="border-b border-gray-200 bg-white px-8 py-4">
          <div className="flex items-center justify-between">
            <div>
              <div className="text-xl font-bold text-gray-900">{account?.name ?? '未設定'}</div>
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
