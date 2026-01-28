import { useState } from 'react';
import { hybridTrendAnalysisService } from '../services/hybridTrendAnalysisService';
import { TrendAnalysisResult } from '../types';
import toast from 'react-hot-toast';
import { logger } from '../utils/logger';
import { handleError } from '../utils/errorHandler';

const trendLogger = logger.createLogger('TrendAnalysis');

/**
 * トレンド分析のカスタムフック
 */
export function useTrendAnalysis() {
    const [keyword, setKeyword] = useState('');
    const [isAnalyzing, setIsAnalyzing] = useState(false);
    const [analysisResult, setAnalysisResult] = useState<TrendAnalysisResult | null>(null);

    /**
     * トレンド分析を実行
     */
    const analyzeKeyword = async (searchKeyword?: string) => {
        const targetKeyword = searchKeyword || keyword;

        if (!targetKeyword.trim()) {
            toast.error('キーワードを入力してください');
            return;
        }

        setIsAnalyzing(true);
        trendLogger.info(`トレンド分析開始: ${targetKeyword}`);

        try {
            const result = await hybridTrendAnalysisService.analyzeTrends(targetKeyword);

            if (result) {
                setAnalysisResult(result);
                toast.success('トレンド分析が完了しました');
                trendLogger.info(`トレンド分析完了: スコア ${result.trendScore}`);
            } else {
                toast.error('トレンド分析に失敗しました');
                trendLogger.warn('トレンド分析結果がnull');
            }
        } catch (error) {
            handleError(error, 'TrendAnalysis');
            toast.error('トレンド分析中にエラーが発生しました');
        } finally {
            setIsAnalyzing(false);
        }
    };

    /**
     * 分析結果をクリア
     */
    const clearResults = () => {
        setAnalysisResult(null);
        trendLogger.debug('分析結果をクリア');
    };

    /**
     * キーワードを設定
     */
    const updateKeyword = (newKeyword: string) => {
        setKeyword(newKeyword);
    };

    return {
        keyword,
        isAnalyzing,
        analysisResult,
        analyzeKeyword,
        clearResults,
        updateKeyword,
    };
}
