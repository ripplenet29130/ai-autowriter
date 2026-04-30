import React from 'react';
import { LogOut, UserCircle } from 'lucide-react';
import { useAppStore } from '../store/useAppStore';
import { useAuthStore } from '../store/useAuthStore';

export const ClientAccount: React.FC = () => {
  const { wordPressConfigs } = useAppStore();
  const { account, user, signOut } = useAuthStore();
  const wordpressLimit = account?.wordpress_site_limit ?? 0;

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <UserCircle className="w-8 h-8 text-gray-700" />
        <div>
          <h2 className="text-2xl font-bold text-gray-900">アカウント</h2>
          <p className="text-gray-600">契約中の利用状況とログイン情報を確認します。</p>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="bg-white border border-gray-200 rounded-lg p-5">
          <div className="text-sm text-gray-500">アカウント名</div>
          <div className="mt-2 text-lg font-semibold text-gray-900">{account?.name ?? '-'}</div>
        </div>
        <div className="bg-white border border-gray-200 rounded-lg p-5">
          <div className="text-sm text-gray-500">利用状態</div>
          <div className="mt-2 text-lg font-semibold text-green-700">
            {account?.status === 'active' ? '利用中' : '停止中'}
          </div>
        </div>
        <div className="bg-white border border-gray-200 rounded-lg p-5">
          <div className="text-sm text-gray-500">WordPress登録数</div>
          <div className="mt-2 text-lg font-semibold text-gray-900">
            {wordPressConfigs.length} / {wordpressLimit || '-'}
          </div>
        </div>
      </div>

      <div className="bg-white border border-gray-200 rounded-lg p-5">
        <div className="text-sm text-gray-500">ログインメール</div>
        <div className="mt-2 text-base font-medium text-gray-900">{user?.email ?? '-'}</div>
        <button
          type="button"
          onClick={() => signOut()}
          className="mt-5 inline-flex items-center gap-2 rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
        >
          <LogOut className="w-4 h-4" />
          ログアウト
        </button>
      </div>
    </div>
  );
};
