import { useState, useEffect } from 'react';
import { supabase, WPConfig } from '../lib/supabase';
import { Trash2, ExternalLink, Star } from 'lucide-react';
import Toast from '../components/Toast';

export default function WPSettings() {
  const [configs, setConfigs] = useState<WPConfig[]>([]);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const [formData, setFormData] = useState({
    name: '',
    url: '',
    username: '',
    app_password: '',
    default_category: '',
    post_type: 'post',
    is_active: false,
  });

  useEffect(() => {
    loadConfigs();
  }, []);

  const loadConfigs = async () => {
    const { data, error } = await supabase
      .from('wp_configs')
      .select('*')
      .order('created_at', { ascending: false });

    if (error) {
      showMessage('error', 'データの読み込みに失敗しました');
    } else {
      setConfigs(data || []);
    }
  };

  const showMessage = (type: 'success' | 'error', text: string) => {
    setMessage({ type, text });
    setTimeout(() => setMessage(null), 3000);
  };

  const handleSave = async () => {
    if (!formData.name || !formData.url || !formData.username || !formData.app_password) {
      showMessage('error', 'すべての必須項目を入力してください');
      return;
    }

    setLoading(true);
    const { error } = await supabase
      .from('wp_configs')
      .insert([formData]);

    if (error) {
      showMessage('error', '設定の保存に失敗しました');
    } else {
      showMessage('success', 'WordPress設定を保存しました');
      loadConfigs();
      setFormData({
        name: '',
        url: '',
        username: '',
        app_password: '',
        default_category: '',
        post_type: 'post',
        is_active: false,
      });
    }
    setLoading(false);
  };

  const handleDelete = async (id: string) => {
    if (!confirm('この設定を削除してもよろしいですか？')) return;

    const { error } = await supabase
      .from('wp_configs')
      .delete()
      .eq('id', id);

    if (error) {
      showMessage('error', '削除に失敗しました');
    } else {
      showMessage('success', '設定を削除しました');
      loadConfigs();
    }
  };

  const handleTest = () => {
    showMessage('success', '接続テスト機能は準備中です');
  };

  const toggleActive = async (id: string, currentStatus: boolean) => {
    const { error } = await supabase
      .from('wp_configs')
      .update({ is_active: !currentStatus })
      .eq('id', id);

    if (error) {
      showMessage('error', '更新に失敗しました');
    } else {
      loadConfigs();
    }
  };

  return (
    <div>
      {message && (
        <Toast
          type={message.type}
          message={message.text}
          onClose={() => setMessage(null)}
        />
      )}

      <div className="mb-8">
        <h1 className="text-3xl font-bold text-gray-800 mb-2">WordPress設定</h1>
        <p className="text-gray-600">記事を投稿するWordPressサイトの設定を管理します</p>
      </div>

      <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-8 mb-8">
        <h2 className="text-xl font-semibold text-gray-800 mb-6">新しいWordPress設定</h2>

        <div className="space-y-6">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              設定名 <span className="text-red-500">*</span>
            </label>
            <input
              type="text"
              value={formData.name}
              onChange={(e) => setFormData({ ...formData, name: e.target.value })}
              placeholder="例: メインサイト"
              className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              WordPress URL <span className="text-red-500">*</span>
            </label>
            <input
              type="url"
              value={formData.url}
              onChange={(e) => setFormData({ ...formData, url: e.target.value })}
              placeholder="https://example.com"
              className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              ユーザー名 <span className="text-red-500">*</span>
            </label>
            <input
              type="text"
              value={formData.username}
              onChange={(e) => setFormData({ ...formData, username: e.target.value })}
              placeholder="admin"
              className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              アプリケーションパスワード <span className="text-red-500">*</span>
            </label>
            <input
              type="password"
              value={formData.app_password}
              onChange={(e) => setFormData({ ...formData, app_password: e.target.value })}
              placeholder="xxxx xxxx xxxx xxxx xxxx xxxx"
              className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              デフォルトカテゴリ（スラッグ）
            </label>
            <input
              type="text"
              value={formData.default_category}
              onChange={(e) => setFormData({ ...formData, default_category: e.target.value })}
              placeholder="uncategorized"
              className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            />
            <p className="mt-1 text-xs text-gray-500">
              カテゴリスラッグを指定（例: news, blog）。投稿タイプとどちらか一方でOK
            </p>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              投稿タイプ
            </label>
            <input
              type="text"
              value={formData.post_type}
              onChange={(e) => setFormData({ ...formData, post_type: e.target.value })}
              placeholder="post"
              className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            />
            <p className="mt-1 text-xs text-gray-500">
              投稿タイプを指定（デフォルト: post）。カスタム投稿タイプも可（例: product, event）
            </p>
          </div>

          <div className="flex items-center gap-3">
            <input
              type="checkbox"
              id="is_active"
              checked={formData.is_active}
              onChange={(e) => setFormData({ ...formData, is_active: e.target.checked })}
              className="w-5 h-5 text-blue-600 rounded focus:ring-2 focus:ring-blue-500"
            />
            <label htmlFor="is_active" className="text-sm font-medium text-gray-700">
              メイン設定として使用
            </label>
          </div>

          <div className="flex gap-4 pt-4">
            <button
              onClick={handleSave}
              disabled={loading}
              className="px-6 py-3 bg-blue-600 text-white rounded-lg font-medium hover:bg-blue-700 transition-colors disabled:opacity-50"
            >
              設定を追加
            </button>
          </div>
        </div>
      </div>

      {configs.length > 0 && (
        <div>
          <h2 className="text-xl font-semibold text-gray-800 mb-4">登録済みの設定</h2>
          <div className="grid gap-4">
            {configs.map((config) => (
              <div key={config.id} className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
                <div className="flex items-start justify-between">
                  <div className="flex-1">
                    <div className="flex items-center gap-3 mb-2">
                      <h3 className="text-lg font-semibold text-gray-800">{config.name}</h3>
                      {config.is_active && (
                        <span className="flex items-center gap-1 px-3 py-1 bg-yellow-100 text-yellow-700 text-sm rounded-full">
                          <Star className="w-4 h-4 fill-current" />
                          メイン
                        </span>
                      )}
                    </div>
                    <div className="text-sm text-gray-600 space-y-1">
                      <p className="flex items-center gap-2">
                        <ExternalLink className="w-4 h-4" />
                        {config.url}
                      </p>
                      <p>ユーザー名: {config.username}</p>
                      {config.default_category && (
                        <p>デフォルトカテゴリ: {config.default_category}</p>
                      )}
                      {config.post_type && config.post_type !== 'post' && (
                        <p>投稿タイプ: {config.post_type}</p>
                      )}
                      <p className="text-xs text-gray-400 mt-2">
                        作成日時: {new Date(config.created_at).toLocaleString('ja-JP')}
                      </p>
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <button
                      onClick={handleTest}
                      className="px-4 py-2 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 transition-colors text-sm"
                    >
                      接続テスト
                    </button>
                    <button
                      onClick={() => toggleActive(config.id, config.is_active)}
                      className="px-4 py-2 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 transition-colors text-sm"
                    >
                      {config.is_active ? 'メイン解除' : 'メインに設定'}
                    </button>
                    <button
                      onClick={() => handleDelete(config.id)}
                      className="px-4 py-2 text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                    >
                      <Trash2 className="w-5 h-5" />
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="mt-8 bg-blue-50 rounded-lg p-6">
        <h3 className="text-lg font-semibold text-gray-800 mb-3">アプリケーションパスワードの取得方法</h3>
        <div className="text-sm text-gray-700 space-y-2">
          <p>1. WordPressの管理画面にログインします</p>
          <p>2. 「ユーザー」→「プロフィール」に移動します</p>
          <p>3. 「アプリケーションパスワード」セクションまでスクロールします</p>
          <p>4. 新しいアプリケーション名（例：AI WordPress System）を入力します</p>
          <p>5. 「新しいアプリケーションパスワードを追加」をクリックします</p>
          <p>6. 生成されたパスワードをコピーして、上記のフォームに貼り付けます</p>
        </div>
      </div>
    </div>
  );
}
