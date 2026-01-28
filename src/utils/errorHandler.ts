import { AppError, getErrorMessage, logError } from '../types/errors';
import { logger } from './logger';

/**
 * エラーハンドリングのオプション
 */
interface ErrorHandlerOptions {
    context?: string;
    showToast?: boolean;
    rethrow?: boolean;
    logToConsole?: boolean;
}

/**
 * グローバルエラーハンドラー
 */
export class ErrorHandler {
    private static instance: ErrorHandler;

    private constructor() {
        this.setupGlobalHandlers();
    }

    static getInstance(): ErrorHandler {
        if (!ErrorHandler.instance) {
            ErrorHandler.instance = new ErrorHandler();
        }
        return ErrorHandler.instance;
    }

    /**
     * グローバルエラーハンドラーをセットアップ
     */
    private setupGlobalHandlers(): void {
        // Promise未処理エラーのハンドリング
        window.addEventListener('unhandledrejection', (event) => {
            logger.error('Unhandled Promise Rejection:', event.reason);
            event.preventDefault();
        });

        // 通常の未処理エラーのハンドリング
        window.addEventListener('error', (event) => {
            logger.error('Unhandled Error:', event.error);
            event.preventDefault();
        });
    }

    /**
     * エラーを処理
     */
    handle(error: unknown, options: ErrorHandlerOptions = {}): void {
        const {
            context = 'Unknown',
            showToast = true,
            rethrow = false,
            logToConsole = true,
        } = options;

        const message = getErrorMessage(error);

        if (logToConsole) {
            logError(error, context);
        }

        if (showToast && typeof window !== 'undefined') {
            // toast通知（実際の実装ではreact-hot-toastを使用）
            try {
                const toast = (window as any).toast;
                if (toast) {
                    toast.error(message);
                }
            } catch (toastError) {
                logger.warn('Toast notification failed', toastError);
            }
        }

        if (rethrow) {
            throw error;
        }
    }

    /**
     * 非同期関数をラップしてエラーハンドリングを追加
     */
    async wrap<T>(
        fn: () => Promise<T>,
        options: ErrorHandlerOptions = {}
    ): Promise<T | null> {
        try {
            return await fn();
        } catch (error) {
            this.handle(error, options);
            return null;
        }
    }

    /**
     * 同期関数をラップしてエラーハンドリングを追加
     */
    wrapSync<T>(
        fn: () => T,
        options: ErrorHandlerOptions = {}
    ): T | null {
        try {
            return fn();
        } catch (error) {
            this.handle(error, options);
            return null;
        }
    }
}

// シングルトンインスタンスをエクスポート
export const errorHandler = ErrorHandler.getInstance();

/**
 * 便利なヘルパー関数
 */

/**
 * エラーを安全に処理する
 */
export function handleError(error: unknown, context?: string): void {
    errorHandler.handle(error, { context });
}

/**
 * 非同期関数を安全に実行
 */
export async function safeAsync<T>(
    fn: () => Promise<T>,
    context?: string
): Promise<T | null> {
    return errorHandler.wrap(fn, { context, logToConsole: true });
}

/**
 * 同期関数を安全に実行
 */
export function safeSync<T>(
    fn: () => T,
    context?: string
): T | null {
    return errorHandler.wrapSync(fn, { context, logToConsole: true });
}

/**
 * try-catchブロックのヘルパー
 */
export async function tryCatch<T>(
    fn: () => Promise<T>,
    onError?: (error: unknown) => void
): Promise<T | null> {
    try {
        return await fn();
    } catch (error) {
        if (onError) {
            onError(error);
        } else {
            errorHandler.handle(error);
        }
        return null;
    }
}
