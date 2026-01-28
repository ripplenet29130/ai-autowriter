/**
 * ログレベル定義
 */
export enum LogLevel {
    DEBUG = 'DEBUG',
    INFO = 'INFO',
    WARN = 'WARN',
    ERROR = 'ERROR',
}

/**
 * ログ設定
 */
interface LoggerConfig {
    level: LogLevel;
    prefix?: string;
    enableTimestamp?: boolean;
    enableColors?: boolean;
}

/**
 * ログ出力を管理するクラス
 */
class Logger {
    private static instance: Logger;
    private config: LoggerConfig;
    private isDevelopment: boolean;

    private constructor() {
        this.isDevelopment = import.meta.env.MODE === 'development';
        this.config = {
            level: this.isDevelopment ? LogLevel.DEBUG : LogLevel.INFO,
            enableTimestamp: true,
            enableColors: true,
        };
    }

    static getInstance(): Logger {
        if (!Logger.instance) {
            Logger.instance = new Logger();
        }
        return Logger.instance;
    }

    /**
     * ログ設定を更新
     */
    configure(config: Partial<LoggerConfig>): void {
        this.config = { ...this.config, ...config };
    }

    /**
     * ログレベルの比較
     */
    private shouldLog(level: LogLevel): boolean {
        const levels = [LogLevel.DEBUG, LogLevel.INFO, LogLevel.WARN, LogLevel.ERROR];
        const currentLevelIndex = levels.indexOf(this.config.level);
        const targetLevelIndex = levels.indexOf(level);
        return targetLevelIndex >= currentLevelIndex;
    }

    /**
     * タイムスタンプを生成
     */
    private getTimestamp(): string {
        if (!this.config.enableTimestamp) return '';
        const now = new Date();
        return `[${now.toLocaleTimeString('ja-JP')}]`;
    }

    /**
     * ログメッセージをフォーマット
     */
    private formatMessage(level: LogLevel, message: string, prefix?: string): string {
        const parts: string[] = [];

        if (this.config.enableTimestamp) {
            parts.push(this.getTimestamp());
        }

        parts.push(`[${level}]`);

        if (prefix || this.config.prefix) {
            parts.push(`[${prefix || this.config.prefix}]`);
        }

        parts.push(message);

        return parts.join(' ');
    }

    /**
     * カラー付きログ出力（開発環境のみ）
     */
    private getColoredOutput(level: LogLevel, message: string): string {
        if (!this.isDevelopment || !this.config.enableColors) {
            return message;
        }

        const colors: Record<LogLevel, string> = {
            [LogLevel.DEBUG]: '\x1b[36m', // Cyan
            [LogLevel.INFO]: '\x1b[32m',  // Green
            [LogLevel.WARN]: '\x1b[33m',  // Yellow
            [LogLevel.ERROR]: '\x1b[31m', // Red
        };

        const reset = '\x1b[0m';
        return `${colors[level]}${message}${reset}`;
    }

    /**
     * DEBUGレベルのログ
     */
    debug(message: string, ...args: any[]): void {
        if (!this.shouldLog(LogLevel.DEBUG)) return;
        const formattedMessage = this.formatMessage(LogLevel.DEBUG, message);
        console.log(this.getColoredOutput(LogLevel.DEBUG, formattedMessage), ...args);
    }

    /**
     * INFOレベルのログ
     */
    info(message: string, ...args: any[]): void {
        if (!this.shouldLog(LogLevel.INFO)) return;
        const formattedMessage = this.formatMessage(LogLevel.INFO, message);
        console.log(this.getColoredOutput(LogLevel.INFO, formattedMessage), ...args);
    }

    /**
     * WARNレベルのログ
     */
    warn(message: string, ...args: any[]): void {
        if (!this.shouldLog(LogLevel.WARN)) return;
        const formattedMessage = this.formatMessage(LogLevel.WARN, message);
        console.warn(this.getColoredOutput(LogLevel.WARN, formattedMessage), ...args);
    }

    /**
     * ERRORレベルのログ
     */
    error(message: string, error?: Error | unknown, ...args: any[]): void {
        if (!this.shouldLog(LogLevel.ERROR)) return;
        const formattedMessage = this.formatMessage(LogLevel.ERROR, message);
        console.error(this.getColoredOutput(LogLevel.ERROR, formattedMessage), error, ...args);
    }

    /**
     * プレフィックス付きロガーを作成
     */
    createLogger(prefix: string): PrefixedLogger {
        return new PrefixedLogger(this, prefix);
    }
}

/**
 * プレフィックス付きロガー
 */
class PrefixedLogger {
    constructor(private logger: Logger, private prefix: string) { }

    debug(message: string, ...args: any[]): void {
        this.logger.debug(`[${this.prefix}] ${message}`, ...args);
    }

    info(message: string, ...args: any[]): void {
        this.logger.info(`[${this.prefix}] ${message}`, ...args);
    }

    warn(message: string, ...args: any[]): void {
        this.logger.warn(`[${this.prefix}] ${message}`, ...args);
    }

    error(message: string, error?: Error | unknown, ...args: any[]): void {
        this.logger.error(`[${this.prefix}] ${message}`, error, ...args);
    }
}

// シングルトンインスタンスをエクスポート
export const logger = Logger.getInstance();

// 便利な関数をエクスポート
export const createLogger = (prefix: string) => logger.createLogger(prefix);
