import { useState, useCallback } from 'react';
import { v4 as uuidv4 } from 'uuid';
import { Article, ArticleTopic } from '../types';
import { aiService } from '../services/aiService';
import toast from 'react-hot-toast';
import { logger } from '../utils/logger';
import { handleError } from '../utils/errorHandler';

const genLogger = logger.createLogger('ArticleGeneration');

interface GenerationOptions {
    topic?: ArticleTopic;
    keywords: string[];
    tone?: 'professional' | 'casual' | 'technical' | 'friendly';
    length?: 'short' | 'medium' | 'long';
    customInstructions?: string;
    targetWordCount?: number;
}

/**
 * 記事生成のカスタムフック
 */
export function useArticleGeneration() {
    const [isGenerating, setIsGenerating] = useState(false);
    const [generatedArticle, setGeneratedArticle] = useState<Article | null>(null);

    /**
     * 記事を生成
     */
    const generateArticle = useCallback(async (options: GenerationOptions): Promise<Article | null> => {
        setIsGenerating(true);
        genLogger.info('記事生成開始', options);

        try {
            toast.loading('記事を生成中...', { duration: 3000 });

            const article = await aiService.generateArticle({
                topic: options.topic?.name || options.keywords[0],
                keywords: options.keywords,
                tone: options.tone || 'professional',
                length: options.length || 'medium',
                includeIntroduction: true,
                includeConclusion: true,
                includeSources: false,
                customInstructions: options.customInstructions,
                targetWordCount: options.targetWordCount
            });

            if (article) {
                const fullArticle: Article = {
                    id: uuidv4(),
                    ...article,
                    category: '',
                    status: 'draft',
                    createdAt: new Date().toISOString(),
                    updatedAt: new Date().toISOString(),
                    generatedAt: new Date().toISOString(),
                    wordCount: article.content.length,
                    trendData: undefined
                };
                setGeneratedArticle(fullArticle);
                toast.success('記事が生成されました');
                genLogger.info('記事生成完了', { id: fullArticle.id });
                return fullArticle;
            } else {
                toast.error('記事の生成に失敗しました');
                genLogger.warn('記事生成失敗: nullが返された');
                return null;
            }
        } catch (error) {
            handleError(error, 'ArticleGeneration');
            toast.error('記事生成中にエラーが発生しました');
            return null;
        } finally {
            setIsGenerating(false);
        }
    }, []);

    /**
     * 生成された記事をクリア
     */
    const clearArticle = useCallback(() => {
        setGeneratedArticle(null);
        genLogger.debug('生成記事をクリア');
    }, []);

    return {
        isGenerating,
        generatedArticle,
        generateArticle,
        clearArticle,
        setGeneratedArticle,
    };
}
