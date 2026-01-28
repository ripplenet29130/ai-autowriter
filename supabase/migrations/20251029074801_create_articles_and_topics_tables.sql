/*
  # AI記事生成システムのデータ保存機能

  ## 概要
  AI記事生成で作成された記事、カスタムトピック、生成プロンプトを永続化するためのテーブルを作成します。

  ## 新規テーブル

  ### 1. articles（記事テーブル）
  生成された記事を保存・管理します。
  
  **カラム:**
  - `id` (uuid, primary key) - 記事ID
  - `title` (text, required) - 記事タイトル
  - `content` (text, required) - 本文
  - `excerpt` (text) - 抜粋・要約
  - `keywords` (jsonb) - キーワード配列
  - `category` (text) - カテゴリ
  - `status` (text) - 状態: 'draft' | 'scheduled' | 'published' | 'failed'
  - `tone` (text) - トーン: 'professional' | 'casual' | 'technical' | 'friendly'
  - `length` (text) - 長さ: 'short' | 'medium' | 'long'
  - `ai_provider` (text) - 使用したAIプロバイダー
  - `ai_model` (text) - 使用したモデル
  - `scheduled_at` (timestamptz) - 公開予定日時
  - `published_at` (timestamptz) - 実際の公開日時
  - `wordpress_post_id` (text) - WordPressの投稿ID
  - `wordpress_config_id` (uuid) - 使用したWordPress設定
  - `seo_score` (integer) - SEOスコア
  - `reading_time` (integer) - 読了時間（分）
  - `word_count` (integer) - 文字数
  - `trend_data` (jsonb) - トレンド分析データ
  - `created_at` (timestamptz) - 作成日時
  - `updated_at` (timestamptz) - 更新日時

  ### 2. custom_topics（カスタムトピックテーブル）
  ユーザーが入力したカスタムトピックを保存・再利用します。
  
  **カラム:**
  - `id` (uuid, primary key) - トピックID
  - `topic_name` (text, required) - トピック名
  - `keywords` (jsonb) - 関連キーワード配列
  - `tone` (text) - デフォルトトーン
  - `length` (text) - デフォルト長さ
  - `category` (text) - カテゴリ
  - `use_count` (integer) - 使用回数
  - `last_used_at` (timestamptz) - 最終使用日時
  - `is_favorite` (boolean) - お気に入り
  - `created_at` (timestamptz) - 作成日時
  - `updated_at` (timestamptz) - 更新日時

  ### 3. generation_prompts（生成プロンプトテーブル）
  記事生成時の詳細な設定を記録します。
  
  **カラム:**
  - `id` (uuid, primary key) - プロンプトID
  - `article_id` (uuid, FK) - 関連する記事ID
  - `topic` (text) - トピック
  - `keywords` (jsonb) - キーワード配列
  - `tone` (text) - トーン
  - `length` (text) - 長さ
  - `include_introduction` (boolean) - 導入部を含むか
  - `include_conclusion` (boolean) - 結論を含むか
  - `include_sources` (boolean) - 出典を含むか
  - `use_trend_data` (boolean) - トレンドデータを使用したか
  - `trend_analysis` (jsonb) - トレンド分析結果
  - `created_at` (timestamptz) - 作成日時

  ## セキュリティ
  - 全テーブルでRLS（Row Level Security）を有効化
  - 現時点では全ユーザーがアクセス可能（認証実装後に制限可能）

  ## パフォーマンス最適化
  - 頻繁に使用されるカラムにインデックスを作成
  - ステータスや日付での検索を高速化
*/

-- =====================================================
-- 1. articles テーブル
-- =====================================================
CREATE TABLE IF NOT EXISTS articles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text NOT NULL,
  content text NOT NULL,
  excerpt text DEFAULT '',
  keywords jsonb DEFAULT '[]'::jsonb,
  category text DEFAULT '',
  status text DEFAULT 'draft',
  tone text DEFAULT 'professional',
  length text DEFAULT 'medium',
  ai_provider text DEFAULT '',
  ai_model text DEFAULT '',
  scheduled_at timestamptz,
  published_at timestamptz,
  wordpress_post_id text DEFAULT '',
  wordpress_config_id uuid,
  seo_score integer DEFAULT 0,
  reading_time integer DEFAULT 0,
  word_count integer DEFAULT 0,
  trend_data jsonb DEFAULT '{}'::jsonb,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- インデックス作成
