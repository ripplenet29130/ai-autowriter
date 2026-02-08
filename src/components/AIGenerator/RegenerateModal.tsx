import React, { useState } from 'react';
import { X, RefreshCw, Sparkles } from 'lucide-react';

interface RegenerateModalProps {
    currentArticle: {
        title: string;
        content: string;
        wordCount?: number;
    };
    onClose: () => void;
    onRegenerate: (options: RegenerateOptions) => void;
    isRegenerating: boolean;
}

export interface RegenerateOptions {
    targetWordCount: number;
    adjustmentType: 'none' | 'detailed' | 'concise' | 'technical' | 'simple';
    customPrompt: string;
}

export const RegenerateModal: React.FC<RegenerateModalProps> = ({
    currentArticle,
    onClose,
    onRegenerate,
    isRegenerating
}) => {
    const [targetWordCount, setTargetWordCount] = useState(currentArticle.wordCount || 2000);
    const [adjustmentType, setAdjustmentType] = useState<RegenerateOptions['adjustmentType']>('none');
    const [customPrompt, setCustomPrompt] = useState('');

    const handleSubmit = () => {
        onRegenerate({
            targetWordCount,
            adjustmentType,
            customPrompt
        });
    };

    return (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
            <div className="bg-white rounded-xl shadow-2xl max-w-2xl w-full max-h-[90vh] overflow-y-auto">
                <div className="sticky top-0 bg-white border-b border-gray-200 px-6 py-4 flex items-center justify-between">
                    <div className="flex items-center space-x-3">
                        <RefreshCw className="w-6 h-6 text-purple-600" />
                        <h2 className="text-xl font-bold text-gray-900">記事を再生成</h2>
                    </div>
                    <button
                        onClick={onClose}
                        disabled={isRegenerating}
                        className="text-gray-400 hover:text-gray-600 transition-colors disabled:opacity-50"
                    >
                        <X className="w-6 h-6" />
                    </button>
                </div>

                <div className="p-6 space-y-6">
                    {/* Current Stats */}
                    <div className="bg-blue-50 rounded-lg p-4 border border-blue-100">
                        <p className="text-sm font-medium text-blue-900 mb-2">現在の記事</p>
                        <div className="grid grid-cols-2 gap-4 text-sm">
                            <div>
                                <span className="text-gray-600">文字数:</span>
                                <span className="ml-2 font-semibold text-blue-700">
                                    {currentArticle.wordCount?.toLocaleString('ja-JP') || '不明'} 文字
                                </span>
                            </div>
                        </div>
                    </div>

                    {/* Target Word Count */}
                    <div>
                        <label className="block text-sm font-medium text-gray-700 mb-2">
                            目標文字数
                        </label>
                        <input
                            type="number"
                            value={targetWordCount}
                            onChange={(e) => setTargetWordCount(parseInt(e.target.value) || 2000)}
                            min="500"
                            max="10000"
                            step="100"
                            disabled={isRegenerating}
                            className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-transparent disabled:opacity-50"
                        />
                        <p className="text-xs text-gray-500 mt-1">
                            500〜10,000文字の範囲で指定してください
                        </p>
                    </div>

                    {/* Adjustment Type */}
                    <div>
                        <label className="block text-sm font-medium text-gray-700 mb-2">
                            調整指示
                        </label>
                        <select
                            value={adjustmentType}
                            onChange={(e) => setAdjustmentType(e.target.value as RegenerateOptions['adjustmentType'])}
                            disabled={isRegenerating}
                            className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-transparent disabled:opacity-50"
                        >
                            <option value="none">そのまま再生成</option>
                            <option value="detailed">より詳しく</option>
                            <option value="concise">より簡潔に</option>
                            <option value="technical">専門的に</option>
                            <option value="simple">分かりやすく</option>
                        </select>
                    </div>

                    {/* Custom Prompt */}
                    <div>
                        <label className="block text-sm font-medium text-gray-700 mb-2">
                            カスタムプロンプト（任意）
                        </label>
                        <textarea
                            value={customPrompt}
                            onChange={(e) => setCustomPrompt(e.target.value)}
                            placeholder="例: SEO対策を強化してください、具体例を追加してください、など"
                            rows={3}
                            disabled={isRegenerating}
                            className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-transparent disabled:opacity-50"
                        />
                        <p className="text-xs text-gray-500 mt-1">
                            追加の指示がある場合は入力してください
                        </p>
                    </div>

                    {/* Info Box */}
                    <div className="bg-purple-50 rounded-lg p-4 border border-purple-100">
                        <div className="flex items-start space-x-3">
                            <Sparkles className="w-5 h-5 text-purple-600 mt-0.5 flex-shrink-0" />
                            <div className="text-sm text-purple-900">
                                <p className="font-semibold mb-1">💡 再生成について</p>
                                <ul className="list-disc list-inside space-y-1 text-purple-800">
                                    <li>元の記事を基に、指定した調整を加えて再生成します</li>
                                    <li>元の記事は保持されます（比較可能）</li>
                                    <li>生成には30秒〜1分程度かかる場合があります</li>
                                </ul>
                            </div>
                        </div>
                    </div>
                </div>

                {/* Actions */}
                <div className="sticky bottom-0 bg-gray-50 px-6 py-4 flex justify-end space-x-3 border-t border-gray-200">
                    <button
                        onClick={onClose}
                        disabled={isRegenerating}
                        className="px-4 py-2 text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors disabled:opacity-50"
                    >
                        キャンセル
                    </button>
                    <button
                        onClick={handleSubmit}
                        disabled={isRegenerating}
                        className="px-6 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700 transition-colors disabled:opacity-50 flex items-center space-x-2"
                    >
                        {isRegenerating ? (
                            <>
                                <RefreshCw className="w-4 h-4 animate-spin" />
                                <span>再生成中...</span>
                            </>
                        ) : (
                            <>
                                <Sparkles className="w-4 h-4" />
                                <span>再生成を開始</span>
                            </>
                        )}
                    </button>
                </div>
            </div>
        </div>
    );
};
