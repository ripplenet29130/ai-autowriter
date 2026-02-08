-- 繝輔ぃ繧ｯ繝医メ繧ｧ繝・け讖溯・逕ｨ縺ｮ繝・・繝悶Ν菴懈・
-- 菴懈・譌･: 2026-02-04

-- 1. 繝輔ぃ繧ｯ繝医メ繧ｧ繝・け險ｭ螳壹ユ繝ｼ繝悶Ν
CREATE TABLE IF NOT EXISTS fact_check_settings (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID,
  enabled BOOLEAN DEFAULT false,
  max_items_to_check INTEGER DEFAULT 10,
  perplexity_api_key TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 2. 繝輔ぃ繧ｯ繝医メ繧ｧ繝・け邨先棡繝・・繝悶Ν
CREATE TABLE IF NOT EXISTS fact_check_results (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  schedule_id UUID REFERENCES schedule_settings(id) ON DELETE CASCADE,
  checked_items JSONB NOT NULL DEFAULT '[]',
  total_checked INTEGER DEFAULT 0,
  issues_found INTEGER DEFAULT 0,
  critical_issues INTEGER DEFAULT 0,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 3. 繧ｹ繧ｱ繧ｸ繝･繝ｼ繝ｫ險ｭ螳壹ユ繝ｼ繝悶Ν縺ｫ蛻励ｒ霑ｽ蜉
ALTER TABLE schedule_settings 
ADD COLUMN IF NOT EXISTS enable_fact_check BOOLEAN DEFAULT false,
ADD COLUMN IF NOT EXISTS fact_check_note TEXT;

-- 4. 繧､繝ｳ繝・ャ繧ｯ繧ｹ縺ｮ菴懈・
CREATE INDEX IF NOT EXISTS idx_fact_check_results_schedule_id ON fact_check_results(schedule_id);
CREATE INDEX IF NOT EXISTS idx_fact_check_results_created_at ON fact_check_results(created_at DESC);

-- 5. RLS (Row Level Security) 繝昴Μ繧ｷ繝ｼ縺ｮ險ｭ螳・
ALTER TABLE fact_check_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE fact_check_results ENABLE ROW LEVEL SECURITY;

-- fact_check_settings 縺ｮ繝昴Μ繧ｷ繝ｼ
CREATE POLICY "Users can view their own fact check settings"
  ON fact_check_settings FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own fact check settings"
  ON fact_check_settings FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own fact check settings"
  ON fact_check_settings FOR UPDATE
  USING (auth.uid() = user_id);

-- fact_check_results 縺ｮ繝昴Μ繧ｷ繝ｼ (蜈ｨ繝ｦ繝ｼ繧ｶ繝ｼ縺碁夢隕ｧ蜿ｯ閭ｽ)
CREATE POLICY "Anyone can view fact check results"
  ON fact_check_results FOR SELECT
  USING (true);

CREATE POLICY "Service role can insert fact check results"
  ON fact_check_results FOR INSERT
  WITH CHECK (true);

-- 6. 繧ｳ繝｡繝ｳ繝医・霑ｽ蜉
COMMENT ON TABLE fact_check_settings IS 'Perplexity API繧剃ｽｿ逕ｨ縺励◆繝輔ぃ繧ｯ繝医メ繧ｧ繝・け讖溯・縺ｮ險ｭ螳・;
COMMENT ON TABLE fact_check_results IS '繝輔ぃ繧ｯ繝医メ繧ｧ繝・け縺ｮ讀懆ｨｼ邨先棡繧剃ｿ晏ｭ・;
COMMENT ON COLUMN schedule_settings.enable_fact_check IS '繝輔ぃ繧ｯ繝医メ繧ｧ繝・け讖溯・縺ｮ譛牙柑/辟｡蜉ｹ';
COMMENT ON COLUMN schedule_settings.fact_check_note IS '蜆ｪ蜈育噪縺ｫ繝√ぉ繝・け縺吶ｋ邂・園・・[]]縺ｧ蝗ｲ繧・・;
ALTER TABLE fact_check_settings ADD COLUMN IF NOT EXISTS model_name TEXT DEFAULT 'sonar';
