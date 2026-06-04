import React, { useState } from 'react';
import { Lock } from 'lucide-react';
import toast from 'react-hot-toast';
import { useAuthStore } from '../store/useAuthStore';
import { getAuthErrorMessage } from '../utils/authErrorMessages';

type LoginMode = 'login' | 'forgot' | 'update-password';

interface LoginProps {
  initialMode?: LoginMode;
  onPasswordUpdated?: () => void;
}

export const Login: React.FC<LoginProps> = ({ initialMode = 'login', onPasswordUpdated }) => {
  const {
    signInWithPassword,
    requestPasswordReset,
    updatePassword,
    isLoading,
    error,
  } = useAuthStore();
  const [mode, setMode] = useState<LoginMode>(initialMode);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [localError, setLocalError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const handlePasswordLogin = async (event: React.FormEvent) => {
    event.preventDefault();
    setLocalError(null);

    try {
      await signInWithPassword(email.trim(), password);
    } catch {
      setLocalError('メールアドレスまたはパスワードを確認してください。');
    }
  };

  const handlePasswordResetRequest = async (event: React.FormEvent) => {
    event.preventDefault();
    setLocalError(null);
    setMessage(null);

    if (!email.trim()) {
      setLocalError('メールアドレスを入力してください。');
      return;
    }

    const loadingToast = toast.loading('パスワード再設定メールを送信しています...');
    try {
      await requestPasswordReset(email.trim());
      setMessage('パスワード再設定メールを送信しました。メール内のリンクから新しいパスワードを設定してください。');
      toast.success('パスワード再設定メールを送信しました', { id: loadingToast });
    } catch (resetError) {
      const message = getAuthErrorMessage(resetError, 'パスワード再設定メールを送信できませんでした。');
      setLocalError(message);
      toast.error(message, { id: loadingToast });
    }
  };

  const handlePasswordUpdate = async (event: React.FormEvent) => {
    event.preventDefault();
    setLocalError(null);
    setMessage(null);

    if (newPassword.length < 8) {
      setLocalError('新しいパスワードは8文字以上にしてください。');
      return;
    }

    if (newPassword !== confirmPassword) {
      setLocalError('確認用パスワードが一致しません。');
      return;
    }

    const loadingToast = toast.loading('パスワードを更新しています...');
    try {
      await updatePassword(newPassword);
      onPasswordUpdated?.();
      setMessage('パスワードを更新しました。');
      toast.success('パスワードを更新しました', { id: loadingToast });
    } catch (updateError) {
      const message = getAuthErrorMessage(updateError, 'パスワードを更新できませんでした。リセットメールのリンクを開き直してください。');
      setLocalError(message);
      toast.error(message, { id: loadingToast });
    }
  };

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center px-4">
      <div className="w-full max-w-md bg-white border border-gray-200 rounded-lg shadow-sm p-8">
        <div className="flex items-center gap-3 mb-6">
          <div className="w-10 h-10 rounded-lg bg-blue-600 text-white flex items-center justify-center">
            <Lock className="w-5 h-5" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-gray-900">AI Auto Writer ver.3.0</h1>
            <p className="text-sm text-gray-500">
              {mode === 'login' && 'ログインしてください'}
              {mode === 'forgot' && 'パスワード再設定メールを送信します'}
              {mode === 'update-password' && '新しいパスワードを設定してください'}
            </p>
          </div>
        </div>

        {mode === 'login' && (
          <form onSubmit={handlePasswordLogin} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                メールアドレス
              </label>
              <input
                type="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
                autoComplete="email"
                required
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                パスワード
              </label>
              <input
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
                autoComplete="current-password"
                required
              />
            </div>

            {(localError || error) && (
              <div className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
                {localError || error}
              </div>
            )}

            {message && (
              <div className="text-sm text-green-700 bg-green-50 border border-green-200 rounded-lg px-3 py-2">
                {message}
              </div>
            )}

            <button
              type="submit"
              disabled={isLoading}
              className="w-full bg-blue-600 hover:bg-blue-700 disabled:bg-blue-300 text-white font-medium rounded-lg px-4 py-2.5 transition-colors"
            >
              ログイン
            </button>

            <button
              type="button"
              onClick={() => {
                setMode('forgot');
                setLocalError(null);
                setMessage(null);
              }}
              className="w-full text-sm text-blue-600 hover:text-blue-700 font-medium"
            >
              パスワードを忘れた方
            </button>
          </form>
        )}

        {mode === 'forgot' && (
          <form onSubmit={handlePasswordResetRequest} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                メールアドレス
              </label>
              <input
                type="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
                autoComplete="email"
                required
              />
            </div>

            {(localError || error) && (
              <div className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
                {localError || error}
              </div>
            )}

            {message && (
              <div className="text-sm text-green-700 bg-green-50 border border-green-200 rounded-lg px-3 py-2">
                {message}
              </div>
            )}

            <button
              type="submit"
              disabled={isLoading}
              className="w-full bg-blue-600 hover:bg-blue-700 disabled:bg-blue-300 text-white font-medium rounded-lg px-4 py-2.5 transition-colors"
            >
              再設定メールを送信
            </button>

            <button
              type="button"
              onClick={() => {
                setMode('login');
                setLocalError(null);
                setMessage(null);
              }}
              className="w-full text-sm text-gray-600 hover:text-gray-800 font-medium"
            >
              ログインに戻る
            </button>
          </form>
        )}

        {mode === 'update-password' && (
          <form onSubmit={handlePasswordUpdate} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                新しいパスワード
              </label>
              <input
                type="password"
                value={newPassword}
                onChange={(event) => setNewPassword(event.target.value)}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
                autoComplete="new-password"
                required
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                新しいパスワード（確認）
              </label>
              <input
                type="password"
                value={confirmPassword}
                onChange={(event) => setConfirmPassword(event.target.value)}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
                autoComplete="new-password"
                required
              />
            </div>

            {(localError || error) && (
              <div className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
                {localError || error}
              </div>
            )}

            {message && (
              <div className="text-sm text-green-700 bg-green-50 border border-green-200 rounded-lg px-3 py-2">
                {message}
              </div>
            )}

            <button
              type="submit"
              disabled={isLoading}
              className="w-full bg-blue-600 hover:bg-blue-700 disabled:bg-blue-300 text-white font-medium rounded-lg px-4 py-2.5 transition-colors"
            >
              パスワードを更新
            </button>
          </form>
        )}

      </div>
    </div>
  );
};
