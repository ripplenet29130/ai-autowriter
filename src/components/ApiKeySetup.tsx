import React, { useState, useEffect } from 'react';
import { Key, CheckCircle, AlertCircle, ExternalLink, Save } from 'lucide-react';
import { apiKeyManager } from '../services/apiKeyManager';
import toast from 'react-hot-toast';

export const ApiKeySetup: React.FC = () => {
  const [apiKeys, setApiKeys] = useState({
    google_custom_search: '',
    google_custom_search_engine_id: '',
    serpapi: ''
  });

  const [validation, setValidation] = useState({
    isValid: false,
    missingServices: [] as string[],
    availableServices: [] as string[]
  });

  useEffect(() => {
    // 既存のAPIキーを読み込み
    Object.keys(apiKeys).forEach(service => {
      const existingKey = apiKeyManager.getApiKey(service);
      if (existingKey) {
        setApiKeys(prev => ({ ...prev, [service]: existingKey }));
      }
    });

    updateValidation();
  }, []);

  const updateValidation = () => {
    const result = apiKeyManager.validateConfiguration();
    setValidation(result);
  };

  const handleSaveApiKey = (service: string, key: string) => {
    if (key.trim()) {
      apiKeyManager.setApiKey(service, key.trim());
      toast.success(`${service} APIキーを保存しました`);
      updateValidation();
    }
  };

  const handleSaveAll = () => {
    let savedCount = 0;
    Object.entries(apiKeys).forEach(([service, key]) => {
      if (key.trim()) {
        apiKeyManager.setApiKey(service, key.trim());
        savedCount++;
      }
    });

    if (savedCount > 0) {
      toast.success(`${savedCount}個のAPIキーを保存しました`);
      updateValidation();
    } else {
      toast.error('保存するAPIキーがありません');
    }
  };

  const apiServices = [
    {
      id: 'google_custom_search',
      name: 'Google Custom Search API',
      description: '競合分析とキーワード調査に使用',
      required: true,
      setupUrl: 'https://developers.google.com/custom-search/v1/introduction',
      placeholder: 'AIzaSyC...',
      type: 'text' as const
    },
    {
      id: 'google_custom_search_engine_id',
      name: 'Custom Search Engine ID',
      description: 'Google Custom Search Engineの識別子（新形式）',
      required: true,
      setupUrl: 'https://cse.google.com/cse/',
      placeholder: '73c70ae8e1c314d0f',
      type: 'text' as const
    },
    {
      id: 'serpapi',
      name: 'SerpAPI',
      description: 'Google Trendsデータの取得に使用',
      required: false,
      setupUrl: 'https://serpapi.com/',
      placeholder: 'your_serpapi_key',
      type: 'text' as const
    }
  ];

  return (
    <div className="space-y-6">
      <div className="flex items-center space-x-3">
        <Key className="w-8 h-8 text-blue-600" />
        <div>
          <h2 className="text-2xl font-bold text-gray-900">API設定</h2>
          <p className="text-gray-600">トレンド分析機能を使用するためのAPI設定</p>
        </div>
      </div>

      {/* Status Overview */}
      <div className={`p-4 rounded-lg border-2 ${
        validation.isValid 
          ? 'border-green-200 bg-green-50' 
          : 'border-yellow-200 bg-yellow-50'
      }`}>
        <div className="flex items-center space-x-2 mb-2">
          {validation.isValid ? (
            <CheckCircle className="w-5 h-5 text-green-600" />
          ) : (
            <AlertCircle className="w-5 h-5 text-yellow-600" />
          )}
          <h3 className={`font-semibold ${
            validation.isValid ? 'text-green-900' : 'text-yellow-900'
          }`}>
            {validation.isValid ? 'API設定完了' : 'API設定が必要'}
          </h3>
        </div>
        <p className={`text-sm ${
          validation.isValid ? 'text-green-800' : 'text-yellow-800'
        }`}>
          {validation.isValid 
            ? 'すべての必須APIが設定されています。トレンド分析機能を使用できます。'
            : `${validation.missingServices.length}個の必須APIキーが未設定です。`
          }
        </p>
        {validation.availableServices.length > 0 && (
          <p className="text-sm text-gray-600 mt-1">
            利用可能: {validation.availableServices.join(', ')}
          </p>
        )}
      </div>

      {/* API Key Configuration */}
      <div className="space-y-4">
        {apiServices.map((service) => (
          <div key={service.id} className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
            <div className="flex items-start justify-between mb-4">
              <div className="flex-1">
                <div className="flex items-center space-x-2 mb-2">
                  <h3 className="font-semibold text-gray-900">{service.name}</h3>
                  {service.required && (
                    <span className="px-2 py-1 bg-red-100 text-red-800 text-xs font-medium rounded-full">
                      必須
                    </span>
                  )}
                  {apiKeyManager.hasApiKey(service.id) && (
                    <CheckCircle className="w-4 h-4 text-green-600" />
                  )}
                </div>
                <p className="text-sm text-gray-600 mb-3">{service.description}</p>
                <a
                  href={service.setupUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center space-x-1 text-sm text-blue-600 hover:text-blue-800"
                >
                  <span>設定方法を確認</span>
                  <ExternalLink className="w-3 h-3" />
                </a>
              </div>
            </div>

            <div className="flex space-x-3">
              <input
                type={service.type || 'text'}
                value={apiKeys[service.id as keyof typeof apiKeys]}
                onChange={(e) => setApiKeys(prev => ({ 
                  ...prev, 
                  [service.id]: e.target.value 
                }))}
                placeholder={service.placeholder}
                className="input-field flex-1"
              />
              <button
                onClick={() => handleSaveApiKey(service.id, apiKeys[service.id as keyof typeof apiKeys])}
                className="btn-secondary"
              >
                保存
              </button>
            </div>
          </div>
        ))}
      </div>

      {/* Save All Button */}
      <div className="flex justify-end">
        <button
          onClick={handleSaveAll}
          className="btn-primary flex items-center space-x-2"
        >
          <Save className="w-4 h-4" />
          <span>すべて保存</span>
        </button>
      </div>

      {/* Setup Instructions */}
      <div className="bg-blue-50 border border-blue-200 rounded-xl p-6">
        <h3 className="text-lg font-semibold text-blue-900 mb-4">
          API設定の手順
        </h3>
        <div className="space-y-4 text-sm text-blue-800">
          <div>
            <h4 className="font-semibold mb-2">1. Google Custom Search API（必須）</h4>
            <ol className="list-decimal list-inside space-y-1 ml-4">
              <li>Google Cloud Consoleでプロジェクトを作成</li>
              <li>Custom Search JSON APIを有効化</li>
              <li>認証情報でAPIキーを作成</li>
              <li>Google Custom Search Engineを作成</li>
              <li>Search Engine IDを取得（新形式：73c70ae8e1c314d0f）</li>
            </ol>
          </div>
          
          <div>
            <h4 className="font-semibold mb-2">2. SerpAPI（推奨）</h4>
            <ol className="list-decimal list-inside space-y-1 ml-4">
              <li>SerpAPI.comでアカウント作成</li>
              <li>ダッシュボードからAPIキーを取得</li>
              <li>Google Trendsエンジンが利用可能</li>
            </ol>
          </div>
        </div>
      </div>

      {/* New Format Information */}
      <div className="bg-green-50 border border-green-200 rounded-xl p-6">
        <h3 className="text-lg font-semibold text-green-900 mb-4">
          <CheckCircle className="w-5 h-5 inline mr-2" />
          Custom Search Engine ID 新形式について
        </h3>
        <div className="text-sm text-green-800 space-y-3">
          <div>
            <p className="font-semibold mb-2">新形式（現在）:</p>
            <div className="bg-white border border-green-300 rounded-lg p-3 font-mono text-green-900">
              73c70ae8e1c314d0f
            </div>
            <p className="mt-2">✅ 短い形式、コロン（:）なし</p>
          </div>
          
          <div>
            <p className="font-semibold mb-2">旧形式（以前）:</p>
            <div className="bg-gray-100 border border-gray-300 rounded-lg p-3 font-mono text-gray-600">
              017576662512468239146:omuauf_lfve
            </div>
            <p className="mt-2">❌ 長い形式、コロン（:）あり</p>
          </div>

          <div className="mt-4 p-3 bg-green-100 rounded-lg">
            <p className="font-semibold text-green-900 mb-1">重要:</p>
            <p className="text-green-800">
              最新のGoogle Custom Search Engineでは新形式のIDが使用されています。
              古い形式のIDをお持ちの場合は、Google Custom Search Engineの管理画面で新しいIDを確認してください。
            </p>
          </div>
        </div>
      </div>

      {/* Cost Information */}
      <div className="bg-gray-50 border border-gray-200 rounded-xl p-6">
        <h3 className="text-lg font-semibold text-gray-900 mb-4">
          API利用料金の目安
        </h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
          <div>
            <h4 className="font-semibold text-gray-800 mb-2">Google Custom Search API</h4>
            <p className="text-gray-600">100クエリ/日まで無料、その後$5/1000クエリ</p>
          </div>
          <div>
            <h4 className="font-semibold text-gray-800 mb-2">SerpAPI</h4>
            <p className="text-gray-600">100クエリ/月まで無料、その後$50/月〜</p>
          </div>
        </div>
      </div>
    </div>
  );
};