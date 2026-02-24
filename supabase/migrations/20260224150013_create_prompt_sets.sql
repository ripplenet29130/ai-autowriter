-- =====================================================
-- prompt_sets 驛｢譏ｴ繝ｻ郢晢ｽｻ驛｢譎・§・取刮・ｸ・ｺ繝ｻ・ｮ髣厄ｽｴ隲帛現繝ｻ
-- =====================================================
CREATE TABLE IF NOT EXISTS prompt_sets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  custom_instructions text NOT NULL,
  is_default boolean DEFAULT false,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- 驛｢・ｧ繝ｻ・､驛｢譎｢・ｽ・ｳ驛｢譏ｴ繝ｻ郢晢ｽ｣驛｢・ｧ繝ｻ・ｯ驛｢・ｧ繝ｻ・ｹ髣厄ｽｴ隲帛現繝ｻ
CREATE INDEX IF NOT EXISTS idx_prompt_sets_created_at ON prompt_sets(created_at DESC);

-- RLS髫ｴ蟶ｷ逕･隴滄｡悟ｳｪ郢晢ｽｻ
ALTER TABLE prompt_sets ENABLE ROW LEVEL SECURITY;

-- 髯ｷ闌ｨ・ｽ・ｨ驛｢譎｢・ｽ・ｦ驛｢譎｢・ｽ・ｼ驛｢・ｧ繝ｻ・ｶ驛｢譎｢・ｽ・ｼ驛｢・ｧ繝ｻ・｢驛｢・ｧ繝ｻ・ｯ驛｢・ｧ繝ｻ・ｻ驛｢・ｧ繝ｻ・ｹ鬮ｫ・ｪ繝ｻ・ｱ髯ｷ・ｿ繝ｻ・ｯ驛｢譎・ｺ｢・取㏍・ｹ・ｧ繝ｻ・ｷ驛｢譎｢・ｽ・ｼ
CREATE POLICY "Allow all access to prompt_sets for now"
  ON prompt_sets
  FOR ALL
  TO public
  USING (true)
  WITH CHECK (true);

-- updated_at鬮｢・ｾ繝ｻ・ｪ髯ｷ讎奇ｽ｢轣假ｽｳ・ｩ髫ｴ繝ｻ・ｽ・ｰ驛｢譎冗樟・取㏍・ｹ・ｧ繝ｻ・ｬ驛｢譎｢・ｽ・ｼ
DROP TRIGGER IF EXISTS update_prompt_sets_updated_at ON prompt_sets;
CREATE TRIGGER update_prompt_sets_updated_at
  BEFORE UPDATE ON prompt_sets
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();
