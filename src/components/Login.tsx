import React, { useState } from 'react';
import { Chrome, Lock } from 'lucide-react';
import { useAuthStore } from '../store/useAuthStore';

export const Login: React.FC = () => {
  const { signInWithPassword, signInWithGoogle, isLoading, error } = useAuthStore();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [localError, setLocalError] = useState<string | null>(null);

  const handlePasswordLogin = async (event: React.FormEvent) => {
    event.preventDefault();
    setLocalError(null);

    try {
      await signInWithPassword(email.trim(), password);
    } catch {
      setLocalError('メールアドレスまたはパスワードを確認してください。');
    }
  };

  const handleGoogleLogin = async () => {
    setLocalError(null);

    try {
      await signInWithGoogle();
    } catch {
      setLocalError('Googleログインを開始できませんでした。');
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
            <h1 className="text-xl font-bold text-gray-900">AI Auto Writer</h1>
            <p className="text-sm text-gray-500">ログインしてください</p>
          </div>
        </div>

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

          <button
            type="submit"
            disabled={isLoading}
            className="w-full bg-blue-600 hover:bg-blue-700 disabled:bg-blue-300 text-white font-medium rounded-lg px-4 py-2.5 transition-colors"
          >
            ログイン
          </button>
        </form>

        <div className="my-5 flex items-center gap-3">
          <div className="h-px bg-gray-200 flex-1" />
          <span className="text-xs text-gray-400">または</span>
          <div className="h-px bg-gray-200 flex-1" />
        </div>

        <button
          type="button"
          onClick={handleGoogleLogin}
          disabled={isLoading}
          className="w-full border border-gray-300 hover:bg-gray-50 disabled:bg-gray-100 text-gray-700 font-medium rounded-lg px-4 py-2.5 transition-colors flex items-center justify-center gap-2"
        >
          <Chrome className="w-4 h-4" />
          Googleでログイン
        </button>
      </div>
    </div>
  );
};
