import React, { useEffect, useState } from 'react';
import { KeyRound, LogOut, Mail, Save, UserCircle } from 'lucide-react';
import toast from 'react-hot-toast';
import { useAppStore } from '../store/useAppStore';
import { useAuthStore } from '../store/useAuthStore';
import { getAuthErrorMessage } from '../utils/authErrorMessages';

export const ClientAccount: React.FC = () => {
  const { wordPressConfigs } = useAppStore();
  const { account, user, signOut, updateEmail, updatePassword } = useAuthStore();
  const wordpressLimit = account?.wordpress_site_limit ?? 0;
  const [email, setEmail] = useState(user?.email ?? '');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [emailMessage, setEmailMessage] = useState<string | null>(null);
  const [passwordMessage, setPasswordMessage] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [isUpdatingEmail, setIsUpdatingEmail] = useState(false);
  const [isUpdatingPassword, setIsUpdatingPassword] = useState(false);

  useEffect(() => {
    setEmail(user?.email ?? '');
  }, [user?.email]);

  const handleEmailSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    const nextEmail = email.trim();

    setFormError(null);
    setEmailMessage(null);
    if (!nextEmail || !nextEmail.includes('@')) {
      setFormError('有効なメールアドレスを入力してください。');
      return;
    }
    if (nextEmail === user?.email) {
      setEmailMessage('現在のメールアドレスと同じです。');
      return;
    }

    setIsUpdatingEmail(true);
    const loadingToast = toast.loading('メールアドレス変更を送信しています...');
    try {
      await updateEmail(nextEmail);
      setEmailMessage('メールアドレス変更を開始しました。確認メールが届いた場合は、メール内のリンクを開いて変更を完了してください。');
      toast.success('メールアドレス変更の確認メールを送信しました', { id: loadingToast });
    } catch (error) {
      const message = getAuthErrorMessage(error, 'メールアドレスを変更できませんでした。再ログインが必要な場合があります。');
      setFormError(message);
      toast.error(message, { id: loadingToast });
    } finally {
      setIsUpdatingEmail(false);
    }
  };

  const handlePasswordSubmit = async (event: React.FormEvent) => {
    event.preventDefault();

    setFormError(null);
    setPasswordMessage(null);
    if (newPassword.length < 8) {
      setFormError('新しいパスワードは8文字以上で入力してください。');
      return;
    }
    if (newPassword !== confirmPassword) {
      setFormError('確認用パスワードが一致しません。');
      return;
    }

    setIsUpdatingPassword(true);
    const loadingToast = toast.loading('パスワードを変更しています...');
    try {
      await updatePassword(newPassword);
      setNewPassword('');
      setConfirmPassword('');
      setPasswordMessage('パスワードを変更しました。');
      toast.success('パスワードを変更しました', { id: loadingToast });
    } catch (error) {
      const message = getAuthErrorMessage(error, 'パスワードを変更できませんでした。再ログインが必要な場合があります。');
      setFormError(message);
      toast.error(message, { id: loadingToast });
    } finally {
      setIsUpdatingPassword(false);
    }
  };

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

      {formError && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {formError}
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <form onSubmit={handleEmailSubmit} className="bg-white border border-gray-200 rounded-lg p-5 space-y-4">
          <div className="flex items-center gap-2">
            <Mail className="w-5 h-5 text-gray-700" />
            <h3 className="text-base font-semibold text-gray-900">メールアドレス変更</h3>
          </div>
          <label className="block space-y-1">
            <span className="text-sm font-medium text-gray-700">ログインメール</span>
            <input
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              autoComplete="email"
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100"
            />
          </label>
          {emailMessage && (
            <p className="text-sm text-green-700">{emailMessage}</p>
          )}
          <div className="flex justify-end">
            <button
              type="submit"
              disabled={isUpdatingEmail}
              className="inline-flex items-center gap-2 rounded-lg bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-800 disabled:bg-gray-400"
            >
              <Save className="w-4 h-4" />
              {isUpdatingEmail ? '変更中' : 'メールアドレスを変更'}
            </button>
          </div>
        </form>

        <form onSubmit={handlePasswordSubmit} className="bg-white border border-gray-200 rounded-lg p-5 space-y-4">
          <div className="flex items-center gap-2">
            <KeyRound className="w-5 h-5 text-gray-700" />
            <h3 className="text-base font-semibold text-gray-900">パスワード変更</h3>
          </div>
          <label className="block space-y-1">
            <span className="text-sm font-medium text-gray-700">新しいパスワード</span>
            <input
              type="password"
              value={newPassword}
              onChange={(event) => setNewPassword(event.target.value)}
              autoComplete="new-password"
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100"
            />
          </label>
          <label className="block space-y-1">
            <span className="text-sm font-medium text-gray-700">新しいパスワード（確認）</span>
            <input
              type="password"
              value={confirmPassword}
              onChange={(event) => setConfirmPassword(event.target.value)}
              autoComplete="new-password"
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100"
            />
          </label>
          {passwordMessage && (
            <p className="text-sm text-green-700">{passwordMessage}</p>
          )}
          <div className="flex justify-end">
            <button
              type="submit"
              disabled={isUpdatingPassword}
              className="inline-flex items-center gap-2 rounded-lg bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-800 disabled:bg-gray-400"
            >
              <Save className="w-4 h-4" />
              {isUpdatingPassword ? '変更中' : 'パスワードを変更'}
            </button>
          </div>
        </form>
      </div>

      <div className="flex justify-end">
        <button
          type="button"
          onClick={() => signOut()}
          className="inline-flex items-center gap-2 rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
        >
          <LogOut className="w-4 h-4" />
          ログアウト
        </button>
      </div>
    </div>
  );
};
