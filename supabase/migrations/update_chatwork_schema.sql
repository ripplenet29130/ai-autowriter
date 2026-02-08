-- 1. アプリケーション全体の設定を保存するテーブルを作成
-- (APIキーなどをサーバー側から安全に参照するため)
CREATE TABLE IF NOT EXISTS app_settings (
  key TEXT PRIMARY KEY,
  value TEXT,
  description TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- RLS (Row Level Security) の設定
ALTER TABLE app_settings ENABLE ROW LEVEL SECURITY;

-- 全員が参照可能（ただしAPIキーなどはEdge Functionからしか見ない前提で、クライアント側では用途を制限）
-- 今回はシンプルに authenticated (ログインユーザー) には読み書き許可
CREATE POLICY "Allow authenticated access" ON app_settings
  FOR ALL
  TO authenticated
  USING (true)
  WITH CHECK (true);

-- 2. スケジュールテーブルにテンプレート用のカラムを追加
ALTER TABLE schedule_settings 
ADD COLUMN IF NOT EXISTS chatwork_message_template TEXT DEFAULT '';

-- コメント追加
COMMENT ON TABLE app_settings IS 'アプリケーション全体のグローバル設定（APIキーなど）';
COMMENT ON COLUMN schedule_settings.chatwork_message_template IS 'Chatwork通知時のカスタムメッセージテンプレート';
