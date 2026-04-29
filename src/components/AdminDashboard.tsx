import React, { useEffect, useState } from 'react';
import { LogOut, RefreshCw, Users } from 'lucide-react';
import { supabase } from '../services/supabaseClient';
import { Account, useAuthStore } from '../store/useAuthStore';

export const AdminDashboard: React.FC = () => {
  const { user, signOut } = useAuthStore();
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadAccounts = async () => {
    if (!supabase) return;

    setIsLoading(true);
    setError(null);

    const { data, error: loadError } = await supabase
      .from('accounts')
      .select('id,name,status,wordpress_site_limit,feature_flags,monthly_article_limit')
      .order('created_at', { ascending: false });

    if (loadError) {
      setError(loadError.message);
      setIsLoading(false);
      return;
    }

    setAccounts((data as Account[]) ?? []);
    setIsLoading(false);
  };

  useEffect(() => {
    loadAccounts().catch((loadError) => {
      setError(loadError instanceof Error ? loadError.message : '管理データを読み込めませんでした。');
      setIsLoading(false);
    });
  }, []);

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white border-b border-gray-200">
        <div className="max-w-7xl mx-auto px-6 py-4 flex items-center justify-between">
          <div>
            <h1 className="text-xl font-bold text-gray-900">管理画面</h1>
            <p className="text-sm text-gray-500">{user?.email}</p>
          </div>
          <button
            type="button"
            onClick={() => signOut()}
            className="inline-flex items-center gap-2 border border-gray-300 hover:bg-gray-50 text-gray-700 rounded-lg px-3 py-2 text-sm font-medium"
          >
            <LogOut className="w-4 h-4" />
            ログアウト
          </button>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-6 py-8">
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-blue-600 text-white flex items-center justify-center">
              <Users className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-lg font-semibold text-gray-900">clientアカウント</h2>
              <p className="text-sm text-gray-500">登録済みアカウントの確認</p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => loadAccounts()}
            className="inline-flex items-center gap-2 border border-gray-300 hover:bg-gray-50 text-gray-700 rounded-lg px-3 py-2 text-sm font-medium"
          >
            <RefreshCw className="w-4 h-4" />
            更新
          </button>
        </div>

        {error && (
          <div className="mb-4 text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-4 py-3">
            {error}
          </div>
        )}

        <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr>
                <th className="text-left px-4 py-3 font-medium text-gray-600">名前</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600">状態</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600">WordPress上限</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600">月間記事上限</th>
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                <tr>
                  <td colSpan={4} className="px-4 py-8 text-center text-gray-500">
                    読み込み中です
                  </td>
                </tr>
              ) : accounts.length === 0 ? (
                <tr>
                  <td colSpan={4} className="px-4 py-8 text-center text-gray-500">
                    アカウントがありません
                  </td>
                </tr>
              ) : (
                accounts.map((account) => (
                  <tr key={account.id} className="border-b border-gray-100 last:border-b-0">
                    <td className="px-4 py-3 font-medium text-gray-900">{account.name}</td>
                    <td className="px-4 py-3">
                      <span className={`inline-flex rounded-full px-2 py-1 text-xs font-medium ${
                        account.status === 'active'
                          ? 'bg-green-50 text-green-700'
                          : 'bg-red-50 text-red-700'
                      }`}>
                        {account.status === 'active' ? '利用中' : '停止中'}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-gray-700">{account.wordpress_site_limit}</td>
                    <td className="px-4 py-3 text-gray-700">
                      {account.monthly_article_limit ?? '無制限'}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </main>
    </div>
  );
};
