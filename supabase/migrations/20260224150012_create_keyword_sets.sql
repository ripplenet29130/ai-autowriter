-- 驛｢・ｧ繝ｻ・ｭ驛｢譎｢・ｽ・ｼ驛｢譎｢・ｽ・ｯ驛｢譎｢・ｽ・ｼ驛｢譎擾ｽｳ・ｨ邵ｺ譎会ｽｹ譏ｴ繝ｻ郢晢ｽｨ驛｢譏ｴ繝ｻ郢晢ｽｻ驛｢譎・§・取刮・ｸ・ｺ繝ｻ・ｮ髣厄ｽｴ隲帛現繝ｻ
CREATE TABLE IF NOT EXISTS keyword_sets (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name TEXT NOT NULL,
    keywords TEXT[] NOT NULL DEFAULT '{}',
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- RLS鬮ｫ・ｪ繝ｻ・ｭ髯橸ｽｳ陞滂ｽｲ繝ｻ・ｼ闔・･繝ｻ・ｿ郢晢ｽｻ繝ｻ・ｦ遶丞｣ｺ繝ｻ髯滂ｽ｢隲帷腸・ｧ驍ｵ・ｺ繝ｻ・ｦ郢晢ｽｻ郢晢ｽｻ
ALTER TABLE keyword_sets ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow public access to keyword_sets"
ON keyword_sets FOR ALL
TO public
USING (true)
WITH CHECK (true);
