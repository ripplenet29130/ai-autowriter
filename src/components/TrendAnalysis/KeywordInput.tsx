import React from 'react';
import { Search, RefreshCw } from 'lucide-react';

interface KeywordInputProps {
    keyword: string;
    isAnalyzing: boolean;
    onKeywordChange: (keyword: string) => void;
    onAnalyze: () => void;
}

/**
 * キーワード入力コンポーネント
 */
export const KeywordInput: React.FC<KeywordInputProps> = ({
    keyword,
    isAnalyzing,
    onKeywordChange,
    onAnalyze,
}) => {
    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        onAnalyze();
    };

    return (
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
            <h3 className="text-lg font-semibold text-gray-900 mb-4">キーワード分析</h3>

            <form onSubmit={handleSubmit} className="space-y-4">
                <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                        分析キーワード
                    </label>
                    <div className="flex space-x-3">
                        <input
                            type="text"
                            value={keyword}
                            onChange={(e) => onKeywordChange(e.target.value)}
                            placeholder="例: AI技術、AGA治療、自伝執筆"
                            className="input-field flex-1"
                            disabled={isAnalyzing}
                        />
                        <button
                            type="submit"
                            disabled={isAnalyzing || !keyword.trim()}
                            className="btn-primary flex items-center space-x-2"
                        >
                            {isAnalyzing ? (
                                <>
                                    <RefreshCw className="w-4 h-4 animate-spin" />
                                    <span>分析中...</span>
                                </>
                            ) : (
                                <>
                                    <Search className="w-4 h-4" />
                                    <span>分析</span>
                                </>
                            )}
                        </button>
                    </div>
                </div>

                <p className="text-sm text-gray-500">
                    キーワードを入力してトレンド分析を実行します。SEO難易度、検索ボリューム、競合情報などを確認できます。
                </p>
            </form>
        </div>
    );
};