CREATE INDEX IF NOT EXISTS idx_articles_status ON articles(status);
CREATE INDEX IF NOT EXISTS idx_articles_created_at ON articles(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_articles_wordpress_config_id ON articles(wordpress_config_id);
CREATE INDEX IF NOT EXISTS idx_articles_category ON articles(category);

-- 外部キー制約
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints 
    WHERE constraint_name = 'articles_wordpress_config_id_fkey'
  ) THEN
    ALTER TABLE articles 
    ADD CONSTRAINT articles_wordpress_config_id_fkey 
    FOREIGN KEY (wordpress_config_id) 
    REFERENCES wordpress_configs(id) 
    ON DELETE SET NULL;
  END IF;
END $$;

-- RLS有効化
ALTER TABLE articles ENABLE ROW LEVEL SECURITY;

-- 全ユーザーアクセス許可ポリシー
CREATE POLICY "Allow all access to articles for now"
  ON articles
  FOR ALL
  TO public
  USING (true)
  WITH CHECK (true);

-- =====================================================
-- 2. custom_topics テーブル
-- =====================================================
CREATE TABLE IF NOT EXISTS custom_topics (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  topic_name text NOT NULL,
  keywords jsonb DEFAULT '[]'::jsonb,
  tone text DEFAULT 'professional',
  length text DEFAULT 'medium',
  category text DEFAULT '',
  use_count integer DEFAULT 0,
  last_used_at timestamptz DEFAULT now(),
  is_favorite boolean DEFAULT false,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- インデックス作成
CREATE INDEX IF NOT EXISTS idx_custom_topics_use_count ON custom_topics(use_count DESC);
CREATE INDEX IF NOT EXISTS idx_custom_topics_last_used_at ON custom_topics(last_used_at DESC);
CREATE INDEX IF NOT EXISTS idx_custom_topics_is_favorite ON custom_topics(is_favorite);

-- RLS有効化
ALTER TABLE custom_topics ENABLE ROW LEVEL SECURITY;

-- 全ユーザーアクセス許可ポリシー
CREATE POLICY "Allow all access to custom_topics for now"
  ON custom_topics
  FOR ALL
  TO public
  USING (true)
  WITH CHECK (true);

-- =====================================================
-- 3. generation_prompts テーブル
-- =====================================================
CREATE TABLE IF NOT EXISTS generation_prompts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  article_id uuid,
  topic text NOT NULL,
  keywords jsonb DEFAULT '[]'::jsonb,
  tone text DEFAULT 'professional',
  length text DEFAULT 'medium',
  include_introduction boolean DEFAULT true,
  include_conclusion boolean DEFAULT true,
  include_sources boolean DEFAULT true,
  use_trend_data boolean DEFAULT false,
  trend_analysis jsonb DEFAULT '{}'::jsonb,
  created_at timestamptz DEFAULT now()
);

-- インデックス作成
CREATE INDEX IF NOT EXISTS idx_generation_prompts_article_id ON generation_prompts(article_id);
CREATE INDEX IF NOT EXISTS idx_generation_prompts_created_at ON generation_prompts(created_at DESC);

-- 外部キー制約
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints 
    WHERE constraint_name = 'generation_prompts_article_id_fkey'
  ) THEN
    ALTER TABLE generation_prompts 
    ADD CONSTRAINT generation_prompts_article_id_fkey 
    FOREIGN KEY (article_id) 
    REFERENCES articles(id) 
    ON DELETE CASCADE;
  END IF;
END $$;

-- RLS有効化
ALTER TABLE generation_prompts ENABLE ROW LEVEL SECURITY;

-- 全ユーザーアクセス許可ポリシー
CREATE POLICY "Allow all access to generation_prompts for now"
  ON generation_prompts
  FOR ALL
  TO public
  USING (true)
  WITH CHECK (true);

-- =====================================================
-- 4. updated_at自動更新トリガー
-- =====================================================
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- articlesテーブルのトリガー
DROP TRIGGER IF EXISTS update_articles_updated_at ON articles;
CREATE TRIGGER update_articles_updated_at
  BEFORE UPDATE ON articles
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- custom_topicsテーブルのトリガー
DROP TRIGGER IF EXISTS update_custom_topics_updated_at ON custom_topics;
CREATE TRIGGER update_custom_topics_updated_at
  BEFORE UPDATE ON custom_topics
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();
