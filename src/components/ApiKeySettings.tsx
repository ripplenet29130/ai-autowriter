import React, { useState, useEffect } from 'react';
import { Key, Check, AlertCircle, ExternalLink, MessageSquare } from 'lucide-react';
import { apiKeyManager } from '../services/apiKeyManager';
import { supabase } from '../services/supabaseClient';
import toast from 'react-hot-toast';

export const ApiKeySettings: React.FC = () => {
    const [serpApiKey, setSerpApiKey] = useState('');
    const [googleApiKey, setGoogleApiKey] = useState('');
    const [searchEngineId, setSearchEngineId] = useState('');
    const [chatworkApiToken, setChatworkApiToken] = useState('');
    const [saved, setSaved] = useState(false);
    const [validationStatus, setValidationStatus] = useState<{
        isValid: boolean;
        missingServices: string[];
        availableServices: string[];
    } | null>(null);

    useEffect(() => {
        // 既存のAPIキーを読み込み
        const existingSerpKey = apiKeyManager.getApiKey('serpapi');
        const existingGoogleKey = apiKeyManager.getApiKey('google_custom_search');
        const existingEngineId = apiKeyManager.getApiKey('google_custom_search_engine_id');

        if (existingSerpKey) setSerpApiKey(existingSerpKey);
        if (existingGoogleKey) setGoogleApiKey(existingGoogleKey);
        if (existingEngineId) setSearchEngineId(existingEngineId);

        // Chatwork API KeyをDBから読み込み
        const loadChatworkKey = async () => {
            if (!supabase) return;
            const { data } = await supabase
                .from('app_settings')
                .select('value')
                .eq('key', 'chatwork_api_token')
                .maybeSingle();

            if (data) {
                setChatworkApiToken(data.value);
            }
        };
        loadChatworkKey();

        // 検証状態を取得
        setValidationStatus(apiKeyManager.validateConfiguration());
    }, []);

    const handleSave = async () => {
        if (!supabase) {
            toast.error('データベース接続エラー');
            return;
        }

        // ローカル設定のAPIキーを保存
        if (serpApiKey) apiKeyManager.setApiKey('serpapi', serpApiKey);
        if (googleApiKey) apiKeyManager.setApiKey('google_custom_search', googleApiKey);
        if (searchEngineId) apiKeyManager.setApiKey('google_custom_search_engine_id', searchEngineId);

        // すべてのAPIキーをDBにも保存（サーバー側でのアクセスを可能にする）
        const apiKeysToSave = [
            { key: 'serpapi_key', value: serpApiKey, description: 'SerpAPI Key for trend analysis' },
            { key: 'google_custom_search_api_key', value: googleApiKey, description: 'Google Custom Search API Key' },
            { key: 'google_custom_search_engine_id', value: searchEngineId, description: 'Google Custom Search Engine ID' },
            { key: 'chatwork_api_token', value: chatworkApiToken, description: 'Chatwork API Token for notifications' }
        ];

        for (const apiKey of apiKeysToSave) {
            if (apiKey.value) {
                const { error } = await supabase
                    .from('app_settings')
                    .upsert({
                        key: apiKey.key,
                        value: apiKey.value,
                        description: apiKey.description
                    });

                if (error) {
                    console.error(`Failed to save ${apiKey.key}:`, error);
                    toast.error(`${apiKey.description}の保存に失敗しました`);
                    return;
                }
            }
        }

        // 検証状態を更新
        setValidationStatus(apiKeyManager.validateConfiguration());

        setSaved(true);
        toast.success('設定を保存しました');
        setTimeout(() => setSaved(false), 3000);
    };

    const handleTest = async () => {
        // テスト用のトレンド分析を実行
        alert('APIキーのテストを開始します。コンソールで結果を確認してください。');

        try {
            const { realTrendAnalysisService } = await import('../services/realTrendAnalysisService');
            const result = await realTrendAnalysisService.analyzeTrends('テスト', {
                region: 'JP',
                timeframe: 'today 12-m'
            });

            console.log('✅ APIテスト成功:', result);
            alert('APIキーのテストに成功しました！コンソールで詳細を確認してください。');
        } catch (error) {
            console.error('❌ APIテスト失敗:', error);
            alert('APIキーのテストに失敗しました。コンソールでエラーを確認してください。');
        }
    };

    return (
        <div className="space-y-6">
            <div className="mb-4">
                <p className="text-sm text-gray-600">
                    競合調査と高品質な記事生成に使用するAPIキーを設定します
                </p>
            </div>

            {/* ステータス表示 */}

            {validationStatus && (
                <div
                    className={`p-4 rounded-lg border ${validationStatus.isValid
                        ? 'bg-green-50 border-green-200'
                        : 'bg-yellow-50 border-yellow-200'
                        }`}
                >
                    <div className="flex items-start space-x-2">
                        {validationStatus.isValid ? (
                            <Check className="w-5 h-5 text-green-600 mt-0.5" />
                        ) : (
                            <AlertCircle className="w-5 h-5 text-yellow-600 mt-0.5" />
                        )}
                        <div className="flex-1">
                            <p className="font-medium text-sm">
                                {validationStatus.isValid
                                    ? '✅ すべてのAPIキーが設定されています'
                                    : '⚠️ 一部のAPIキーが未設定です'}
                            </p>
                            {validationStatus.availableServices.length > 0 && (
                                <p className="text-xs text-gray-600 mt-1">
                                    設定済み: {validationStatus.availableServices.join(', ')}
                                </p>
                            )}
                            {validationStatus.missingServices.length > 0 && (
                                <p className="text-xs text-gray-600 mt-1">
                                    未設定: {validationStatus.missingServices.join(', ')}
                                </p>
                            )}
                        </div>
                    </div>
                </div>
            )}

            {/* SerpAPI */}
            <div className="bg-white rounded-lg border border-gray-200 p-4 space-y-3">
                <div className="flex items-start justify-between">
                    <div>
                        <h4 className="font-semibold text-gray-900">SerpAPI</h4>
                        <p className="text-sm text-gray-600 mt-1">
                            Google Trendsのデータ取得に使用（推奨）
                        </p>
                    </div>
                    <a
                        href="https://serpapi.com/"
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-blue-600 hover:text-blue-700 flex items-center space-x-1 text-sm"
                    >
                        <span>登録</span>
                        <ExternalLink className="w-3 h-3" />
                    </a>
                </div>
                <input
                    type="password"
                    value={serpApiKey}
                    onChange={(e) => setSerpApiKey(e.target.value)}
                    placeholder="SerpAPI Key を入力"
                    className="input-field w-full font-mono text-sm"
                />
            </div>

            {/* Google Custom Search API */}
            <div className="bg-white rounded-lg border border-gray-200 p-4 space-y-3">
                <div className="flex items-start justify-between">
                    <div>
                        <h4 className="font-semibold text-gray-900">Google Custom Search API</h4>
                        <p className="text-sm text-gray-600 mt-1">
                            競合記事の検索と分析に使用（必須）
                        </p>
                    </div>
                    <a
                        href="https://console.cloud.google.com/apis/library/customsearch.googleapis.com"
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-blue-600 hover:text-blue-700 flex items-center space-x-1 text-sm"
                    >
                        <span>有効化</span>
                        <ExternalLink className="w-3 h-3" />
                    </a>
                </div>

                <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                        API Key
                    </label>
                    <input
                        type="password"
                        value={googleApiKey}
                        onChange={(e) => setGoogleApiKey(e.target.value)}
                        placeholder="Google API Key を入力"
                        className="input-field w-full font-mono text-sm"
                    />
                </div>

                <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                        Search Engine ID
                    </label>
                    <input
                        type="text"
                        value={searchEngineId}
                        onChange={(e) => setSearchEngineId(e.target.value)}
                        placeholder="Search Engine ID を入力 (例: 73c70ae8e1c314d0f)"
                        className="input-field w-full font-mono text-sm"
                    />
                    <p className="text-xs text-gray-500 mt-1">
                        <a
                            href="https://programmablesearchengine.google.com/"
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-blue-600 hover:underline"
                        >
                            Programmable Search Engine
                        </a>
                        で作成できます
                    </p>
                </div>
            </div>

            {/* Chatwork API Settings */}
            <div className="bg-white rounded-lg border border-gray-200 p-4 space-y-3">
                <div className="flex items-start justify-between">
                    <div>
                        <h4 className="font-semibold text-gray-900">Chatwork API</h4>
                        <p className="text-sm text-gray-600 mt-1">
                            記事投稿完了時にChatworkに通知を送るために使用します
                        </p>
                    </div>
                    <a
                        href="https://www.chatwork.com/service/packages/chatwork/subpackages/api/token.php"
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-blue-600 hover:text-blue-700 flex items-center space-x-1 text-sm"
                    >
                        <span>APIトークン発行</span>
                        <ExternalLink className="w-3 h-3" />
                    </a>
                </div>

                <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                        Chatwork API Token
                    </label>
                    <div className="relative">
                        <MessageSquare className="absolute left-3 top-2.5 w-4 h-4 text-gray-400" />
                        <input
                            type="password"
                            value={chatworkApiToken}
                            onChange={(e) => setChatworkApiToken(e.target.value)}
                            placeholder="Chatwork API Token を入力"
                            className="input-field w-full font-mono text-sm pl-9"
                        />
                    </div>
                    <p className="text-xs text-gray-500 mt-1">
                        ※ このキーはサーバー側に安全に保存され、自動投稿時の通知に使用されます
                    </p>
                </div>
            </div>

            {/* 保存メッセージ */}
            {saved && (
                <div className="bg-green-50 border border-green-200 rounded-lg p-4">
                    <div className="flex items-center space-x-2 text-green-800">
                        <Check className="w-5 h-5" />
                        <span className="font-medium">設定を保存しました</span>
                    </div>
                </div>
            )}

            {/* アクションボタン */}
            <div className="flex space-x-3">
                <button
                    onClick={handleSave}
                    className="btn-primary flex items-center space-x-2"
                >
                    <Check className="w-4 h-4" />
                    <span>保存</span>
                </button>

                <button
                    onClick={handleTest}
                    className="btn-secondary flex items-center space-x-2"
                    disabled={!validationStatus?.isValid}
                >
                    <Key className="w-4 h-4" />
                    <span>接続テスト</span>
                </button>
            </div>

            {/* 説明 */}
            <div className="bg-blue-50 rounded-lg p-4 border border-blue-200">
                <h5 className="font-semibold text-blue-900 mb-2">📝 設定手順</h5>
                <ol className="space-y-2 text-sm text-blue-800">
                    <li>
                        <strong>1. SerpAPI:</strong>
                        <a href="https://serpapi.com/" target="_blank" rel="noopener noreferrer" className="underline ml-1">
                            serpapi.com
                        </a>
                        でアカウント作成 → APIキーをコピー
                    </li>
                    <li>
                        <strong>2. Google Custom Search API:</strong>
                        <ul className="ml-4 mt-1 space-y-1">
                            <li>
                                •
                                <a
                                    href="https://console.cloud.google.com/apis/library/customsearch.googleapis.com"
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="underline ml-1"
                                >
                                    Custom Search APIを有効化
                                </a>
                            </li>
                            <li>
                                •
                                <a
                                    href="https://console.cloud.google.com/apis/credentials"
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="underline ml-1"
                                >
                                    認証情報でAPIキーを作成
                                </a>
                            </li>
                            <li>
                                •
                                <a
                                    href="https://programmablesearchengine.google.com/"
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="underline ml-1"
                                >
                                    Programmable Search Engineで検索エンジンを作成
                                </a>
                                → Search Engine IDを取得
                            </li>
                        </ul>
                    </li>
                    <li>
                        <strong>3.</strong> 上記のフォームにAPIキーを入力して「保存」
                    </li>
                    <li>
                        <strong>4.</strong> 「接続テスト」で動作確認
                    </li>
                </ol>
            </div>
        </div>
    );
};
