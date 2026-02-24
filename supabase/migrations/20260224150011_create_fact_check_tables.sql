-- 驛｢譎・ｽｼ譁撰ｼ憺Δ・ｧ繝ｻ・ｯ驛｢譎冗樟郢晢ｽ｡驛｢・ｧ繝ｻ・ｧ驛｢譏ｴ繝ｻ邵ｺ鬘鯉ｽｮ蛹・ｽｺ・ｯ郢晢ｽｻ鬨ｾ蛹・ｽｽ・ｨ驍ｵ・ｺ繝ｻ・ｮ驛｢譏ｴ繝ｻ郢晢ｽｻ驛｢譎・§・取凵謚・ｫ帛現繝ｻ
-- 髣厄ｽｴ隲帛現繝ｻ髫ｴ魃会ｽｽ・･: 2026-02-04

-- 1. 驛｢譎・ｽｼ譁撰ｼ憺Δ・ｧ繝ｻ・ｯ驛｢譎冗樟郢晢ｽ｡驛｢・ｧ繝ｻ・ｧ驛｢譏ｴ繝ｻ邵ｺ鮃ｹ蝮弱・・ｭ髯橸ｽｳ陞｢・ｹ郢晢ｽｦ驛｢譎｢・ｽ・ｼ驛｢譎・§・弱・
CREATE TABLE IF NOT EXISTS fact_check_settings (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID,
  enabled BOOLEAN DEFAULT false,
  max_items_to_check INTEGER DEFAULT 10,
  perplexity_api_key TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 2. 驛｢譎・ｽｼ譁撰ｼ憺Δ・ｧ繝ｻ・ｯ驛｢譎冗樟郢晢ｽ｡驛｢・ｧ繝ｻ・ｧ驛｢譏ｴ繝ｻ邵ｺ鮃ｹ縺願怦蝓滂ｽ｣・｡驛｢譏ｴ繝ｻ郢晢ｽｻ驛｢譎・§・弱・
CREATE TABLE IF NOT EXISTS fact_check_results (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  schedule_id UUID REFERENCES schedule_settings(id) ON DELETE CASCADE,
  checked_items JSONB NOT NULL DEFAULT '[]',
  total_checked INTEGER DEFAULT 0,
  issues_found INTEGER DEFAULT 0,
  critical_issues INTEGER DEFAULT 0,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 3. 驛｢・ｧ繝ｻ・ｹ驛｢・ｧ繝ｻ・ｱ驛｢・ｧ繝ｻ・ｸ驛｢譎｢・ｽ・･驛｢譎｢・ｽ・ｼ驛｢譎｢・ｽ・ｫ鬮ｫ・ｪ繝ｻ・ｭ髯橸ｽｳ陞｢・ｹ郢晢ｽｦ驛｢譎｢・ｽ・ｼ驛｢譎・§・取刮・ｸ・ｺ繝ｻ・ｫ髯具ｽｻ陷会ｽｱ繝ｻ蟶晄≧繝ｻ・ｽ髯ｷ莨夲ｽ｣・ｰ
ALTER TABLE schedule_settings 
ADD COLUMN IF NOT EXISTS enable_fact_check BOOLEAN DEFAULT false,
ADD COLUMN IF NOT EXISTS fact_check_note TEXT;

-- 4. 驛｢・ｧ繝ｻ・､驛｢譎｢・ｽ・ｳ驛｢譏ｴ繝ｻ郢晢ｽ｣驛｢・ｧ繝ｻ・ｯ驛｢・ｧ繝ｻ・ｹ驍ｵ・ｺ繝ｻ・ｮ髣厄ｽｴ隲帛現繝ｻ
CREATE INDEX IF NOT EXISTS idx_fact_check_results_schedule_id ON fact_check_results(schedule_id);
CREATE INDEX IF NOT EXISTS idx_fact_check_results_created_at ON fact_check_results(created_at DESC);

-- 5. RLS (Row Level Security) 驛｢譎・ｺ｢・取㏍・ｹ・ｧ繝ｻ・ｷ驛｢譎｢・ｽ・ｼ驍ｵ・ｺ繝ｻ・ｮ鬮ｫ・ｪ繝ｻ・ｭ髯橸ｽｳ郢晢ｽｻ
ALTER TABLE fact_check_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE fact_check_results ENABLE ROW LEVEL SECURITY;

-- fact_check_settings 驍ｵ・ｺ繝ｻ・ｮ驛｢譎・ｺ｢・取㏍・ｹ・ｧ繝ｻ・ｷ驛｢譎｢・ｽ・ｼ
CREATE POLICY "Users can view their own fact check settings"
  ON fact_check_settings FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own fact check settings"
  ON fact_check_settings FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own fact check settings"
  ON fact_check_settings FOR UPDATE
  USING (auth.uid() = user_id);

-- fact_check_results 驍ｵ・ｺ繝ｻ・ｮ驛｢譎・ｺ｢・取㏍・ｹ・ｧ繝ｻ・ｷ驛｢譎｢・ｽ・ｼ (髯ｷ闌ｨ・ｽ・ｨ驛｢譎｢・ｽ・ｦ驛｢譎｢・ｽ・ｼ驛｢・ｧ繝ｻ・ｶ驛｢譎｢・ｽ・ｼ驍ｵ・ｺ驕停・・､・｢鬮ｫ蛹・ｽｽ・ｧ髯ｷ・ｿ繝ｻ・ｯ鬮｢・ｭ繝ｻ・ｽ)
CREATE POLICY "Anyone can view fact check results"
  ON fact_check_results FOR SELECT
  USING (true);

CREATE POLICY "Service role can insert fact check results"
  ON fact_check_results FOR INSERT
  WITH CHECK (true);

-- 6. 驛｢・ｧ繝ｻ・ｳ驛｢譎｢・ｽ・｡驛｢譎｢・ｽ・ｳ驛｢譎冗樟郢晢ｽｻ鬮ｴ謇假ｽｽ・ｽ髯ｷ莨夲ｽ｣・ｰ
COMMENT ON TABLE fact_check_settings IS 'Perplexity API驛｢・ｧ陷代・・ｽ・ｽ繝ｻ・ｿ鬨ｾ蛹・ｽｽ・ｨ驍ｵ・ｺ陷会ｽｱ隨ｳ繝ｻ・ｹ譎・ｽｼ譁撰ｼ憺Δ・ｧ繝ｻ・ｯ驛｢譎冗樟郢晢ｽ｡驛｢・ｧ繝ｻ・ｧ驛｢譏ｴ繝ｻ邵ｺ鬘鯉ｽｮ蛹・ｽｺ・ｯ郢晢ｽｻ驍ｵ・ｺ繝ｻ・ｮ鬮ｫ・ｪ繝ｻ・ｭ髯橸ｽｳ郢晢ｽｻ;
COMMENT ON TABLE fact_check_results IS '驛｢譎・ｽｼ譁撰ｼ憺Δ・ｧ繝ｻ・ｯ驛｢譎冗樟郢晢ｽ｡驛｢・ｧ繝ｻ・ｧ驛｢譏ｴ繝ｻ邵ｺ驢搾ｽｸ・ｺ繝ｻ・ｮ髫ｶﾂ隲帙・・ｽ・ｨ繝ｻ・ｼ鬩搾ｽｨ陷亥沺・｣・｡驛｢・ｧ陷代・・ｽ・ｿ隴取得・ｽ・ｭ郢晢ｽｻ;
COMMENT ON COLUMN schedule_settings.enable_fact_check IS '驛｢譎・ｽｼ譁撰ｼ憺Δ・ｧ繝ｻ・ｯ驛｢譎冗樟郢晢ｽ｡驛｢・ｧ繝ｻ・ｧ驛｢譏ｴ繝ｻ邵ｺ鬘鯉ｽｮ蛹・ｽｺ・ｯ郢晢ｽｻ驍ｵ・ｺ繝ｻ・ｮ髫ｴ蟶ｷ逕･隴溘・髴取ｻゑｽｽ・｡髯ｷ莨夲ｽｽ・ｹ';
COMMENT ON COLUMN schedule_settings.fact_check_note IS '髯ｷ繝ｻ・ｽ・ｪ髯ｷ驛√＃陜趣ｽｪ驍ｵ・ｺ繝ｻ・ｫ驛｢譏ｶ繝ｻ邵ｺ閾･・ｹ譏ｴ繝ｻ邵ｺ驢搾ｽｸ・ｺ陷ｷ・ｶ繝ｻ遏ｩ・らｹ晢ｽｻ陜ｨ蛛ｵ繝ｻ郢晢ｽｻ[]]驍ｵ・ｺ繝ｻ・ｧ髯懈圜・ｽ・ｲ驛｢・ｧ・つ郢晢ｽｻ郢晢ｽｻ;
ALTER TABLE fact_check_settings ADD COLUMN IF NOT EXISTS model_name TEXT DEFAULT 'sonar';
