import { TrendAnalysisResult, Article, WordPressConfig } from './index';

/**
 * 型ガード: TrendAnalysisResultかどうかを判定
 */
export function isTrendAnalysisResult(value: unknown): value is TrendAnalysisResult {
    if (typeof value !== 'object' || value === null) {
        return false;
    }

    const result = value as Partial<TrendAnalysisResult>;

    return (
        typeof result.keyword === 'string' &&
        typeof result.trendScore === 'number' &&
        typeof result.searchVolume === 'number' &&
        (result.competition === 'low' || result.competition === 'medium' || result.competition === 'high') &&
        Array.isArray(result.relatedKeywords) &&
        Array.isArray(result.hotTopics)
    );
}

/**
 * 型ガード: Articleかどうかを判定
 */
export function isArticle(value: unknown): value is Article {
    if (typeof value !== 'object' || value === null) {
        return false;
    }

    const article = value as Partial<Article>;

    return (
        typeof article.id === 'string' &&
        typeof article.title === 'string' &&
        typeof article.content === 'string' &&
        Array.isArray(article.keywords) &&
        typeof article.category === 'string' &&
        (article.status === 'draft' ||
            article.status === 'scheduled' ||
            article.status === 'published' ||
            article.status === 'failed')
    );
}

/**
 * 型ガード: WordPressConfigかどうかを判定
 */
export function isWordPressConfig(value: unknown): value is WordPressConfig {
    if (typeof value !== 'object' || value === null) {
        return false;
    }

    const config = value as Partial<WordPressConfig>;

    return (
        typeof config.id === 'string' &&
        typeof config.name === 'string' &&
        typeof config.url === 'string' &&
        typeof config.username === 'string' &&
        typeof config.applicationPassword === 'string' &&
        typeof config.isActive === 'boolean'
    );
}

/**
 * 型ガード: 配列が文字列の配列かどうかを判定
 */
export function isStringArray(value: unknown): value is string[] {
    return Array.isArray(value) && value.every(item => typeof item === 'string');
}

/**
 * 型ガード: 配列がArticleの配列かどうかを判定
 */
export function isArticleArray(value: unknown): value is Article[] {
    return Array.isArray(value) && value.every(isArticle);
}

/**
 * 型ガード: Recordオブジェクトかどうかを判定
 */
export function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * アサーション: 値がnullまたはundefinedでないことを保証
 */
export function assertNonNull<T>(value: T | null | undefined, message?: string): asserts value is T {
    if (value === null || value === undefined) {
        throw new Error(message || 'Value is null or undefined');
    }
}

/**
 * アサーション: 値が文字列であることを保証
 */
export function assertString(value: unknown, message?: string): asserts value is string {
    if (typeof value !== 'string') {
        throw new Error(message || 'Value is not a string');
    }
}

/**
 * アサーション: 値が数値であることを保証
 */
export function assertNumber(value: unknown, message?: string): asserts value is number {
    if (typeof value !== 'number' || isNaN(value)) {
        throw new Error(message || 'Value is not a number');
    }
}
