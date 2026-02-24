-- 驛｢・ｧ繝ｻ・ｿ驛｢・ｧ繝ｻ・､驛｢譎冗樟・取刮・ｹ・ｧ繝ｻ・ｻ驛｢譏ｴ繝ｻ郢晢ｽｨ驛｢譏ｴ繝ｻ郢晢ｽｻ驛｢譎・§・取刮・ｸ・ｺ繝ｻ・ｮ髣厄ｽｴ隲帛現繝ｻ
CREATE TABLE IF NOT EXISTS title_sets (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name TEXT NOT NULL,
    titles TEXT[] NOT NULL DEFAULT '{}',
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- RLS鬮ｫ・ｪ繝ｻ・ｭ髯橸ｽｳ郢晢ｽｻ
ALTER TABLE title_sets ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow public access to title_sets"
ON title_sets FOR ALL
TO public
USING (true)
WITH CHECK (true);
