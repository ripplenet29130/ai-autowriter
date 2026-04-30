import React, { useEffect, useMemo, useState } from 'react';
import { LogOut, Plus, RefreshCw, Save, Users } from 'lucide-react';
import { supabase } from '../services/supabaseClient';
import { Account, useAuthStore } from '../store/useAuthStore';

type AccountRow = Account & {
  wordpress_count?: number;
  article_count?: number;
  schedule_count?: number;
  created_at?: string;
  updated_at?: string;
};

const defaultFeatureFlags = {
  wordpress_publish: true,
  scheduler: true,
  image_generation: true,
  fact_check: true,
};

const featureOptions: Array<{ key: keyof typeof defaultFeatureFlags; label: string }> = [
  { key: 'wordpress_publish', label: 'WP投稿' },
  { key: 'scheduler', label: '予約' },
  { key: 'image_generation', label: '画像' },
  { key: 'fact_check', label: '校正' },
];

export const AdminDashboard: React.FC = () => {
  const { user, signOut } = useAuthStore();
  const [accounts, setAccounts] = useState<AccountRow[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [newAccount, setNewAccount] = useState({
    name: '',
    email: '',
    password: '',
    wordpress_site_limit: 1,
    monthly_article_limit: '',
  });

  const activeCount = useMemo(
    () => accounts.filter((account) => account.status === 'active').length,
    [accounts]
  );

  const loadAccounts = async () => {
    if (!supabase) return;
    const client = supabase;

    setIsLoading(true);
    setError(null);
    setMessage(null);

    const { data, error: loadError } = await supabase
      .from('accounts')
      .select('id,name,status,wordpress_site_limit,feature_flags,monthly_article_limit,created_at,updated_at')
      .order('created_at', { ascending: false });

    if (loadError) {
      setError(loadError.message);
      setIsLoading(false);
      return;
    }

    const rows = ((data as AccountRow[]) ?? []);
    const rowsWithCounts = await Promise.all(
      rows.map(async (account) => {
        const { count } = await client
          .from('wordpress_configs')
          .select('*', { count: 'exact', head: true })
          .eq('account_id', account.id);

        const { count: articleCount } = await client
          .from('articles')
          .select('*', { count: 'exact', head: true })
          .eq('account_id', account.id);

        const { count: scheduleCount } = await client
          .from('schedule_settings')
          .select('*', { count: 'exact', head: true })
          .eq('account_id', account.id);

        return {
          ...account,
          wordpress_count: count ?? 0,
          article_count: articleCount ?? 0,
          schedule_count: scheduleCount ?? 0,
        };
      })
    );

    setAccounts(rowsWithCounts);
    setIsLoading(false);
  };

  useEffect(() => {
    loadAccounts().catch((loadError) => {
      setError(loadError instanceof Error ? loadError.message : '管理データを読み込めませんでした。');
      setIsLoading(false);
    });
  }, []);

  const createAccount = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!supabase) return;

    const name = newAccount.name.trim();
    if (!name) {
      setError('client名を入力してください。');
      return;
    }

    setIsSaving(true);
    setError(null);
    setMessage(null);

    const email = newAccount.email.trim();
    const password = newAccount.password;
    const monthlyLimit = String(newAccount.monthly_article_limit).trim();
    const payload = {
        name,
        wordpress_site_limit: Number(newAccount.wordpress_site_limit) || 1,
        monthly_article_limit: monthlyLimit ? Number(monthlyLimit) : null,
    };

    if ((email || password) && (!email || password.length < 8)) {
      setError('ログインユーザーも作成する場合は、メールアドレスと8文字以上の初期パスワードを入力してください。');
      setIsSaving(false);
      return;
    }

    const { error: insertError } = email
      ? await supabase.functions.invoke('admin-create-client-user', {
          body: {
            ...payload,
            email,
            password,
          },
        })
      : await supabase
          .from('accounts')
          .insert({
            ...payload,
            status: 'active',
            feature_flags: defaultFeatureFlags,
          });

    if (insertError) {
      setError(insertError.message);
      setIsSaving(false);
      return;
    }

    setNewAccount({ name: '', email: '', password: '', wordpress_site_limit: 1, monthly_article_limit: '' });
    setMessage(email
      ? 'clientアカウントとログインユーザーを作成しました。初期パスワードは安全な方法で共有してください。'
      : 'clientアカウントを作成しました。ログインユーザーの紐づけはprofilesで設定してください。'
    );
    await loadAccounts();
    setIsSaving(false);
  };

  const updateAccount = async (
    id: string,
    updates: Partial<Pick<AccountRow, 'name' | 'status' | 'wordpress_site_limit' | 'monthly_article_limit' | 'feature_flags'>>
  ) => {
    if (!supabase) return;

    setIsSaving(true);
    setError(null);
    setMessage(null);

    const { error: updateError } = await supabase
      .from('accounts')
      .update(updates)
      .eq('id', id);

    if (updateError) {
      setError(updateError.message);
      setIsSaving(false);
      return;
    }

    setMessage('更新しました。');
    await loadAccounts();
    setIsSaving(false);
  };

  const formatDate = (value?: string) => {
    if (!value) return '-';
    return new Intl.DateTimeFormat('ja-JP', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(new Date(value));
  };

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

      <main className="max-w-7xl mx-auto px-6 py-8 space-y-6">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="bg-white border border-gray-200 rounded-lg p-4">
            <div className="text-sm text-gray-500">client数</div>
            <div className="text-2xl font-bold text-gray-900">{accounts.length}</div>
          </div>
          <div className="bg-white border border-gray-200 rounded-lg p-4">
            <div className="text-sm text-gray-500">利用中</div>
            <div className="text-2xl font-bold text-green-700">{activeCount}</div>
          </div>
          <div className="bg-white border border-gray-200 rounded-lg p-4">
            <div className="text-sm text-gray-500">停止中</div>
            <div className="text-2xl font-bold text-red-700">{accounts.length - activeCount}</div>
          </div>
        </div>

        <form onSubmit={createAccount} className="bg-white border border-gray-200 rounded-lg p-5">
          <div className="flex items-center gap-3 mb-4">
            <div className="w-10 h-10 rounded-lg bg-blue-600 text-white flex items-center justify-center">
              <Plus className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-lg font-semibold text-gray-900">client新規作成</h2>
              <p className="text-sm text-gray-500">契約先アカウントを追加します</p>
            </div>
          </div>

          <div className="space-y-4">
            <label className="block space-y-1">
              <span className="block text-sm font-medium text-gray-700">client名</span>
              <input
                value={newAccount.name}
                onChange={(event) => setNewAccount((prev) => ({ ...prev, name: event.target.value }))}
                placeholder="例: 株式会社サンプル"
                className="w-full border border-gray-300 rounded-lg px-3 py-2"
              />
            </label>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <label className="space-y-1">
                <span className="block text-sm font-medium text-gray-700">ログインメール</span>
                <input
                  type="email"
                  value={newAccount.email}
                  onChange={(event) => setNewAccount((prev) => ({ ...prev, email: event.target.value }))}
                  placeholder="client@example.com"
                  className="w-full border border-gray-300 rounded-lg px-3 py-2"
                />
              </label>
              <label className="space-y-1">
                <span className="block text-sm font-medium text-gray-700">初期パスワード</span>
                <input
                  type="password"
                  value={newAccount.password}
                  onChange={(event) => setNewAccount((prev) => ({ ...prev, password: event.target.value }))}
                  placeholder="8文字以上"
                  className="w-full border border-gray-300 rounded-lg px-3 py-2"
                  autoComplete="new-password"
                />
              </label>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <label className="space-y-1">
                <span className="block text-sm font-medium text-gray-700">WordPress登録数上限</span>
                <input
                  type="number"
                  min={0}
                  value={newAccount.wordpress_site_limit}
                  onChange={(event) => setNewAccount((prev) => ({ ...prev, wordpress_site_limit: Number(event.target.value) }))}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2"
                />
              </label>
              <label className="space-y-1">
                <span className="block text-sm font-medium text-gray-700">月間記事上限</span>
                <input
                  type="number"
                  min={0}
                  value={newAccount.monthly_article_limit}
                  onChange={(event) => setNewAccount((prev) => ({ ...prev, monthly_article_limit: event.target.value }))}
                  placeholder="無制限"
                  className="w-full border border-gray-300 rounded-lg px-3 py-2"
                />
              </label>
            </div>
          </div>

          <div className="flex justify-end mt-4">
            <button
              type="submit"
              disabled={isSaving}
              className="inline-flex items-center gap-2 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-300 text-white rounded-lg px-4 py-2 text-sm font-medium"
            >
              <Save className="w-4 h-4" />
              作成
            </button>
          </div>
        </form>

        <section className="bg-white border border-gray-200 rounded-lg overflow-hidden">
          <div className="px-5 py-4 border-b border-gray-200 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-lg bg-gray-900 text-white flex items-center justify-center">
                <Users className="w-5 h-5" />
              </div>
              <div>
                <h2 className="text-lg font-semibold text-gray-900">client一覧</h2>
                <p className="text-sm text-gray-500">登録済みアカウントの確認と編集</p>
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
            <div className="m-4 text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-4 py-3">
              {error}
            </div>
          )}

          {message && (
            <div className="m-4 text-sm text-green-700 bg-green-50 border border-green-200 rounded-lg px-4 py-3">
              {message}
            </div>
          )}

          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 border-b border-gray-200">
                <tr>
                  <th className="text-left px-4 py-3 font-medium text-gray-600">名前</th>
                  <th className="text-left px-4 py-3 font-medium text-gray-600">状態</th>
                  <th className="text-left px-4 py-3 font-medium text-gray-600">WordPress</th>
                  <th className="text-left px-4 py-3 font-medium text-gray-600">利用状況</th>
                  <th className="text-left px-4 py-3 font-medium text-gray-600">月間記事上限</th>
                  <th className="text-left px-4 py-3 font-medium text-gray-600">機能</th>
                  <th className="text-left px-4 py-3 font-medium text-gray-600">更新日</th>
                  <th className="text-left px-4 py-3 font-medium text-gray-600">操作</th>
                </tr>
              </thead>
              <tbody>
                {isLoading ? (
                  <tr>
                    <td colSpan={8} className="px-4 py-8 text-center text-gray-500">
                      読み込み中です
                    </td>
                  </tr>
                ) : accounts.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="px-4 py-8 text-center text-gray-500">
                      アカウントがありません
                    </td>
                  </tr>
                ) : (
                  accounts.map((account) => (
                    <tr key={account.id} className="border-b border-gray-100 last:border-b-0">
                      <td className="px-4 py-3">
                        <label className="space-y-1">
                          <span className="block text-xs font-medium text-gray-500">client名</span>
                          <input
                            value={account.name}
                            onChange={(event) =>
                              setAccounts((prev) =>
                                prev.map((item) => item.id === account.id ? { ...item, name: event.target.value } : item)
                              )
                            }
                            className="border border-gray-300 rounded-lg px-3 py-2 min-w-56"
                          />
                        </label>
                      </td>
                      <td className="px-4 py-3">
                        <label className="space-y-1">
                          <span className="block text-xs font-medium text-gray-500">利用状態</span>
                          <select
                            value={account.status}
                            onChange={(event) =>
                              updateAccount(account.id, { status: event.target.value as Account['status'] })
                            }
                            className="border border-gray-300 rounded-lg px-3 py-2"
                          >
                            <option value="active">利用中</option>
                            <option value="suspended">停止中</option>
                          </select>
                        </label>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          <label className="space-y-1">
                            <span className="block text-xs font-medium text-gray-500">登録上限</span>
                            <input
                              type="number"
                              min={0}
                              value={account.wordpress_site_limit}
                              onChange={(event) =>
                                setAccounts((prev) =>
                                  prev.map((item) => item.id === account.id
                                    ? { ...item, wordpress_site_limit: Number(event.target.value) }
                                    : item)
                                )
                              }
                              className="border border-gray-300 rounded-lg px-3 py-2 w-24"
                            />
                          </label>
                          <span className="text-gray-500">
                            登録済み {account.wordpress_count ?? 0}
                          </span>
                        </div>
                      </td>
                      <td className="px-4 py-3 text-gray-600">
                        <div>記事 {account.article_count ?? 0}</div>
                        <div>予約 {account.schedule_count ?? 0}</div>
                      </td>
                      <td className="px-4 py-3">
                        <label className="space-y-1">
                          <span className="block text-xs font-medium text-gray-500">月間記事上限</span>
                          <input
                            type="number"
                            min={0}
                            value={account.monthly_article_limit ?? ''}
                            onChange={(event) =>
                              setAccounts((prev) =>
                                prev.map((item) => item.id === account.id
                                  ? {
                                      ...item,
                                      monthly_article_limit: event.target.value ? Number(event.target.value) : null,
                                    }
                                  : item)
                              )
                            }
                            placeholder="無制限"
                            className="border border-gray-300 rounded-lg px-3 py-2 w-28"
                          />
                        </label>
                      </td>
                      <td className="px-4 py-3">
                        <div className="grid grid-cols-2 gap-2 min-w-48">
                          {featureOptions.map((feature) => (
                            <label key={feature.key} className="inline-flex items-center gap-1.5 text-xs text-gray-600">
                              <input
                                type="checkbox"
                                checked={Boolean((account.feature_flags ?? defaultFeatureFlags)[feature.key])}
                                onChange={(event) =>
                                  setAccounts((prev) =>
                                    prev.map((item) => item.id === account.id
                                      ? {
                                          ...item,
                                          feature_flags: {
                                            ...defaultFeatureFlags,
                                            ...(item.feature_flags ?? {}),
                                            [feature.key]: event.target.checked,
                                          },
                                        }
                                      : item)
                                  )
                                }
                                className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                              />
                              <span>{feature.label}</span>
                            </label>
                          ))}
                        </div>
                      </td>
                      <td className="px-4 py-3 text-gray-500 whitespace-nowrap">
                        <div>{formatDate(account.updated_at)}</div>
                        <div className="text-xs">作成 {formatDate(account.created_at)}</div>
                      </td>
                      <td className="px-4 py-3">
                        <button
                          type="button"
                          disabled={isSaving}
                          onClick={() => updateAccount(account.id, {
                            name: account.name,
                            wordpress_site_limit: account.wordpress_site_limit,
                            monthly_article_limit: account.monthly_article_limit,
                            feature_flags: {
                              ...defaultFeatureFlags,
                              ...(account.feature_flags ?? {}),
                            },
                          })}
                          className="inline-flex items-center gap-2 bg-gray-900 hover:bg-gray-800 disabled:bg-gray-400 text-white rounded-lg px-3 py-2 text-sm font-medium"
                        >
                          <Save className="w-4 h-4" />
                          保存
                        </button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </section>
      </main>
    </div>
  );
};
