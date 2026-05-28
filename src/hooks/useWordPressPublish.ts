import { useState, useCallback } from 'react';
import { WordPressConfig, Article } from '../types';
import { WordPressService } from '../services/wordPressService';
import { useAppStore } from '../store/useAppStore';
import toast from 'react-hot-toast';
import { logger } from '../utils/logger';
import { handleError } from '../utils/errorHandler';

const publishLogger = logger.createLogger('WordPressPublish');
const BASE64_IMAGE_MARKDOWN_REGEX = /!\[([^\]]*)\]\(data:image\/([^;]+);base64,([^)]+)\)/g;

function stripBase64ImagesFromContent(content: string): string {
    if (!content) return content;
    return content.replace(
        BASE64_IMAGE_MARKDOWN_REGEX,
        '\n\n> [画像はアップロード失敗のため本文から除去されました]\n\n'
    );
}

/**
 * 記事内のBase64画像をWordPressにアップロードしてURLに置換
 */
async function processImagesBeforePublish(
    article: Article,
    wpService: WordPressService
): Promise<Article> {
    const base64ImageRegex = BASE64_IMAGE_MARKDOWN_REGEX;
    let processedContent = article.content;
    let imageIndex = 1;
    let failedUploads = 0;

    const matches = [...article.content.matchAll(base64ImageRegex)];

    for (const match of matches) {
        const [fullMatch, altText, imageType, base64Data] = match;
        const filename = `ai-generated-image-${Date.now()}-${imageIndex}.${imageType}`;

        try {
            // WordPressにアップロード
            const uploadResult = await wpService.uploadImageToWordPress(
                base64Data,
                `image/${imageType}`,
                filename
            );

            if (uploadResult.success && uploadResult.url) {
                // Base64 URLをWordPress URLに置換
                processedContent = processedContent.replace(
                    fullMatch,
                    `![${altText}](${uploadResult.url})`
                );
                console.log(`画像をアップロードして置換しました: ${filename} -> ${uploadResult.url}`);
            } else {
                console.warn(`画像アップロードに失敗しました: ${filename}`, uploadResult.error);
                failedUploads++;
            }
        } catch (error) {
            console.error(`画像処理エラー: ${filename}`, error);
            failedUploads++;
        }

        imageIndex++;
    }

    // Base64画像が残ったまま投稿するとWordPress編集画面が重くなり開けなくなるため中止する
    if (failedUploads > 0 || /data:image\/[^;]+;base64,/i.test(processedContent)) {
        throw new Error(`画像のアップロードに失敗しました（${failedUploads}件）。Base64画像が本文に残るため投稿を中止しました。`);
    }

    return {
        ...article,
        content: processedContent
    };
}

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
    ): Promise<Article | boolean> => {
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

            // 記事内のBase64画像をWordPressにアップロードしてURLに置換
            const articleForPublish = category
                ? { ...article, category }
                : article;

            const processedArticle = await processImagesBeforePublish(articleForPublish, service);

            const result = await service.publishArticle(processedArticle, status, publishDate);

            if (result.success && result.wordPressId) {
                // 記事情報を更新（Base64をURLに置換したコンテンツを保存）
                const newStatus = status === 'future' ? 'scheduled' : status === 'publish' ? 'published' : 'draft';
                const now = new Date().toISOString();

                updateArticle(article.id, {
                    status: newStatus,
                    content: processedArticle.content, // ここで置換後のコンテンツを保存
                    publishedAt: status === 'publish' ? now : undefined,
                    scheduledAt: status === 'future' && publishDate ? publishDate.toISOString() : undefined,
                    wordPressPostId: result.wordPressId.toString(),
                    wordPressConfigId: configId,
                    wordPressUrl: result.url,
                    isPublished: status === 'publish',
                });

                toast.success('記事を投稿しました');
                publishLogger.info(`投稿成功: ${article.title}`, { wordPressId: result.wordPressId });
                return processedArticle; // 処理後の記事を返す
            } else {
                toast.error(result.error || '投稿に失敗しました');
                publishLogger.error(`投稿失敗: ${result.error}`);

                return false;
            }
        } catch (error) {
            handleError(error, 'WordPressPublish');
            const message = error instanceof Error ? error.message : '投稿中にエラーが発生しました';
            toast.error(message);

            const sanitizedContent = stripBase64ImagesFromContent(article.content);
            updateArticle(article.id, { status: 'failed', content: sanitizedContent });
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
