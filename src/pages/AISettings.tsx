import { useState, useEffect } from 'react';
import { supabase, AIConfig } from '../lib/supabase';
import { Eye, EyeOff, Save, Trash2, Edit2, X, Check } from 'lucide-react';
import Toast from '../components/Toast';

export default function AISettings() {
  const [configs, setConfigs] = useState<AIConfig[]>([]);
  const [showApiKey, setShowApiKey] = useState(false);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [language, setLanguage] = useState(config.language || "ja");

  const [formData, setFormData] = useState({
    name: '',
    provider: 'Gemini',
    api_key: '',
    model: 'gemini-2.5-flash',
    temperature: 0.7,
    max_tokens: 4000,
    enable_image: false,
    tone: 'ビジネス',
    article_length: '中（1000〜1500字）',
    style: 'SEO重視',
  });

  useEffect(() => {
    loadConfigs();
  }, []);

  const loadConfigs = async () => {
    const { data, error } = await supabase
      .from('ai_configs')
      .select('*')
      .order('created_at', { ascending: false });

    if (error) {
      showMessage('error', 'データの読み込みに失敗しました');
    } else {
      setConfigs(data || []);
      if (data && data.length > 0) {
        const latest = data[0];
        setFormData({
          ...formData,
          provider: latest.provider,
          api_key: latest.api_key,
          model: latest.model,
          temperature: latest.temperature,
          max_tokens: latest.max_tokens,
          enable_image: latest.enable_image,
          tone: latest.tone || 'ビジネス',
          article_length: latest.article_length || '中（1000〜1500字）',
          style: latest.style || 'SEO重視',
        });
      }
    }
  };

  const showMessage = (type: 'success' | 'error', text: string) => {
    setMessage({ type, text });
    setTimeout(() => setMessage(null), 3000);
  };

  const handleSave = async () => {
    if (!formData.api_key) {
      setMessage({ type: 'error', text: 'APIキーを入力してください。' });
      setLoading(false);
      return;
    }

    if (!formData.name.trim()) {
      setFormData({ ...formData, name: `${formData.provider} - ${formData.model}` });
    }

    setLoading(true);

    const saveData = {
      name: formData.name || `${formData.provider} - ${formData.model}`,
      provider: formData.provider,
      api_key: formData.api_key,
      model: formData.model,
      temperature: formData.temperature,
      max_tokens: formData.max_tokens,
      enable_image: formData.enable_image,
      tone: formData.tone,
      article_length: formData.article_length,
      style: formData.style,
    };

    let error;
    if (editingId) {
      const result = await supabase
        .from('ai_configs')
        .update(saveData)
        .eq('id', editingId);
      error = result.error;
    } else {
      const result = await supabase.from('ai_configs').insert([saveData]);
      error = result.error;
    }

    if (error) {
      showMessage('error', '設定の保存に失敗しました');
    } else {
      showMessage('success', editingId ? '設定を更新しました' : '設定を保存しました');
      loadConfigs();
      setFormData({
        name: '',
        provider: 'Gemini',
        api_key: '',
        model: 'gemini-2.5-flash',
        temperature: 0.7,
        max_tokens: 4000,
        enable_image: false,
        tone: 'ビジネス',
        article_length: '中（1000〜1500字）',
        style: 'SEO重視',
      });
      setEditingId(null);
    }
    setLoading(false);
  };

  const handleTest = () => {
    showMessage('success', '接続テスト機能は準備中です');
  };

  const handleEdit = (config: AIConfig) => {
    setEditingId(config.id);
  };

  const handleCancelEdit = () => {
    setEditingId(null);
  };

  const handleUpdateConfig = async (id: string, updates: Partial<AIConfig>) => {
    const { error } = await supabase
      .from('ai_configs')
      .update(updates)
      .eq('id', id);

    if (error) {
      showMessage('error', '更新に失敗しました');
    } else {
      showMessage('success', '設定を更新しました');
      loadConfigs();
      setEditingId(null);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('この設定を削除してもよろしいですか？')) return;

    const { error } = await supabase
      .from('ai_configs')
      .delete()
      .eq('id', id);

    if (error) {
      showMessage('error', '削除に失敗しました');
    } else {
      showMessage('success', '設定を削除しました');
      loadConfigs();
      if (editingId === id) {
        handleCancelEdit();
      }
    }
  };

  const modelOptions = {
    Gemini: ['gemini-2.5-flash', 'gemini-2.5-pro', 'gemini-2.5-flash-lite', 'gemini-1.5-pro'],
    OpenAI: ['gpt-4o', 'gpt-4-turbo', 'gpt-3.5-turbo'],
    Claude: ['claude-3.5-sonnet', 'claude-3-opus', 'claude-3-haiku'],
  };

  interface ConfigCardProps {
    config: AIConfig;
    isEditing: boolean;
    onEdit: () => void;
    onCancelEdit: () => void;
    onUpdate: (id: string, updates: Partial<AIConfig>) => void;
    onDelete: () => void;
    modelOptions: typeof modelOptions;
  }

  function ConfigCard({
    config,
    isEditing,
    onEdit,
    onCancelEdit,
    onUpdate,
    onDelete,
    modelOptions,
  }: ConfigCardProps) {
    const [editData, setEditData] = useState({
      name: config.name || '',
      model: config.model,
      temperature: config.temperature,
      max_tokens: config.max_tokens,
      enable_image: config.enable_image,
      tone: config.tone || 'ビジネス',
      article_length: config.article_length || '中（1000〜1500字）',
      style: config.style || 'SEO重視',
    });

    const handleSave = () => {
      onUpdate(config.id, editData);
    };

    if (isEditing) {
      return (
        <div className="bg-white rounded-lg shadow-sm border-2 border-blue-500 p-6">
          <div className="space-y-4">
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">
                設定名
              </label>
              <input
                type="text"
                value={editData.name}
                onChange={(e) => setEditData({ ...editData, name: e.target.value })}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent text-sm"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">
                モデル
              </label>
              <select
                value={editData.model}
                onChange={(e) => setEditData({ ...editData, model: e.target.value })}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent text-sm"
              >
                {modelOptions[config.provider as keyof typeof modelOptions]?.map((model) => (
                  <option key={model} value={model}>
                    {model}
                  </option>
                ))}
              </select>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">
                  Temperature
                </label>
                <input
                  type="number"
                  step="0.1"
                  min="0"
                  max="2"
                  value={editData.temperature}
                  onChange={(e) => setEditData({ ...editData, temperature: parseFloat(e.target.value) })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent text-sm"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">
                  Max Tokens
                </label>
                <input
                  type="number"
                  step="100"
                  value={editData.max_tokens}
                  onChange={(e) => setEditData({ ...editData, max_tokens: parseInt(e.target.value) })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent text-sm"
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">
                トーン
              </label>
              <select
                value={editData.tone}
                onChange={(e) => setEditData({ ...editData, tone: e.target.value })}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent text-sm"
              >
                <option value="ビジネス">ビジネス</option>
                <option value="カジュアル">カジュアル</option>
                <option value="フレンドリー">フレンドリー</option>
                <option value="感情的">感情的</option>
                <option value="フォーマル">フォーマル</option>
              </select>
            </div>

            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">
                ボリューム
              </label>
              <select
                value={editData.article_length}
                onChange={(e) => setEditData({ ...editData, article_length: e.target.value })}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent text-sm"
              >
                <option value="短文（500〜800字）">短文（500〜800字）</option>
                <option value="中（1000〜1500字）">中（1000〜1500字）</option>
                <option value="長文（2000字〜）">長文（2000字〜）</option>
              </select>
            </div>

            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">
                スタイル
              </label>
              <select
                value={editData.style}
                onChange={(e) => setEditData({ ...editData, style: e.target.value })}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent text-sm"
              >
                <option value="SEO重視">SEO重視</option>
                <option value="体験談風">体験談風</option>
                <option value="Q&A形式">Q&A形式</option>
                <option value="リスト形式">リスト形式</option>
              </select>
            </div>

            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">出力言語</label>
              <select
                value={language}
                onChange={(e) => setLanguage(e.target.value)}
                className="w-full border rounded px-3 py-2"
              >
                <option value="ja">日本語</option>
                <option value="en">English</option>
                <option value="zh">中文（Chinese）</option>
                <option value="ko">한국어（Korean）</option>
              </select>
            </div>


            <div className="flex items-center">
              <input
                type="checkbox"
                id={`enable-image-${config.id}`}
                checked={editData.enable_image}
                onChange={(e) => setEditData({ ...editData, enable_image: e.target.checked })}
                className="w-4 h-4 text-blue-600 border-gray-300 rounded focus:ring-blue-500"
              />
              <label htmlFor={`enable-image-${config.id}`} className="ml-2 text-sm text-gray-700">
                画像生成を有効化
              </label>
            </div>

            <div className="flex gap-2 pt-2">
              <button
                onClick={handleSave}
                className="flex-1 flex items-center justify-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg font-medium hover:bg-blue-700 transition-colors"
              >
                <Check className="w-4 h-4" />
                保存
              </button>
              <button
                onClick={onCancelEdit}
                className="flex-1 flex items-center justify-center gap-2 px-4 py-2 border border-gray-300 text-gray-700 rounded-lg font-medium hover:bg-gray-50 transition-colors"
              >
                <X className="w-4 h-4" />
                キャンセル
              </button>
            </div>
          </div>
        </div>
      );
    }

    return (
      <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
        <div className="flex items-start justify-between">
          <div className="flex-1">
            <div className="flex items-center gap-3 mb-2">
              <h3 className="text-lg font-semibold text-gray-800">
                {config.name || config.provider}
              </h3>
              <span className="px-3 py-1 bg-blue-100 text-blue-700 text-sm rounded-full">
                {config.model}
              </span>
            </div>
            <div className="text-sm text-gray-600 space-y-1">
              <p>
                トーン: {config.tone} | スタイル: {config.style} | ボリューム: {config.article_length}
              </p>
              <p>
                Temperature: {config.temperature} | Max Tokens:{' '}
                {config.max_tokens}
              </p>
              <p>画像生成: {config.enable_image ? '有効' : '無効'}</p>
              <p className="text-xs text-gray-400 mt-2">
                作成日時:{' '}
                {new Date(config.created_at).toLocaleString('ja-JP')}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={onEdit}
              className="p-2 text-blue-600 hover:bg-blue-50 rounded-lg transition-colors"
              title="編集"
            >
              <Edit2 className="w-5 h-5" />
            </button>
            <button
              onClick={onDelete}
              className="p-2 text-red-600 hover:bg-red-50 rounded-lg transition-colors"
              title="削除"
            >
              <Trash2 className="w-5 h-5" />
            </button>
          </div>
        </div>
      </div>
    );
  }

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
        <h1 className="text-3xl font-bold text-gray-800 mb-2">AI設定</h1>
        <p className="text-gray-600">
          記事生成に使用するAIプロバイダーの設定を管理します
        </p>
      </div>

      <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-8">
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-xl font-semibold text-gray-800">
            {editingId ? 'AI設定を編集' : '新しいAI設定'}
          </h2>
          {editingId && (
            <button
              onClick={handleCancelEdit}
              className="px-4 py-2 text-gray-600 hover:text-gray-800 transition-colors"
            >
              キャンセル
            </button>
          )}
        </div>

        <div className="space-y-6">
          {/* 設定名 */}
          <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">
          設定名
          </label>
          <input
          type="text"
          value={formData.name}
          onChange={(e) => setFormData({ ...formData, name: e.target.value })}
          placeholder="例：記事生成用 / トレンド分析用"
          className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
  />
          </div>



          {/* AIプロバイダー */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              AIプロバイダー
            </label>
            <select
              value={formData.provider}
              onChange={(e) =>
                setFormData({
                  ...formData,
                  provider: e.target.value,
                  model:
                    modelOptions[e.target.value as keyof typeof modelOptions][0],
                })
              }
              className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            >
              <option value="Gemini">Google Gemini</option>
              <option value="OpenAI">OpenAI</option>
              <option value="Claude">Claude</option>
            </select>
          </div>

          {/* APIキー */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              APIキー
            </label>
            <div className="relative">
              <input
                type={showApiKey ? 'text' : 'password'}
                value={formData.api_key}
                onChange={(e) =>
                  setFormData({ ...formData, api_key: e.target.value })
                }
                placeholder=""
                className="w-full px-4 py-3 pr-12 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              />
              <button
                onClick={() => setShowApiKey(!showApiKey)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-700"
              >
                {showApiKey ? (
                  <EyeOff className="w-5 h-5" />
                ) : (
                  <Eye className="w-5 h-5" />
                )}
              </button>
            </div>
          </div>

          {/* モデル */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              モデル
            </label>
            <select
              value={formData.model}
              onChange={(e) =>
                setFormData({ ...formData, model: e.target.value })
              }
              className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            >
              {modelOptions[
                formData.provider as keyof typeof modelOptions
              ].map((model) => (
                <option key={model} value={model}>
                  {model}
                </option>
              ))}
            </select>
            {formData.provider === 'Gemini' && (
              <p className="mt-2 text-sm text-gray-600">
                ※ Gemini 2.5 シリーズは最新モデルです。"Flash"は速度重視、"Pro"は精度重視です。
              </p>
            )}
          </div>

          {/* Temperature */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Temperature: {formData.temperature}
            </label>
            <input
              type="range"
              min="0"
              max="1"
              step="0.1"
              value={formData.temperature}
              onChange={(e) =>
                setFormData({
                  ...formData,
                  temperature: parseFloat(e.target.value),
                })
              }
              className="w-full"
            />
            <div className="flex justify-between text-xs text-gray-500 mt-1">
              <span>より正確</span>
              <span>より創造的</span>
            </div>
          </div>

          {/* Max Tokens */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Max Tokens
            </label>
            <input
              type="number"
              value={formData.max_tokens}
              onChange={(e) =>
                setFormData({
                  ...formData,
                  max_tokens: parseInt(e.target.value),
                })
              }
              className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            />
          </div>

          {/* 画像生成 */}
          <div className="flex items-center gap-3">
            <input
              type="checkbox"
              id="enable_image"
              checked={formData.enable_image}
              onChange={(e) =>
                setFormData({ ...formData, enable_image: e.target.checked })
              }
              className="w-5 h-5 text-blue-600 rounded focus:ring-2 focus:ring-blue-500"
            />
            <label
              htmlFor="enable_image"
              className="text-sm font-medium text-gray-700"
            >
              画像生成を有効化
            </label>
          </div>

          {/* 文章トーン */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              文章トーン
            </label>
            <select
              value={formData.tone}
              onChange={(e) =>
                setFormData({ ...formData, tone: e.target.value })
              }
              className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            >
              <option value="ビジネス">ビジネス</option>
              <option value="カジュアル">カジュアル</option>
              <option value="フレンドリー">フレンドリー</option>
              <option value="感情的">感情的</option>
              <option value="フォーマル">フォーマル</option>
            </select>
          </div>

          {/* 記事ボリューム */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              記事ボリューム
            </label>
            <select
              value={formData.article_length}
              onChange={(e) =>
                setFormData({ ...formData, article_length: e.target.value })
              }
              className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            >
              <option value="短文（500〜800字）">短文（500〜800字）</option>
              <option value="中（1000〜1500字）">中（1000〜1500字）</option>
              <option value="長文（2000字〜）">長文（2000字〜）</option>
            </select>
          </div>

          {/* 出力スタイル */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              出力スタイル
            </label>
            <select
              value={formData.style}
              onChange={(e) =>
                setFormData({ ...formData, style: e.target.value })
              }
              className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            >
              <option value="SEO重視">SEO重視</option>
              <option value="体験談風">体験談風</option>
              <option value="Q&A形式">Q&A形式</option>
              <option value="リスト形式">リスト形式</option>
            </select>
          </div>

          {/* ボタン */}
          <div className="flex gap-4 pt-4">
            <button
              onClick={handleTest}
              className="px-6 py-3 border border-gray-300 rounded-lg text-gray-700 font-medium hover:bg-gray-50 transition-colors"
            >
              接続テスト
            </button>
            <button
              onClick={handleSave}
              disabled={loading}
              className="flex items-center gap-2 px-6 py-3 bg-blue-600 text-white rounded-lg font-medium hover:bg-blue-700 transition-colors disabled:opacity-50"
            >
              <Save className="w-5 h-5" />
              {editingId ? '設定を更新' : '設定を保存'}
            </button>
          </div>
        </div>
      </div>

      {/* 保存済み設定一覧 */}
      {configs.length > 0 && (
        <div className="mt-8">
          <h2 className="text-xl font-semibold text-gray-800 mb-4">
            保存済みの設定
          </h2>
          <div className="space-y-4">
            {configs.map((config) => (
              <ConfigCard
                key={config.id}
                config={config}
                isEditing={editingId === config.id}
                onEdit={() => handleEdit(config)}
                onCancelEdit={handleCancelEdit}
                onUpdate={handleUpdateConfig}
                onDelete={() => handleDelete(config.id)}
                modelOptions={modelOptions}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
