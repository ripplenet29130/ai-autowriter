import { useState, useEffect } from 'react';
import { supabase, AIConfig } from '../lib/supabase';
import { Eye, EyeOff, Save, CheckCircle, AlertCircle } from 'lucide-react';

export default function AISettings() {
  const [configs, setConfigs] = useState<AIConfig[]>([]);
  const [showApiKey, setShowApiKey] = useState(false);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const [formData, setFormData] = useState({
    provider: 'Gemini',
    api_key: '',
    model: 'gemini-2.5-flash',
    temperature: 0.7,
    max_tokens: 4000,
    enable_image: false,
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
          provider: latest.provider,
          api_key: latest.api_key,
          model: latest.model,
          temperature: latest.temperature,
          max_tokens: latest.max_tokens,
          enable_image: latest.enable_image,
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
      showMessage('error', 'APIキーを入力してください');
      return;
    }

    setLoading(true);
    const { error } = await supabase
      .from('ai_configs')
      .insert([formData]);

    if (error) {
      showMessage('error', '設定の保存に失敗しました');
    } else {
      showMessage('success', '設定を保存しました');
      loadConfigs();
      setFormData({
        ...formData,
        api_key: '',
      });
    }
    setLoading(false);
  };

  const handleTest = () => {
    showMessage('success', '接続テスト機能は準備中です');
  };

  const modelOptions = {
    Gemini: ['gemini-2.5-flash', 'gemini-2.5-pro', 'gemini-2.5-flash-lite', 'gemini-1.5-pro'],
    OpenAI: ['gpt-4o', 'gpt-4-turbo', 'gpt-3.5-turbo'],
    Claude: ['claude-3.5-sonnet', 'claude-3-opus', 'claude-3-haiku'],
  };

  return (
    <div>
      {message && (
        <div className={`mb-6 p-4 rounded-lg flex items-center gap-3 ${
          message.type === 'success' ? 'bg-green-50 text-green-800' : 'bg-red-50 text-red-800'
        }`}>
          {message.type === 'success' ? <CheckCircle className="w-5 h-5" /> : <AlertCircle className="w-5 h-5" />}
          <span>{message.text}</span>
        </div>
      )}

      <div className="mb-8">
        <h1 className="text-3xl font-bold text-gray-800 mb-2">AI設定</h1>
        <p className="text-gray-600">記事生成に使用するAIプロバイダーの設定を管理します</p>
      </div>

      <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-8">
        <h2 className="text-xl font-semibold text-gray-800 mb-6">新しいAI設定</h2>

        <div className="space-y-6">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              AIプロバイダー
            </label>
            <select
              value={formData.provider}
              onChange={(e) => setFormData({
                ...formData,
                provider: e.target.value,
                model: modelOptions[e.target.value as keyof typeof modelOptions][0]
              })}
              className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            >
              <option value="Gemini">Google Gemini</option>
              <option value="OpenAI">OpenAI</option>
              <option value="Claude">Claude</option>
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              APIキー
            </label>
            <div className="relative">
              <input
                type={showApiKey ? 'text' : 'password'}
                value={formData.api_key}
                onChange={(e) => setFormData({ ...formData, api_key: e.target.value })}
                placeholder="sk-..."
                className="w-full px-4 py-3 pr-12 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              />
              <button
                onClick={() => setShowApiKey(!showApiKey)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-700"
              >
                {showApiKey ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
              </button>
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              モデル
            </label>
            <select
              value={formData.model}
              onChange={(e) => setFormData({ ...formData, model: e.target.value })}
              className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            >
              {modelOptions[formData.provider as keyof typeof modelOptions].map((model) => (
                <option key={model} value={model}>{model}</option>
              ))}
            </select>
            {formData.provider === 'Gemini' && (
              <p className="mt-2 text-sm text-gray-600">
                ※ Gemini 2.5 シリーズは最新モデルです。"Flash"は速度重視、"Pro"は精度重視です。
              </p>
            )}
          </div>

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
              onChange={(e) => setFormData({ ...formData, temperature: parseFloat(e.target.value) })}
              className="w-full"
            />
            <div className="flex justify-between text-xs text-gray-500 mt-1">
              <span>より正確</span>
              <span>より創造的</span>
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Max Tokens
            </label>
            <input
              type="number"
              value={formData.max_tokens}
              onChange={(e) => setFormData({ ...formData, max_tokens: parseInt(e.target.value) })}
              className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            />
          </div>

          <div className="flex items-center gap-3">
            <input
              type="checkbox"
              id="enable_image"
              checked={formData.enable_image}
              onChange={(e) => setFormData({ ...formData, enable_image: e.target.checked })}
              className="w-5 h-5 text-blue-600 rounded focus:ring-2 focus:ring-blue-500"
            />
            <label htmlFor="enable_image" className="text-sm font-medium text-gray-700">
              画像生成を有効化
            </label>
          </div>

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
              設定を保存
            </button>
          </div>
        </div>
      </div>

      {configs.length > 0 && (
        <div className="mt-8">
          <h2 className="text-xl font-semibold text-gray-800 mb-4">保存済みの設定</h2>
          <div className="space-y-4">
            {configs.map((config) => (
              <div key={config.id} className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
                <div className="flex items-start justify-between">
                  <div className="flex-1">
                    <div className="flex items-center gap-3 mb-2">
                      <h3 className="text-lg font-semibold text-gray-800">{config.provider}</h3>
                      <span className="px-3 py-1 bg-blue-100 text-blue-700 text-sm rounded-full">
                        {config.model}
                      </span>
                    </div>
                    <div className="text-sm text-gray-600 space-y-1">
                      <p>Temperature: {config.temperature} | Max Tokens: {config.max_tokens}</p>
                      <p>画像生成: {config.enable_image ? '有効' : '無効'}</p>
                      <p className="text-xs text-gray-400 mt-2">
                        作成日時: {new Date(config.created_at).toLocaleString('ja-JP')}
                      </p>
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
