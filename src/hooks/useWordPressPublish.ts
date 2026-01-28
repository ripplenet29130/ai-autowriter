import { useState, useCallback } from 'react';
import { WordPressConfig, Article } from '../types';
import { WordPressService } from '../services/wordPressService';
import { useAppStore } from '../store/useAppStore';
import toast from 'react-hot-toast';
import { logger } from '../utils/logger';
import { handleError } from '../utils/errorHandler';

const publishLogger = logger.createLogger('WordPressPublish');

/**
 * WordPress投稿のカスタムフック
 */
export function useWordPressPublish() {
    const { wordPressConfigs, updateArticle } = useAppStore();
    const [isPublishing, setIsPublishing] = useState(false);

    /**
     * WordPressに記事を投稿
     */
    const publishToWordPress = useCallback(async (
        article: Article,
        configId: string,
        category?: string,
        status: 'publish' | 'draft' | 'future' = 'publish',
        publishDate?: Date
    ): Promise<boolean> => {
        const config = wordPressConfigs.find(c => c.id === configId);

        if (!config) {
            toast.error('WordPress設定が見つかりません');
            publishLogger.error(`設定が見つかりません: ${configId}`);
            return false;
        }

        setIsPublishing(true);
        publishLogger.info(`投稿開始: ${article.title}`, { config: config.name });

        try {
            toast.loading('WordPressに投稿中...', { duration: 3000 });

            const service = new WordPressService(config);
            const result = await service.publishArticle(article, status, publishDate);

            if (result.success && result.wordPressId) {
                // 記事情報を更新
                const newStatus = status === 'future' ? 'scheduled' : status === 'publish' ? 'published' : 'draft';
                const now = new Date().toISOString();

                updateArticle(article.id, {
                    status: newStatus,
                    publishedAt: status === 'publish' ? now : undefined,
                    scheduledAt: status === 'future' && publishDate ? publishDate.toISOString() : undefined,
                    wordPressPostId: result.wordPressId.toString(),
                    wordPressConfigId: configId,
                    wordPressUrl: result.url,
                    isPublished: status === 'publish',
                });

                toast.success('記事を投稿しました');
                publishLogger.info(`投稿成功: ${article.title}`, { wordPressId: result.wordPressId });
                return true;
            } else {
                toast.error(result.error || '投稿に失敗しました');
                publishLogger.error(`投稿失敗: ${result.error}`);

                return false;
            }
        } catch (error) {
            handleError(error, 'WordPressPublish');
            toast.error('投稿中にエラーが発生しました');

            updateArticle(article.id, { status: 'failed' });
            return false;
        } finally {
            setIsPublishing(false);
        }
    }, [wordPressConfigs, updateArticle]);

    return {
        isPublishing,
        publishToWordPress,
    };
}
