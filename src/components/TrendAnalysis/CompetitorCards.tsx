import React from 'react';
import { FileText, Eye, BarChart3 } from 'lucide-react';
import { CompetitorArticle } from '../../types';

interface CompetitorCardsProps {
    competitors: CompetitorArticle[];
    averageLength: number;
}

/**
 * 競合記事カード表示コンポーネント
 */
export const CompetitorCards: React.FC<CompetitorCardsProps> = ({
    competitors,
    averageLength,
}) => {
    if (competitors.length === 0) {
        return null;
    }

    return (
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
            <div className="flex items-center justify-between mb-6">
                <h3 className="text-lg font-semibold text-gray-900">競合記事分析</h3>
                <div className="flex items-center space-x-2 text-sm text-gray-600">
                    <BarChart3 className="w-4 h-4" />
                    <span>平均文字数: {averageLength.toLocaleString('ja-JP')}文字</span>
                </div>
            </div>

            <div className="space-y-4">
                {competitors.slice(0, 5).map((article, index) => (
                    <div
                        key={index}
                        className="border border-gray-200 rounded-lg p-4 hover:border-blue-300 transition-colors"
                    >
                        <div className="flex items-start justify-between">
                            <div className="flex-1">
                                <h4 className="font-medium text-gray-900 mb-2 line-clamp-2">
                                    {article.title}
                                </h4>
                                <div className="flex items-center space-x-4 text-sm text-gray-600">
                                    <span className="flex items-center space-x-1">
                                        <FileText className="w-4 h-4" />
                                        <span>{article.wordCount.toLocaleString('ja-JP')}文字</span>
                                    </span>
                                    <span className="text-blue-600 hover:underline truncate">
                                        {article.domain}
                                    </span>
                                </div>
                                {article.metaDescription && (
                                    <p className="text-xs text-gray-500 mt-2 line-clamp-2">
                                        {article.metaDescription}
                                    </p>
                                )}
                            </div>
                            <a
                                href={article.url}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="ml-4 p-2 text-blue-600 hover:bg-blue-50 rounded-lg transition-colors"
                                title="記事を開く"
                            >
                                <Eye className="w-5 h-5" />
                            </a>
                        </div>
                    </div>
                ))}
            </div>

            {competitors.length > 5 && (
                <p className="text-sm text-gray-500 mt-4 text-center">
                    他 {competitors.length - 5} 件の競合記事
                </p>
            )}
        </div>
    );
};
