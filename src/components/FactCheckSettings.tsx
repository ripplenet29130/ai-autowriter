import React, { useState, useEffect } from 'react';
import { ShieldCheck, Save, Key, Info, ExternalLink } from 'lucide-react';
import { supabase } from '../services/supabaseClient';
import toast from 'react-hot-toast';

export const FactCheckSettings: React.FC = () => {
    const [settings, setSettings] = useState({
        enabled: false,
        perplexityApiKey: '',
        maxItemsToCheck: 10,
    });
    const [loading, setLoading] = useState(false);
    const [initialLoading, setInitialLoading] = useState(true);

    useEffect(() => {
        loadSettings();
    }, []);

    const loadSettings = async () => {
        if (!supabase) return;
        try {
            const { data, error } = await supabase
                .from('fact_check_settings')
                .select('*')
                .limit(1)
                .maybeSingle();

            if (error) {
                console.error('Initial load error details:', error);
            }
            if (data) {
                setSettings({
                    perplexityApiKey: data.perplexity_api_key || '',
                    maxItemsToCheck: data.max_items_to_check || 10,
                });
            }
        } catch (error) {
            console.error('Failed to load fact check settings:', error);
        } finally {
            setInitialLoading(false);
        }
    };

    const handleSave = async () => {
        if (!supabase) return;
        setLoading(true);
        try {
            const { data: existingSettings } = await supabase
                .from('fact_check_settings')
                .select('id')
                .limit(1)
                .maybeSingle();

            const payload = {
                perplexity_api_key: settings.perplexityApiKey,
                max_items_to_check: settings.maxItemsToCheck,
                updated_at: new Date().toISOString(),
            };

            let error;
            if (existingSettings) {
                const result = await supabase
                    .from('fact_check_settings')
                    .update(payload)
                    .eq('id', existingSettings.id);
                error = result.error;
            } else {
                const result = await supabase
                    .from('fact_check_settings')
                    .insert([payload]);
                error = result.error;
            }

            if (error) {
                console.error('Save error details:', error);
                throw error;
            }
            toast.success('ファクトチェック設定を保存しました');
        } catch (error: any) {
            console.error('Failed to save settings:', error);
            const message = error.message || '設定の保存に失敗しました';
            toast.error(message);
        } finally {
            setLoading(false);
        }
    };

    if (initialLoading) {
        return (
            <div className="flex justify-center items-center py-12">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
            </div>
        );
    }

    return (
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
            <div className="flex items-center space-x-3 mb-6">
                <ShieldCheck className="w-6 h-6 text-green-600" />
                <h3 className="text-lg font-semibold text-gray-900">Perplexity ファクトチェック設定</h3>
            </div>

            {/* APIキー設定 */}
            <div className="space-y-2">
                <div className="flex items-center justify-between">
                    <label className="flex items-center text-sm font-medium text-gray-700">
                        <Key className="w-4 h-4 mr-1.5 text-gray-400" />
                        Perplexity APIキー
                    </label>
                    <a
                        href="https://www.perplexity.ai/settings/api"
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-xs text-blue-600 hover:text-blue-500 flex items-center"
                    >
                        キーを取得
                        <ExternalLink className="w-3 h-3 ml-1" />
                    </a>
                </div>
                <input
                    type="password"
                    value={settings.perplexityApiKey}
                    onChange={(e) => setSettings({ ...settings, perplexityApiKey: e.target.value })}
                    placeholder="pplx-..."
                    className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent font-mono text-sm leading-6"
                />
            </div>


            {/* 検証数制限 */}
            <div className="space-y-2">
                <label className="block text-sm font-medium text-gray-700">
                    1記事あたりの最大検証項目数
                </label>
                <input
                    type="number"
                    min="1"
                    max="20"
                    value={settings.maxItemsToCheck}
                    onChange={(e) => setSettings({ ...settings, maxItemsToCheck: parseInt(e.target.value) || 5 })}
                    className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent text-sm leading-6"
                />
                <p className="text-xs text-gray-500">
                    推奨：5〜10件（バッチ処理により、5件につき1回のAPIコールが行われます）
                </p>
            </div>

            {/* Info */}
            <div className="p-4 bg-blue-50 rounded-lg border border-blue-100 flex items-start space-x-3">
                <Info className="w-5 h-5 text-blue-600 mt-0.5" />
                <div className="text-sm text-blue-800">
                    <p className="font-semibold mb-1 text-blue-900">💡 動作の仕組み</p>
                    <ul className="list-disc list-inside space-y-1">
                        <li>記事生成時に数値・固有名詞・日付を自動抽出します。</li>
                        <li>重大な事実誤認が見つかった場合、WordPress投稿は自動的に「下書き」になります。</li>
                        <li>[[]]記法で指定した箇所は最優先で検証されます。</li>
                    </ul>
                </div>
            </div>

            {/* Action */}
            <button
                onClick={handleSave}
                disabled={loading}
                className="w-full flex items-center justify-center space-x-2 py-2.5 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors disabled:opacity-50 font-medium"
            >
                <Save className="w-5 h-5" />
                <span>{loading ? '保存中...' : '設定を保存'}</span>
            </button>
        </div>
    );
};
