/**
 * アプリケーション全体で使用するメッセージ定数
 */

// 成功メッセージ
export const SUCCESS_MESSAGES = {
    ARTICLE_GENERATED: '記事が正常に生成されました',
    ARTICLE_SAVED: '記事を保存しました',
    ARTICLE_PUBLISHED: '記事をWordPressに投稿しました',
    CONFIG_SAVED: '設定を保存しました',
    CONFIG_DELETED: '設定を削除しました',
    SCHEDULER_STARTED: '自動投稿を開始しました',
    SCHEDULER_STOPPED: '自動投稿を停止しました',
    TEST_COMPLETED: 'テストが完了しました',
    DATA_SYNCED: 'データを同期しました',
    TREND_ANALYSIS_COMPLETED: 'トレンド分析が完了しました',
} as const;

// エラーメッセージ
export const ERROR_MESSAGES = {
    // 一般的なエラー
    UNKNOWN_ERROR: '予期しないエラーが発生しました',
    NETWORK_ERROR: 'ネットワークエラーが発生しました',
    TIMEOUT_ERROR: 'リクエストがタイムアウトしました',

    // 認証エラー
    AUTH_FAILED: '認証に失敗しました',
    PERMISSION_DENIED: 'アクセス権限がありません',

    // 設定エラー
    CONFIG_MISSING: '設定が見つかりません',
    CONFIG_INVALID: '設定が無効です',
    AI_CONFIG_MISSING: 'AI設定を完了してください',
    WORDPRESS_CONFIG_MISSING: 'WordPress設定を追加してください',

    // 記事生成エラー
    GENERATION_FAILED: '記事の生成に失敗しました',
    PUBLISHING_FAILED: '記事の投稿に失敗しました',
    TREND_ANALYSIS_FAILED: 'トレンド分析に失敗しました',

    // データベースエラー
    DB_ERROR: 'データベースエラーが発生しました',
    DB_CONNECTION_FAILED: 'データベースへの接続に失敗しました',
    DB_QUERY_FAILED: 'データベースクエリに失敗しました',

    // バリデーションエラー
    VALIDATION_FAILED: '入力内容に誤りがあります',
    REQUIRED_FIELD: 'この項目は必須です',
    INVALID_FORMAT: '入力形式が正しくありません',
    INVALID_URL: 'URLの形式が正しくありません',

    // スケジューラーエラー
    SCHEDULER_START_FAILED: 'スケジューラーの開始に失敗しました',
    SCHEDULER_STOP_FAILED: 'スケジューラーの停止に失敗しました',
    NO_ACTIVE_SCHEDULE: 'アクティブなスケジュールがありません',
} as const;

// 警告メッセージ
export const WARNING_MESSAGES = {
    UNSAVED_CHANGES: '保存されていない変更があります',
    OVERWRITE_WARNING: '既存のデータが上書きされます',
    DELETE_WARNING: '削除したデータは復元できません',
    BROWSER_SCHEDULER_WARNING: 'ブラウザを閉じるとスケジューラーが停止します',
    API_QUOTA_WARNING: 'API使用制限に近づいています',
} as const;

// 情報メッセージ
export const INFO_MESSAGES = {
    LOADING: '読み込み中...',
    SAVING: '保存中...',
    GENERATING: '生成中...',
    PUBLISHING: '投稿中...',
    ANALYZING: '分析中...',
    PROCESSING: '処理中...',
    INITIALIZING: '初期化中...',
    SYNCING: '同期中...',
} as const;

// 確認メッセージ
export const CONFIRM_MESSAGES = {
    DELETE_ARTICLE: '記事を削除してもよろしいですか？',
    DELETE_CONFIG: '設定を削除してもよろしいですか？',
    STOP_SCHEDULER: 'スケジューラーを停止してもよろしいですか？',
    CLEAR_HISTORY: '実行履歴をクリアしてもよろしいですか？',
    OVERWRITE_DATA: '既存のデータを上書きしてもよろしいですか？',
    MANUAL_TRIGGER: '手動で自動投稿を実行しますか？',
} as const;

// プレースホルダー
export const PLACEHOLDERS = {
    WORDPRESS_URL: 'https://example.com',
    USERNAME: 'ユーザー名',
    PASSWORD: 'パスワード',
    API_KEY: 'APIキーを入力',
    KEYWORD: 'キーワードを入力',
    TITLE: 'タイトル',
    CONTENT: '内容を入力してください',
    CATEGORY: 'カテゴリ',
    SEARCH: '検索...',
} as const;

// ラベル
export const LABELS = {
    REQUIRED: '必須',
    OPTIONAL: '任意',
    RECOMMENDED: '推奨',
    ACTIVE: 'アクティブ',
    INACTIVE: '非アクティブ',
    ENABLED: '有効',
    DISABLED: '無効',
    PUBLIC: '公開',
    DRAFT: '下書き',
    SCHEDULED: '予約済み',
    PUBLISHED: '公開済み',
    FAILED: '失敗',
} as const;

// ボタンテキスト
export const BUTTON_TEXT = {
    SAVE: '保存',
    CANCEL: 'キャンセル',
    DELETE: '削除',
    EDIT: '編集',
    CREATE: '作成',
    GENERATE: '生成',
    PUBLISH: '投稿',
    START: '開始',
    STOP: '停止',
    TEST: 'テスト',
    REFRESH: '更新',
    RESET: 'リセット',
    CONFIRM: '確認',
    CLOSE: '閉じる',
    BACK: '戻る',
    NEXT: '次へ',
    SUBMIT: '送信',
    APPLY: '適用',
} as const;

// ヘルプテキスト
export const HELP_TEXT = {
    WORDPRESS_URL: 'WordPressサイトのURL（例: https://example.com）',
    APPLICATION_PASSWORD: 'WordPressの管理画面から生成したアプリケーションパスワード',
    API_KEY: 'AIプロバイダーから取得したAPIキー',
    SCHEDULE_TIME: '記事を投稿する時刻（24時間形式）',
    KEYWORDS: '記事生成に使用するキーワード（カンマ区切り）',
    TONE: '記事のトーン・文体',
    LENGTH: '記事の長さ',
} as const;

/**
 * メッセージ取得のヘルパー関数
 */
export function getMessage(
    category: 'success' | 'error' | 'warning' | 'info' | 'confirm',
    key: string
): string {
    const messages = {
        success: SUCCESS_MESSAGES,
        error: ERROR_MESSAGES,
        warning: WARNING_MESSAGES,
        info: INFO_MESSAGES,
        confirm: CONFIRM_MESSAGES,
    };

    const message = (messages[category] as any)[key];
    return message || ERROR_MESSAGES.UNKNOWN_ERROR;
}
