import React, { useState } from 'react';
import { Zap, Check, AlertCircle } from 'lucide-react';
import { useAppStore } from '../../store/useAppStore';
import { AIConfigForm } from './AIConfigForm';
import { AIConfig } from '../../types';
import toast from 'react-hot-toast';

export const AIConfigComponent: React.FC = () => {
    const { aiConfigs, setAIConfig, activateAIConfig, aiConfig } = useAppStore();
    const [selectedProvider, setSelectedProvider] = useState<'openai' | 'claude' | 'gemini' | null>(null);

    // Get config for specific provider
    const getConfig = (provider: 'openai' | 'claude' | 'gemini') => {
        return aiConfigs.find(c => c.provider === provider) || null;
    };

    const handleSubmit = async (config: AIConfig) => {
        try {
            await setAIConfig(config);
            toast.success(`${config.provider}の設定を保存しました`);
            setSelectedProvider(null);
        } catch (error) {
            console.error('Failed to save AI config:', error);
            toast.error('設定の保存に失敗しました');
        }
    };

    const handleActivate = async (e: React.MouseEvent, id: string) => {
        e.stopPropagation();
        try {
            await activateAIConfig(id);
            toast.success('AIプロバイダーを有効化しました');
        } catch (error) {
            toast.error('有効化に失敗しました');
        }
    };

    const providers: { id: 'openai' | 'claude' | 'gemini', label: string, description: string }[] = [
        { id: 'openai', label: 'OpenAI', description: 'GPT-5.2 / GPT-5 / GPT-4.1' },
        { id: 'claude', label: 'Anthropic Claude', description: 'Claude 4.5 Opus / Sonnet' },
        { id: 'gemini', label: 'Google Gemini', description: 'Gemini 3 Flash / Pro / 2.5' },
    ];

    return (
        <div className="space-y-6">
            {/* Header */}
            <div className="flex items-center space-x-3 mb-6">
                <Zap className="w-8 h-8 text-yellow-500" />
                <div>
                    <h2 className="text-2xl font-bold text-gray-900">AI設定</h2>
                    <p className="text-gray-600">利用するAIプロバイダーを選択して設定を行ってください（有効化された1つのみが記事生成に使用されます）</p>
                </div>
            </div>

            {selectedProvider ? (
                <div>
                    <button
                        onClick={() => setSelectedProvider(null)}
                        className="mb-4 text-sm text-gray-500 hover:text-gray-700 flex items-center"
                    >
                        ← プロバイダー選択に戻る
                    </button>
                    <AIConfigForm
                        initialConfig={getConfig(selectedProvider)}
                        provider={selectedProvider}
                        onSubmit={handleSubmit}
                        onCancel={() => setSelectedProvider(null)}
                    />
                </div>
            ) : (
                <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                    {providers.map((p) => {
                        const config = getConfig(p.id);
                        const isConfigured = !!config;
                        const isActive = config?.isActive;

                        return (
                            <div
                                key={p.id}
                                onClick={() => setSelectedProvider(p.id)}
                                className={`
                                    relative cursor-pointer rounded-xl border-2 p-6 transition-all hover:shadow-md
                                    ${isActive ? 'border-yellow-400 bg-yellow-50/20' : isConfigured ? 'border-blue-200 bg-blue-50/30' : 'border-gray-200 bg-white hover:border-gray-300'}
                                `}
                            >
                                <div className="flex justify-between items-start mb-4">
                                    <h3 className="text-lg font-bold text-gray-900">{p.label}</h3>
                                    <div className="flex flex-col items-end gap-2">
                                        {isActive ? (
                                            <div className="flex items-center text-yellow-700 bg-yellow-100 px-2 py-1 rounded-full text-xs font-bold">
                                                <Zap className="w-3 h-3 mr-1" />
                                                使用中
                                            </div>
                                        ) : isConfigured ? (
                                            <div className="flex items-center text-green-600 bg-green-50 px-2 py-1 rounded-full text-xs font-medium">
                                                <Check className="w-3 h-3 mr-1" />
                                                設定済み
                                            </div>
                                        ) : (
                                            <div className="flex items-center text-gray-400 bg-gray-100 px-2 py-1 rounded-full text-xs font-medium">
                                                <AlertCircle className="w-3 h-3 mr-1" />
                                                未設定
                                            </div>
                                        )}
                                    </div>
                                </div>
                                <p className="text-sm text-gray-600 mb-4">{p.description}</p>

                                {isConfigured && (
                                    <div className="border-t border-gray-100 pt-3 flex flex-col gap-3">
                                        <div className="text-xs text-gray-500">
                                            <p>Model: <span className="font-medium">{config.model}</span></p>
                                            {config.imageGenerationEnabled && (
                                                <p className="text-blue-600 mt-1">画像生成: ON</p>
                                            )}
                                        </div>

                                        {!isActive && (
                                            <button
                                                onClick={(e) => handleActivate(e, config.id!)}
                                                className="w-full py-2 bg-white border border-yellow-400 text-yellow-700 text-sm font-bold rounded-lg hover:bg-yellow-400 hover:text-white transition-colors"
                                            >
                                                このAIを使用する
                                            </button>
                                        )}
                                    </div>
                                )}
                            </div>
                        );
                    })}
                </div>
            )}
        </div>
    );
};
