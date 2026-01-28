import React from 'react';
import { TrendingUp, Zap } from 'lucide-react';
import { useTrendAnalysis } from '../../hooks/useTrendAnalysis';
import { useAppStore } from '../../store/useAppStore';
import { KeywordInput } from './KeywordInput';
import { TrendResults } from './TrendResults';
import { CompetitorCards } from './CompetitorCards';
import { SEOMetrics } from './SEOMetrics';

/**
 * トレンド分析メインコンポーネント
 */
export const TrendAnalysis: React.FC = () => {
    const {
        keyword,
        isAnalyzing,
        analysisResult,
        analyzeKeyword,
        clearResults,
        updateKeyword,
    } = useTrendAnalysis();

    const { setActiveView } = useAppStore();

    const handleGenerateArticle = () => {
        if (analysisResult) {
            // トレンドデータを使って記事生成画面へ
            setActiveView('generator');
        }
    };

    return (
        <div className="space-y-6">
            {/* Header */}
            <div className="flex items-center justify-between">
                <div className="flex items-center space-x-3">
                    <TrendingUp className="w-8 h-8 text-purple-600" />
                    <div>
                        <h2 className="text-2xl font-bold text-gray-900">トレンド分析</h2>
                        <p className="text-gray-600">キーワードのトレンドとSEO難易度を分析します</p>
                    </div>
                </div>
            </div>

            {/* Keyword Input */}
            <KeywordInput
                keyword={keyword}
                isAnalyzing={isAnalyzing}
                onKeywordChange={updateKeyword}
                onAnalyze={() => analyzeKeyword()}
            />

            {/* Analysis Results */}
            {analysisResult && (
                <div className="space-y-6">
                    {/* Trend Metrics */}
                    <TrendResults result={analysisResult} />

                    {/* SEO Metrics and Keywords */}
                    <SEOMetrics result={analysisResult} />

                    {/* Competitor Analysis */}
                    {analysisResult.competitorAnalysis && (
                        <CompetitorCards
                            competitors={analysisResult.competitorAnalysis.topArticles}
                            averageLength={analysisResult.competitorAnalysis.averageLength}
                        />
                    )}

                    {/* Generate Article Button */}
                    <div className="bg-gradient-to-r from-purple-50 to-blue-50 rounded-xl border border-purple-200 p-6">
                        <div className="flex items-center justify-between">
                            <div>
                                <h3 className="text-lg font-semibold text-gray-900 mb-2">
                                    このトレンドで記事を生成
                                </h3>
                                <p className="text-sm text-gray-600">
                                    分析結果を活用して、SEOに最適化された記事を自動生成します
                                </p>
                            </div>
                            <button
                                onClick={handleGenerateArticle}
                                className="btn-primary flex items-center space-x-2"
                            >
                                <Zap className="w-5 h-5" />
                                <span>記事生成へ</span>
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* Empty State */}
            {!analysisResult && !isAnalyzing && (
                <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-12 text-center">
                    <TrendingUp className="w-16 h-16 text-gray-300 mx-auto mb-4" />
                    <h3 className="text-lg font-semibold text-gray-900 mb-2">
                        キーワードを分析してみましょう
                    </h3>
                    <p className="text-gray-600">
                        上記の入力欄にキーワードを入力して、トレンド分析を開始してください
                    </p>
                </div>
            )}
        </div>
    );
};

export default TrendAnalysis;
