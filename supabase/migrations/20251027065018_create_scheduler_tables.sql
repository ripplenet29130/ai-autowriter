/*
  # スケジューラーシステム用テーブル作成

  ## 新規テーブル
  
  ### `wordpress_configs`
  - `id` (uuid, primary key) - 設定ID
  - `name` (text) - 設定名
  - `url` (text) - WordPress URL
  - `username` (text) - WordPressユーザー名
  - `password` (text) - WordPressパスワード（暗号化推奨）
  - `category` (text) - デフォルトカテゴリ
  - `is_active` (boolean) - アクティブフラグ
  - `created_at` (timestamptz) - 作成日時
  - `updated_at` (timestamptz) - 更新日時

  ### `schedule_settings`
  - `id` (uuid, primary key) - スケジュールID
  - `wordpress_config_id` (uuid, foreign key) - WordPress設定ID
  - `is_active` (boolean) - スケジュール有効フラグ
  - `frequency` (text) - 実行頻度（daily, weekly, biweekly, monthly）
  - `time` (text) - 実行時刻（HH:mm形式）
  - `target_keywords` (jsonb) - ターゲットキーワード配列
  - `publish_status` (text) - 投稿ステータス（publish, draft）
  - `created_at` (timestamptz) - 作成日時
  - `updated_at` (timestamptz) - 更新日時

  ### `ai_configs`
  - `id` (uuid, primary key) - AI設定ID
  - `provider` (text) - AIプロバイダー（openai, claude, gemini）
  - `api_key` (text) - APIキー（暗号化推奨）
  - `model` (text) - モデル名
  - `temperature` (decimal) - Temperature設定
  - `max_tokens` (integer) - Max Tokens設定
  - `created_at` (timestamptz) - 作成日時
  - `updated_at` (timestamptz) - 更新日時

  ### `execution_history`
  - `id` (uuid, primary key) - 実行履歴ID
  - `schedule_id` (uuid, foreign key) - スケジュールID
  - `wordpress_config_id` (uuid, foreign key) - WordPress設定ID
  - `executed_at` (timestamptz) - 実行日時
  - `keyword_used` (text) - 使用されたキーワード
  - `article_title` (text) - 生成された記事タイトル
  - `wordpress_post_id` (text) - WordPressの投稿ID
  - `status` (text) - 実行ステータス（success, failed）
  - `error_message` (text) - エラーメッセージ（失敗時）
  - `created_at` (timestamptz) - 作成日時

  ## セキュリティ
  - すべてのテーブルでRLSを有効化
  - 匿名ユーザーでも読み書き可能（シンプルな実装のため）
  - 本番環境では認証を追加推奨
*/

-- WordPress設定テーブル
CREATE TABLE IF NOT EXISTS wordpress_configs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  url text NOT NULL,
  username text NOT NULL,
  password text NOT NULL,
  category text DEFAULT '',
  is_active boolean DEFAULT false,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- スケジュール設定テーブル
CREATE TABLE IF NOT EXISTS schedule_settings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  wordpress_config_id uuid REFERENCES wordpress_configs(id) ON DELETE CASCADE,
  is_active boolean DEFAULT false,
  frequency text DEFAULT 'daily',
  time text DEFAULT '09:00',
  target_keywords jsonb DEFAULT '[]'::jsonb,
  publish_status text DEFAULT 'draft',
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- AI設定テーブル
CREATE TABLE IF NOT EXISTS ai_configs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider text NOT NULL,
  api_key text NOT NULL,
  model text NOT NULL,
  temperature decimal DEFAULT 0.7,
  max_tokens integer DEFAULT 4000,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- 実行履歴テーブル
CREATE TABLE IF NOT EXISTS execution_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  schedule_id uuid REFERENCES schedule_settings(id) ON DELETE CASCADE,
  wordpress_config_id uuid REFERENCES wordpress_configs(id) ON DELETE CASCADE,
  executed_at timestamptz DEFAULT now(),
  keyword_used text,
  article_title text,
  wordpress_post_id text,
  status text DEFAULT 'pending',
  error_message text,
  created_at timestamptz DEFAULT now()
);

-- インデックス作成
CREATE INDEX IF NOT EXISTS idx_schedule_settings_wordpress_config ON schedule_settings(wordpress_config_id);
CREATE INDEX IF NOT EXISTS idx_execution_history_schedule ON execution_history(schedule_id);
CREATE INDEX IF NOT EXISTS idx_execution_history_executed_at ON execution_history(executed_at DESC);

-- RLS有効化
ALTER TABLE wordpress_configs ENABLE ROW LEVEL SECURITY;
ALTER TABLE schedule_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_configs ENABLE ROW LEVEL SECURITY;
ALTER TABLE execution_history ENABLE ROW LEVEL SECURITY;

-- RLSポリシー（全ユーザーがアクセス可能 - シンプルな実装）
CREATE POLICY "Allow all access to wordpress_configs"
  ON wordpress_configs
  FOR ALL
  TO anon
  USING (true)
  WITH CHECK (true);

CREATE POLICY "Allow all access to schedule_settings"
  ON schedule_settings
  FOR ALL
  TO anon
  USING (true)
  WITH CHECK (true);

CREATE POLICY "Allow all access to ai_configs"
  ON ai_configs
  FOR ALL
  TO anon
  USING (true)
  WITH CHECK (true);

CREATE POLICY "Allow all access to execution_history"
  ON execution_history
  FOR ALL
  TO anon
  USING (true)
  WITH CHECK (true);

-- 更新日時の自動更新トリガー
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ language 'plpgsql';

CREATE TRIGGER update_wordpress_configs_updated_at BEFORE UPDATE
  ON wordpress_configs FOR EACH ROW EXECUTE PROCEDURE update_updated_at_column();

CREATE TRIGGER update_schedule_settings_updated_at BEFORE UPDATE
  ON schedule_settings FOR EACH ROW EXECUTE PROCEDURE update_updated_at_column();