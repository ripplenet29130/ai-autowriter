import React, { useEffect, useMemo } from 'react';
import {
  LayoutDashboard,
  Bot,
  FileText,
  Calendar,
  Globe,
  LogOut,
  Zap,
  Settings,
  Tag,
  Heading
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
      label: 'ダッシュボード',
      icon: LayoutDashboard,
      description: '概要とシステム状態'
    },
    {
      id: 'generator',
      label: 'AI記事生成',
      icon: Bot,
      description: 'AIで記事を自動生成'
    },
    {
      id: 'articles',
      label: '記事一覧',
      icon: FileText,
      description: '生成済み記事の管理'
    },
    {
      id: 'scheduler',
      label: 'スケジューラー',
      icon: Calendar,
      description: '自動投稿スケジュール',
      enabled: featureFlags.scheduler !== false,
    },
    {
      id: 'keywords',
      label: 'キーワード設定',
      icon: Tag,
      description: 'プリセットキーワード管理'
    },
    {
      id: 'titles',
      label: 'タイトルリスト設定',
      icon: Heading,
      description: 'プリセットタイトル管理'
    },
    {
      id: 'wordpress',
      label: 'WordPress設定',
      icon: Globe,
      description: '投稿先WordPress管理',
      enabled: featureFlags.wordpress_publish !== false,
    },
    {
      id: 'ai-config',
      label: 'AI設定',
      icon: Zap,
      description: 'AI API設定'
    },
    {
      id: 'settings',
      label: '設定',
      icon: Settings,
      description: 'API設定とデータ管理',
      enabled: featureFlags.fact_check !== false,
    }
  ], [featureFlags.fact_check, featureFlags.scheduler, featureFlags.wordpress_publish]);

  const visibleNavigationItems = navigationItems.filter((item) => item.enabled !== false);

  useEffect(() => {
    if (!visibleNavigationItems.some((item) => item.id === activeView)) {
      setActiveView('dashboard');
    }
  }, [activeView, setActiveView, visibleNavigationItems]);

  return (
    <div className="min-h-screen bg-gray-50 flex">
      {/* Sidebar Navigation */}
      <div className="w-64 bg-white shadow-lg border-r border-gray-200">
        <div className="p-6 border-b border-gray-200">
          <h1 className="text-xl font-bold text-gray-900">AI Auto Writer Ver.2.0</h1>
          <p className="text-sm text-gray-600 mt-1">自動記事生成・投稿ツール</p>
        </div>

        <nav className="p-4">
          <ul className="space-y-2">
            {visibleNavigationItems.map((item) => {
              const Icon = item.icon;
              const isActive = activeView === item.id;

              return (
                <li key={item.id}>
                  <button
                    onClick={() => setActiveView(item.id)}
                    className={`w-full flex items-center space-x-3 px-4 py-3 rounded-lg text-left transition-all duration-200 ${isActive
                      ? 'bg-blue-100 text-blue-700 border border-blue-200'
                      : 'text-gray-700 hover:bg-gray-100 hover:text-gray-900'
                      }`}
                  >
                    <Icon className={`w-5 h-5 ${isActive ? 'text-blue-600' : 'text-gray-500'}`} />
                    <div className="flex-1">
                      <div className="font-medium">{item.label}</div>
                      <div className="text-xs text-gray-500 mt-0.5">{item.description}</div>
                    </div>
                  </button>
                </li>
              );
            })}
          </ul>
        </nav>
      </div>

      {/* Main Content */}
      <div className="flex-1 overflow-auto">
        <header className="bg-white border-b border-gray-200 px-8 py-4">
          <div className="flex items-center justify-between">
            <div>
              <div className="text-xl font-bold text-gray-900">{account?.name ?? '未設定'}</div>
            </div>
            <div className="flex items-center gap-3">
              <div className="text-sm text-gray-700">{user?.email}</div>
              <button
                type="button"
                onClick={() => signOut()}
                className="inline-flex items-center gap-2 border border-gray-300 hover:bg-gray-50 text-gray-700 rounded-lg px-3 py-2 text-sm font-medium"
              >
                <LogOut className="w-4 h-4" />
                ログアウト
              </button>
            </div>
          </div>
        </header>
        <div className="p-8">
          {children}
        </div>
      </div>
    </div>
  );
};
