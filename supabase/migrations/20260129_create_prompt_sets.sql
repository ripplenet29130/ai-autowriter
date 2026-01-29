-- =====================================================
-- prompt_sets テーブルの作成
-- =====================================================
CREATE TABLE IF NOT EXISTS prompt_sets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  custom_instructions text NOT NULL,
  is_default boolean DEFAULT false,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- インデックス作成
CREATE INDEX IF NOT EXISTS idx_prompt_sets_created_at ON prompt_sets(created_at DESC);

-- RLS有効化
ALTER TABLE prompt_sets ENABLE ROW LEVEL SECURITY;

-- 全ユーザーアクセス許可ポリシー
CREATE POLICY "Allow all access to prompt_sets for now"
  ON prompt_sets
  FOR ALL
  TO public
  USING (true)
  WITH CHECK (true);

-- updated_at自動更新トリガー
DROP TRIGGER IF EXISTS update_prompt_sets_updated_at ON prompt_sets;
CREATE TRIGGER update_prompt_sets_updated_at
  BEFORE UPDATE ON prompt_sets
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();
