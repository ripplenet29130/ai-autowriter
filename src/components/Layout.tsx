import { Link, useLocation } from 'react-router-dom';
import { LayoutDashboard, Brain, Globe, Calendar, TrendingUp, FileText } from 'lucide-react';

export default function Layout({ children }: { children: React.ReactNode }) {
  const location = useLocation();

  const navItems = [
    { path: '/', label: 'ダッシュボード', icon: LayoutDashboard },
    { path: '/ai-settings', label: 'AI設定', icon: Brain },
    { path: '/wp-settings', label: 'WordPress設定', icon: Globe },
    { path: '/trend-analysis', label: 'トレンド分析', icon: TrendingUp },
    { path: '/scheduler', label: 'スケジューラー', icon: Calendar },
    { path: '/article-generator', label: '記事生成', icon: FileText },
  ];

  return (
    <div className="flex h-screen bg-gray-50">
      <aside className="w-64 bg-white border-r border-gray-200">
        <div className="p-6">
          <h1 className="text-xl font-bold text-gray-800">AI AutoWriter</h1>
        </div>
        <nav className="px-3">
          {navItems.map((item) => {
            const Icon = item.icon;
            const isActive = location.pathname === item.path;
            return (
              <Link
                key={item.path}
                to={item.path}
                className={`flex items-center gap-3 px-4 py-3 mb-1 rounded-lg transition-colors ${
                  isActive
                    ? 'bg-blue-50 text-blue-600'
                    : 'text-gray-700 hover:bg-gray-100'
                }`}
              >
                <Icon className="w-5 h-5" />
                <span className="font-medium">{item.label}</span>
              </Link>
            );
          })}
        </nav>
      </aside>
      <main className="flex-1 overflow-auto">
        <div className="max-w-7xl mx-auto p-8">
          {children}
        </div>
      </main>
    </div>
  );
}
