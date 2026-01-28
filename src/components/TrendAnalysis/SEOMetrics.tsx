import React from 'react';
import { AlertCircle, Key, Lightbulb } from 'lucide-react';
import { TrendAnalysisResult } from '../../types';

interface SEOMetricsProps {
    result: TrendAnalysisResult;
}

/**
 * SEOメトリクス表示コンポーネント
 */
export const SEOMetrics: React.FC<SEOMetricsProps> = ({ result }) => {
    const getDifficultyColor = (difficulty: number) => {
        if (difficulty < 30) return 'text-green-600 bg-green-50';
        if (difficulty < 60) return 'text-yellow-600 bg-yellow-50';
        return 'text-red-600 bg-red-50';
    };

    const getOpportunityColor = (score: number) => {
        if (score > 70) return 'text-green-600 bg-green-50';
        if (score > 40) return 'text-yellow-600 bg-yellow-50';
        return 'text-orange-600 bg-orange-50';
    };

    return (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* SEO難易度 */}
            <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
                <div className="flex items-center space-x-2 mb-4">
                    <AlertCircle className="w-5 h-5 text-blue-600" />
                    <h3 className="text-lg font-semibold text-gray-900">SEO難易度</h3>
                </div>

                <div className="space-y-4">
                    <div>
                        <div className="flex items-center justify-between mb-2">
                            <span className="text-sm font-medium text-gray-700">難易度スコア</span>
                            <span className={`text-2xl font-bold ${getDifficultyColor(result.seoData?.difficulty || 0).split(' ')[0]}`}>
                                {result.seoData?.difficulty || 0}/100
                            </span>
                        </div>
                        <div className="w-full bg-gray-200 rounded-full h-2">
                            <div
                                className={`h-2 rounded-full ${getDifficultyColor(result.seoData?.difficulty || 0).split(' ')[1]}`}
                                style={{ width: `${result.seoData?.difficulty || 0}%` }}
                            />
                        </div>
                    </div>

                    {result.seoData?.opportunity !== undefined && (
                        <div>
                            <div className="flex items-center justify-between mb-2">
                                <span className="text-sm font-medium text-gray-700">オポチュニティスコア</span>
                                <span className={`text-2xl font-bold ${getOpportunityColor(result.seoData?.opportunity || 0).split(' ')[0]}`}>
                                    {result.seoData?.opportunity || 0}/100
                                </span>
                            </div>
                            <div className="w-full bg-gray-200 rounded-full h-2">
                                <div
                                    className={`h-2 rounded-full ${getOpportunityColor(result.seoData?.opportunity || 0).split(' ')[1]}`}
                                    style={{ width: `${result.seoData?.opportunity || 0}%` }}
                                />
                            </div>
                            <p className="text-xs text-gray-500 mt-2">
                                {result.seoData.opportunity > 70 ? '記事作成に最適' :
                                    result.seoData.opportunity > 40 ? '中程度の機会' : '慎重に検討'}
                            </p>
                        </div>
                    )}

                    {result.seoData?.suggestions && result.seoData.suggestions.length > 0 && (
                        <div className="mt-4 pt-4 border-t border-gray-200">
                            <h4 className="text-sm font-medium text-gray-700 mb-2 flex items-center space-x-2">
                                <Lightbulb className="w-4 h-4 text-yellow-500" />
                                <span>最適化の提案</span>
                            </h4>
                            <ul className="space-y-2">
                                {result.seoData.suggestions.slice(0, 3).map((suggestion, index) => (
                                    <li key={index} className="text-sm text-gray-600 flex items-start space-x-2">
                                        <span className="text-blue-600 mt-0.5">•</span>
                                        <span>{suggestion}</span>
                                    </li>
                                ))}
                            </ul>
                        </div>
                    )}
                </div>
            </div>

            {/* 関連キーワード */}
            <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
                <div className="flex items-center space-x-2 mb-4">
                    <Key className="w-5 h-5 text-purple-600" />
                    <h3 className="text-lg font-semibold text-gray-900">関連キーワード</h3>
                </div>

                {result.relatedKeywords && result.relatedKeywords.length > 0 ? (
                    <div className="space-y-4">
                        <div className="flex flex-wrap gap-2">
                            {result.relatedKeywords.slice(0, 10).map((keyword, index) => (
                                <span
                                    key={index}
                                    className="inline-flex items-center px-3 py-1.5 rounded-full text-sm font-medium bg-purple-50 text-purple-700 border border-purple-200"
                                >
                                    {keyword}
                                </span>
                            ))}
                        </div>
                        {result.relatedKeywords.length > 10 && (
                            <p className="text-sm text-gray-500 text-center">
                                他 {result.relatedKeywords.length - 10} 件のキーワード
                            </p>
                        )}
                    </div>
                ) : (
                    <p className="text-sm text-gray-500">関連キーワードが見つかりませんでした</p>
                )}

                {result.hotTopics && result.hotTopics.length > 0 && (
                    <div className="mt-6 pt-6 border-t border-gray-200">
                        <h4 className="text-sm font-medium text-gray-700 mb-3 flex items-center space-x-2">
                            <Lightbulb className="w-4 h-4 text-orange-500" />
                            <span>ホットトピック</span>
                        </h4>
                        <div className="space-y-2">
                            {result.hotTopics.slice(0, 5).map((topic, index) => (
                                <div
                                    key={index}
                                    className="px-3 py-2 bg-orange-50 border border-orange-200 rounded-lg"
                                >
                                    <p className="text-sm font-medium text-orange-900">{topic}</p>
                                </div>
                            ))}
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
};
