import React from 'react';
import {
  LayoutDashboard,
  Bot,
  FileText,
  TrendingUp,
  Calendar,
  Globe,
  Zap,
  Settings,
  Tag,
  Heading
} from 'lucide-react';
import { useAppStore } from '../store/useAppStore';

export const Layout: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { activeView, setActiveView } = useAppStore();

  const navigationItems = [
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
      description: '自動投稿スケジュール'
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
      description: '投稿先WordPress管理'
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
      description: 'API設定とデータ管理'
    }
  ];

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
            {navigationItems.map((item) => {
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
        <div className="p-8">
          {children}
        </div>
      </div>
    </div>
  );
};