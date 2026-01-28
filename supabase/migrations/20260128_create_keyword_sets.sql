-- キーワードセットテーブルの作成
CREATE TABLE IF NOT EXISTS keyword_sets (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name TEXT NOT NULL,
    keywords TEXT[] NOT NULL DEFAULT '{}',
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- RLS設定（必要に応じて）
ALTER TABLE keyword_sets ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow public access to keyword_sets"
ON keyword_sets FOR ALL
TO public
USING (true)
WITH CHECK (true);
