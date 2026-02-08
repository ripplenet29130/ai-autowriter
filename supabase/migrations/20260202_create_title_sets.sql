-- タイトルセットテーブルの作成
CREATE TABLE IF NOT EXISTS title_sets (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name TEXT NOT NULL,
    titles TEXT[] NOT NULL DEFAULT '{}',
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- RLS設定
ALTER TABLE title_sets ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow public access to title_sets"
ON title_sets FOR ALL
TO public
USING (true)
WITH CHECK (true);
