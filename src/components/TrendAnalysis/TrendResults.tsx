import React from 'react';
import { TrendingUp, BarChart3, Target, Award } from 'lucide-react';
import { TrendAnalysisResult } from '../../types';

interface TrendResultsProps {
    result: TrendAnalysisResult;
}

/**
 * トレンド分析結果表示コンポーネント
 */
export const TrendResults: React.FC<TrendResultsProps> = ({ result }) => {
    const getCompetitionColor = (competition: string) => {
        switch (competition.toLowerCase()) {
            case 'low': return 'text-green-600 bg-green-50';
            case 'medium': return 'text-yellow-600 bg-yellow-50';
            case 'high': return 'text-red-600 bg-red-50';
            default: return 'text-gray-600 bg-gray-50';
        }
    };

    const getTrendColor = (trend: string) => {
        switch (trend.toLowerCase()) {
            case 'rising': return 'text-green-600 bg-green-50';
            case 'stable': return 'text-blue-600 bg-blue-50';
            case 'declining': return 'text-orange-600 bg-orange-50';
            default: return 'text-gray-600 bg-gray-50';
        }
    };

    const formatNumber = (num: number) => {
        return num.toLocaleString('ja-JP');
    };

    return (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
            {/* トレンドスコア */}
            <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
                <div className="flex items-center justify-between mb-2">
                    <span className="text-sm font-medium text-gray-600">トレンドスコア</span>
                    <TrendingUp className="w-5 h-5 text-purple-600" />
                </div>
                <p className="text-3xl font-bold text-purple-600">{result.trendScore}</p>
                <p className="text-xs text-gray-500 mt-1">100点満点</p>
            </div>

            {/* 検索ボリューム */}
            <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
                <div className="flex items-center justify-between mb-2">
                    <span className="text-sm font-medium text-gray-600">検索ボリューム</span>
                    <BarChart3 className="w-5 h-5 text-blue-600" />
                </div>
                <p className="text-3xl font-bold text-blue-600">
                    {formatNumber(result.searchVolume)}
                </p>
                <p className="text-xs text-gray-500 mt-1">月間検索数</p>
            </div>

            {/* 競合度 */}
            <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
                <div className="flex items-center justify-between mb-2">
                    <span className="text-sm font-medium text-gray-600">競合度</span>
                    <Target className="w-5 h-5 text-orange-600" />
                </div>
                <div className="mt-2">
                    <span className={`inline-flex px-3 py-1 rounded-full text-sm font-medium ${getCompetitionColor(result.competition)}`}>
                        {result.competition === 'low' ? '低' : result.competition === 'medium' ? '中' : '高'}
                    </span>
                </div>
                <p className="text-xs text-gray-500 mt-2">
                    {result.competition === 'low' ? '参入しやすい' :
                        result.competition === 'medium' ? '中程度の競合' : '競合が多い'}
                </p>
            </div>

            {/* トレンド方向 */}
            <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
                <div className="flex items-center justify-between mb-2">
                    <span className="text-sm font-medium text-gray-600">トレンド方向</span>
                    <Award className="w-5 h-5 text-green-600" />
                </div>
                <div className="mt-2">
                    <span className={`inline-flex px-3 py-1 rounded-full text-sm font-medium ${getTrendColor(result.trend || 'stable')}`}>
                        {result.trend === 'rising' ? '上昇中' :
                            result.trend === 'declining' ? '下降中' : '安定'}
                    </span>
                </div>
                <p className="text-xs text-gray-500 mt-2">
                    {result.trend === 'rising' ? '注目度増加中' :
                        result.trend === 'declining' ? '注目度低下中' : '安定的な需要'}
                </p>
            </div>
        </div>
    );
};
