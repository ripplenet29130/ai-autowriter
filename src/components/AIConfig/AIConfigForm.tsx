import React, { useEffect, useState } from 'react';
import { Zap, Save, TestTube, Image, AlertCircle, CheckCircle, X } from 'lucide-react';
import { AIConfig } from '../../types';
import toast from 'react-hot-toast';

interface AIConfigFormProps {
  initialConfig?: AIConfig | null;
  provider: 'openai' | 'claude' | 'gemini';
  onSubmit: (config: AIConfig) => void;
  onCancel: () => void;
}

export const AIConfigForm: React.FC<AIConfigFormProps> = ({
  initialConfig,
  provider,
  onSubmit,
  onCancel,
}) => {
  const getDefaultImageProviderByAIProvider = (
    aiProvider: 'openai' | 'claude' | 'gemini'
  ): AIConfig['imageProvider'] => {
    if (aiProvider === 'openai') return 'dalle3';
    if (aiProvider === 'gemini') return 'nanobanana';
    return 'nanobanana';
  };

  const [config, setConfig] = useState<AIConfig>({
    provider,
    apiKey: '',
    model:
      provider === 'openai'
        ? 'gpt-5.2'
        : provider === 'claude'
          ? 'claude-4-5-sonnet-20250929'
          : 'gemini-2.5-flash',
    temperature: 0.7,
    maxTokens: 4000,
    imageGenerationEnabled: true,
    imageProvider: getDefaultImageProviderByAIProvider(provider),
    imagesPerArticle: 3,
  });

  const [testingConnection, setTestingConnection] = useState(false);
  const [testingImageGeneration, setTestingImageGeneration] = useState(false);
  const [connectionStatus, setConnectionStatus] = useState<'idle' | 'success' | 'error'>('idle');

  useEffect(() => {
    if (initialConfig) {
      setConfig({
        ...initialConfig,
        provider,
        imageProvider: getDefaultImageProviderByAIProvider(provider),
      });
    } else {
      setConfig((prev) => ({
        ...prev,
        provider,
        model:
          provider === 'openai'
            ? 'gpt-5.2'
            : provider === 'claude'
              ? 'claude-4-5-sonnet-20250929'
              : 'gemini-2.5-flash',
        imageProvider: getDefaultImageProviderByAIProvider(provider),
      }));
    }
  }, [initialConfig, provider]);

  const handleSave = () => {
    if (!config.apiKey.trim()) {
      toast.error('APIキーを入力してください');
      return;
    }

    onSubmit({
      ...config,
      provider,
      imageProvider: getDefaultImageProviderByAIProvider(provider),
    });
  };

  const handleTestConnection = async () => {
    if (!config.apiKey.trim()) {
      toast.error('APIキーを入力してください');
      return;
    }

    setTestingConnection(true);
    setConnectionStatus('idle');

    try {
      const testPrompt = 'こんにちは';

      if (config.provider === 'openai') {
        const response = await fetch('https://api.openai.com/v1/chat/completions', {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${config.apiKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            model: config.model,
            messages: [{ role: 'user', content: testPrompt }],
            max_tokens: 10,
          }),
        });

        if (response.ok) {
          setConnectionStatus('success');
          toast.success('OpenAI API接続テスト成功');
        } else {
          const error = await response.json().catch(() => ({}));
          setConnectionStatus('error');
          toast.error(`OpenAI API接続エラー: ${error?.error?.message || 'Unknown error'}`);
        }
      } else if (config.provider === 'claude') {
        const response = await fetch('https://api.anthropic.com/v1/messages', {
          method: 'POST',
          headers: {
            'x-api-key': config.apiKey,
            'anthropic-version': '2023-06-01',
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            model: config.model,
            max_tokens: 10,
            messages: [{ role: 'user', content: testPrompt }],
          }),
        });

        if (response.ok) {
          setConnectionStatus('success');
          toast.success('Claude API接続テスト成功');
        } else {
          const error = await response.json().catch(() => ({}));
          setConnectionStatus('error');
          toast.error(`Claude API接続エラー: ${error?.error?.message || 'Unknown error'}`);
        }
      } else {
        const modelName = 'gemini-2.0-flash-preview-image-generation';
        const response = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent?key=${config.apiKey}`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              contents: [{ parts: [{ text: testPrompt }] }],
              generationConfig: { maxOutputTokens: 10 },
            }),
          }
        );

        if (response.ok) {
          setConnectionStatus('success');
          toast.success('Gemini API接続テスト成功');
        } else {
          const error = await response.json().catch(() => ({}));
          setConnectionStatus('error');
          toast.error(`Gemini API接続エラー: ${error?.error?.message || 'Unknown error'}`);
        }
      }
    } catch (error: any) {
      setConnectionStatus('error');
      toast.error(`接続テストでエラーが発生しました: ${error.message}`);
    } finally {
      setTestingConnection(false);
    }
  };

  const handleTestImageGeneration = async () => {
    if (provider !== 'gemini') {
      toast.error('画像テストはGemini設定でのみ利用できます');
      return;
    }

    if (!config.apiKey.trim()) {
      toast.error('APIキーを入力してください');
      return;
    }

    setTestingImageGeneration(true);

    try {
      const modelName = 'gemini-2.0-flash-preview-image-generation';
      const testPrompt = 'テスト用のシンプルな図を1枚生成してください。';
      const response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent?key=${config.apiKey}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [{ parts: [{ text: testPrompt }] }],
            generationConfig: { temperature: 0.2, maxOutputTokens: 256 },
            responseModalities: ['TEXT', 'IMAGE'],
          }),
        }
      );

      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        const errorMessage = data?.error?.message || response.statusText || 'Unknown error';
        toast.error(`画像生成テストエラー: ${errorMessage}`);
        return;
      }

      const imagePart = data?.candidates?.[0]?.content?.parts?.find((part: any) => part.inlineData || part.inline_data);
      const inlineData = imagePart?.inlineData || imagePart?.inline_data;
      if (!inlineData?.data) {
        toast.error('画像データを取得できませんでした');
        return;
      }

      toast.success('画像生成テスト成功');
    } catch (error: any) {
      toast.error(`画像生成テストでエラーが発生しました: ${error.message}`);
    } finally {
      setTestingImageGeneration(false);
    }
  };

  const getModelOptions = () => {
    const tierLabel = (model: string): string => {
      if (['gemini-2.5-pro', 'claude-4-5-opus-20251124', 'gpt-5.2', 'gpt-5'].includes(model)) {
        return '高品質・高単価';
      }
      if (['gemini-2.5-flash', 'claude-4-5-sonnet-20250929', 'claude-3-5-sonnet-latest', 'gpt-4.1', 'gpt-4o'].includes(model)) {
        return 'バランス';
      }
      return '低価格・高速';
    };

    switch (config.provider) {
      case 'openai':
        return [
          { value: 'gpt-5.2', label: `GPT-5.2 (${tierLabel('gpt-5.2')})` },
          { value: 'gpt-5', label: `GPT-5 (${tierLabel('gpt-5')})` },
          { value: 'gpt-5-mini', label: `GPT-5 mini (${tierLabel('gpt-5-mini')})` },
          { value: 'gpt-4.1', label: `GPT-4.1 (${tierLabel('gpt-4.1')})` },
          { value: 'gpt-4.1-mini', label: `GPT-4.1 mini (${tierLabel('gpt-4.1-mini')})` },
          { value: 'gpt-4.1-nano', label: `GPT-4.1 nano (${tierLabel('gpt-4.1-nano')})` },
          { value: 'gpt-4o', label: `GPT-4o (${tierLabel('gpt-4o')})` },
          { value: 'gpt-4o-mini', label: `GPT-4o mini (${tierLabel('gpt-4o-mini')})` },
        ];
      case 'claude':
        return [
          { value: 'claude-4-5-sonnet-20250929', label: `Claude 4.5 Sonnet (${tierLabel('claude-4-5-sonnet-20250929')})` },
          { value: 'claude-4-5-opus-20251124', label: `Claude 4.5 Opus (${tierLabel('claude-4-5-opus-20251124')})` },
          { value: 'claude-4-5-haiku-20251015', label: `Claude 4.5 Haiku (${tierLabel('claude-4-5-haiku-20251015')})` },
          { value: 'claude-3-5-sonnet-latest', label: `Claude 3.5 Sonnet (${tierLabel('claude-3-5-sonnet-latest')})` },
        ];
      case 'gemini':
        return [
          { value: 'gemini-2.5-pro', label: `Google Gemini (gemini-2.5-pro) (${tierLabel('gemini-2.5-pro')})` },
          { value: 'gemini-2.5-flash', label: `Google Gemini (gemini-2.5-flash) (${tierLabel('gemini-2.5-flash')})` },
          { value: 'gemini-2.0-flash', label: `Google Gemini (gemini-2.0-flash) (${tierLabel('gemini-2.0-flash')})` },
        ];
      default:
        return [];
    }
  };

  const getConnectionStatusIcon = () => {
    switch (connectionStatus) {
      case 'success':
        return <CheckCircle className="w-4 h-4 text-green-600" />;
      case 'error':
        return <AlertCircle className="w-4 h-4 text-red-600" />;
      default:
        return null;
    }
  };

  const getProviderLabel = () => {
    switch (provider) {
      case 'openai':
        return 'OpenAI';
      case 'claude':
        return 'Anthropic Claude';
      case 'gemini':
        return 'Google Gemini';
      default:
        return provider;
    }
  };

  const getGeminiCostNote = (model: string): string => {
    if (model === 'gemini-2.5-pro') {
      return 'コスト目安（1M tokens）: 入力 $1.25 / 出力 $10.00（品質重視・高コスト）';
    }
    if (model === 'gemini-2.5-flash') {
      return 'コスト目安（1M tokens）: 入力 $0.30 / 出力 $2.50（バランス型）';
    }
    if (model === 'gemini-2.0-flash') {
      return 'コスト目安（1M tokens）: 入力 $0.10 / 出力 $0.40（最安・高速）';
    }
    return 'モデルごとにコスト差があります。特に出力単価を確認してください。';
  };

  return (
    <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center space-x-3">
          <Zap className="w-6 h-6 text-yellow-500" />
          <h3 className="text-lg font-semibold text-gray-900">{getProviderLabel()}設定</h3>
        </div>
        <button onClick={onCancel} className="p-2 text-gray-400 hover:text-gray-600 rounded-lg hover:bg-gray-100">
          <X className="w-5 h-5" />
        </button>
      </div>

      <div className="space-y-6">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">AIプロバイダー</label>
          <input type="text" value={getProviderLabel()} disabled className="input-field bg-gray-100 text-gray-500" />
        </div>

        <div>
          <div className="flex justify-between items-center mb-2">
            <label className="block text-sm font-medium text-gray-700">APIキー</label>
            <a
              href={
                config.provider === 'openai'
                  ? 'https://platform.openai.com/api-keys'
                  : config.provider === 'claude'
                    ? 'https://console.anthropic.com/settings/keys'
                    : 'https://aistudio.google.com/app/apikey'
              }
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs text-blue-600 hover:text-blue-800 hover:underline flex items-center"
            >
              APIキーを取得する →
            </a>
          </div>
          <div className="relative">
            <input
              type="password"
              value={config.apiKey}
              onChange={(e) => setConfig((prev) => ({ ...prev, apiKey: e.target.value }))}
              placeholder="APIキーを入力"
              className="input-field pr-10"
            />
            <div className="absolute inset-y-0 right-0 pr-3 flex items-center">{getConnectionStatusIcon()}</div>
          </div>
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">モデル</label>
          <select value={config.model} onChange={(e) => setConfig((prev) => ({ ...prev, model: e.target.value }))} className="input-field">
            {getModelOptions().map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
          {config.provider === 'gemini' && <p className="text-xs text-gray-600 mt-2">{getGeminiCostNote(config.model)}</p>}
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Temperature ({config.temperature})</label>
            <input
              type="range"
              min="0"
              max="1"
              step="0.1"
              value={config.temperature}
              onChange={(e) => setConfig((prev) => ({ ...prev, temperature: parseFloat(e.target.value) }))}
              className="w-full"
            />
            <div className="flex justify-between text-xs text-gray-500 mt-1">
              <span>低い</span>
              <span>高い</span>
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">最大トークン数</label>
            <input
              type="number"
              value={config.maxTokens}
              onChange={(e) => setConfig((prev) => ({ ...prev, maxTokens: parseInt(e.target.value || '0', 10) || 4000 }))}
              min="1000"
              max="8000"
              className="input-field"
            />
          </div>
        </div>
      </div>

      <div className="bg-gray-50 rounded-xl p-4 mt-6 border border-gray-200">
        <h3 className="text-sm font-semibold text-gray-900 mb-4 flex items-center space-x-2">
          <Image className="w-4 h-4" />
          <span>画像生成設定</span>
        </h3>

        <div className="space-y-4">
          <div>
            <label className="flex items-center">
              <input
                type="checkbox"
                checked={config.imageGenerationEnabled || false}
                onChange={(e) =>
                  setConfig((prev) => ({
                    ...prev,
                    imageGenerationEnabled: e.target.checked,
                    imageProvider: e.target.checked ? getDefaultImageProviderByAIProvider(provider) : prev.imageProvider,
                  }))
                }
                className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
              />
              <span className="ml-2 text-sm font-medium text-gray-700">画像自動生成を有効にする</span>
            </label>
            <p className="text-xs text-gray-500 mt-2">
              {provider === 'openai'
                ? 'OpenAI選択時は DALL-E 3 を使用します'
                : provider === 'gemini'
                  ? 'Gemini選択時は nanobanana を使用します'
                  : '現在のAI設定に応じて画像プロバイダーを選択します'}
            </p>
          </div>

          {config.imageGenerationEnabled && (
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">記事あたりの画像枚数 ({config.imagesPerArticle || 0}枚)</label>
              <input
                type="range"
                min="0"
                max="10"
                step="1"
                value={config.imagesPerArticle || 0}
                onChange={(e) => setConfig((prev) => ({ ...prev, imagesPerArticle: parseInt(e.target.value || '0', 10) }))}
                className="w-full"
              />
              <div className="flex justify-between text-xs text-gray-500 mt-1">
                <span>0 (無効)</span>
                <span>5枚</span>
                <span>10枚</span>
              </div>
            </div>
          )}
        </div>
      </div>

      <div className="flex justify-end space-x-3 mt-6 pt-4 border-t border-gray-200">
        {provider === 'gemini' && config.imageGenerationEnabled && (
          <button
            onClick={handleTestImageGeneration}
            disabled={testingImageGeneration || !config.apiKey.trim()}
            className="btn-secondary flex items-center space-x-2 disabled:opacity-50"
          >
            {testingImageGeneration ? (
              <>
                <div className="w-4 h-4 border-2 border-gray-600 border-t-transparent rounded-full animate-spin"></div>
                <span>画像テスト中...</span>
              </>
            ) : (
              <>
                <Image className="w-4 h-4" />
                <span>画像テスト（1枚）</span>
              </>
            )}
          </button>
        )}

        <button
          onClick={handleTestConnection}
          disabled={testingConnection || !config.apiKey.trim()}
          className="btn-secondary flex items-center space-x-2 disabled:opacity-50"
        >
          {testingConnection ? (
            <>
              <div className="w-4 h-4 border-2 border-gray-600 border-t-transparent rounded-full animate-spin"></div>
              <span>テスト中...</span>
            </>
          ) : (
            <>
              <TestTube className="w-4 h-4" />
              <span>接続テスト</span>
            </>
          )}
        </button>

        <button onClick={handleSave} className="btn-primary flex items-center space-x-2">
          <Save className="w-4 h-4" />
          <span>{initialConfig ? '更新して保存' : '保存'}</span>
        </button>
      </div>
    </div>
  );
};
