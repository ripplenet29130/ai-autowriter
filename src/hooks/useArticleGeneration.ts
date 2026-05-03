import { useState, useCallback } from 'react';
import { v4 as uuidv4 } from 'uuid';
import { Article, ArticleGoal, ArticleStructureType, ArticleTopic } from '../types';
import { multiStepGenerationService } from '../services/multiStepGenerationService';
import toast from 'react-hot-toast';
import { logger } from '../utils/logger';
import { handleError } from '../utils/errorHandler';

const genLogger = logger.createLogger('ArticleGeneration');

interface GenerationOptions {
  topic?: ArticleTopic;
  keywords: string[];
  tone?: 'professional' | 'casual' | 'technical' | 'friendly';
  length?: 'short' | 'medium' | 'long';
  articleGoal?: ArticleGoal;
  articleStructureType?: ArticleStructureType;
  customInstructions?: string;
  targetWordCount?: number;
  imagesPerArticle?: number;
}

export function useArticleGeneration() {
  const [isGenerating, setIsGenerating] = useState(false);
  const [generatedArticle, setGeneratedArticle] = useState<Article | null>(null);

  const generateArticle = useCallback(async (options: GenerationOptions): Promise<Article | null> => {
    setIsGenerating(true);
    genLogger.info('Article generation started', options);

    try {
      toast.loading('險倅ｺ九ｒ逕滓・荳ｭ...', { duration: 3000 });

      const article = await multiStepGenerationService.generateArticleAuto(options.keywords, {
        targetLength: options.length || 'medium',
        tone: options.tone || 'professional',
        targetWordCount: options.targetWordCount,
        articleStructureType: options.articleStructureType,
        customInstructions: options.customInstructions,
        imagesPerArticle: options.imagesPerArticle,
      });

      const articleWithTopic = {
        ...article,
        trendData: article.trendData,
        title: article.title || options.topic?.name || options.keywords[0],
      };

      const fullArticle: Article = {
        ...articleWithTopic,
        id: articleWithTopic.id || uuidv4(),
        category: articleWithTopic.category || '',
        status: articleWithTopic.status || 'draft',
        tone: articleWithTopic.tone || options.tone || 'professional',
        length: articleWithTopic.length || options.length || 'medium',
        articleGoal: articleWithTopic.articleGoal || options.articleGoal || 'standard',
        articleStructureType: articleWithTopic.articleStructureType || options.articleStructureType || 'standard',
        targetWordCount: articleWithTopic.targetWordCount || options.targetWordCount,
        createdAt: articleWithTopic.createdAt || new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        generatedAt: new Date().toISOString(),
        wordCount: articleWithTopic.content?.length || 0,
      };

      setGeneratedArticle(fullArticle);
      toast.success('險倅ｺ九ｒ逕滓・縺励∪縺励◆');
      genLogger.info('Article generation completed', { id: fullArticle.id });
      return fullArticle;
    } catch (error) {
      handleError(error, 'ArticleGeneration');
      const errorMessage = error instanceof Error
        ? error.message.replace(/^(RATE_LIMIT_ERROR|AUTH_ERROR):\s*/, '')
        : '記事生成中にエラーが発生しました';
      toast.error(errorMessage);
      return null;
    } finally {
      setIsGenerating(false);
    }
  }, []);

  const clearArticle = useCallback(() => {
    setGeneratedArticle(null);
    genLogger.debug('Generated article cleared');
  }, []);

  return {
    isGenerating,
    generatedArticle,
    generateArticle,
    clearArticle,
    setGeneratedArticle,
  };
}

