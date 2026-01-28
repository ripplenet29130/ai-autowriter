// エラー型定義

/**
 * アプリケーション全体で使用するベースエラークラス
 */
export class AppError extends Error {
    constructor(
        message: string,
        public code: string,
        public statusCode: number = 500
    ) {
        super(message);
        this.name = 'AppError';
        Object.setPrototypeOf(this, AppError.prototype);
    }
}

/**
 * API関連のエラー
 */
export class APIError extends AppError {
    constructor(message: string, statusCode: number = 500) {
        super(message, 'API_ERROR', statusCode);
        this.name = 'APIError';
    }
}

/**
 * バリデーションエラー
 */
export class ValidationError extends AppError {
    constructor(message: string, public field?: string) {
        super(message, 'VALIDATION_ERROR', 400);
        this.name = 'ValidationError';
    }
}

/**
 * 認証エラー
 */
export class AuthenticationError extends AppError {
    constructor(message: string = '認証に失敗しました') {
        super(message, 'AUTHENTICATION_ERROR', 401);
        this.name = 'AuthenticationError';
    }
}

/**
 * 認可エラー
 */
export class AuthorizationError extends AppError {
    constructor(message: string = 'アクセス権限がありません') {
        super(message, 'AUTHORIZATION_ERROR', 403);
        this.name = 'AuthorizationError';
    }
}

/**
 * リソースが見つからないエラー
 */
export class NotFoundError extends AppError {
    constructor(resource: string) {
        super(`${resource}が見つかりません`, 'NOT_FOUND_ERROR', 404);
        this.name = 'NotFoundError';
    }
}

/**
 * データベースエラー
 */
export class DatabaseError extends AppError {
    constructor(message: string, public originalError?: Error) {
        super(message, 'DATABASE_ERROR', 500);
        this.name = 'DatabaseError';
    }
}

/**
 * ネットワークエラー
 */
export class NetworkError extends AppError {
    constructor(message: string = 'ネットワークエラーが発生しました') {
        super(message, 'NETWORK_ERROR', 503);
        this.name = 'NetworkError';
    }
}

/**
 * タイムアウトエラー
 */
export class TimeoutError extends AppError {
    constructor(message: string = 'リクエストがタイムアウトしました') {
        super(message, 'TIMEOUT_ERROR', 504);
        this.name = 'TimeoutError';
    }
}

/**
 * エラー型ガード - AppErrorかどうかを判定
 */
export function isAppError(error: unknown): error is AppError {
    return error instanceof AppError;
}

/**
 * エラー型ガード - APIErrorかどうかを判定
 */
export function isAPIError(error: unknown): error is APIError {
    return error instanceof APIError;
}

/**
 * エラー型ガード - ValidationErrorかどうかを判定
 */
export function isValidationError(error: unknown): error is ValidationError {
    return error instanceof ValidationError;
}

/**
 * エラーハンドリングヘルパー関数
 * @param error - 処理するエラー
 * @returns ユーザーフレンドリーなエラーメッセージ
 */
export function getErrorMessage(error: unknown): string {
    if (isAppError(error)) {
        return error.message;
    }

    if (error instanceof Error) {
        return error.message;
    }

    if (typeof error === 'string') {
        return error;
    }

    return '予期しないエラーが発生しました';
}

/**
 * エラーをログに記録する
 * @param error - ログに記録するエラー
 * @param context - エラーが発生したコンテキスト
 */
export function logError(error: unknown, context?: string): void {
    const message = context ? `[${context}] ${getErrorMessage(error)}` : getErrorMessage(error);

    if (isAppError(error)) {
        console.error(`${error.code}: ${message}`, error);
    } else {
        console.error(message, error);
    }
}
