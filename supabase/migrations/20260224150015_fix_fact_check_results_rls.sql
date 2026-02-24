-- fact_check_results 驍ｵ・ｺ繝ｻ・ｮRLS驛｢・ｧ陋幢ｽｵ・主｡・ｹ譎｢・ｽ・ｼ驛｢・ｧ繝ｻ・ｶ驛｢譎｢・ｽ・ｼ髯ｷ髮・繝ｻ・ｽ・ｽ鬮ｦ・ｪ遶頑･｢蟆・・・ｮ髮弱・・ｽ・｣
-- 髣厄ｽｴ隲帛現繝ｻ髫ｴ魃会ｽｽ・･: 2026-02-14

ALTER TABLE fact_check_results ENABLE ROW LEVEL SECURITY;

-- 髫ｴ魃会ｽｽ・｢髯昴・ﾂ・･郢晢ｽｻ髯ｷ闌ｨ・ｽ・ｨ髯ｷ闌ｨ・ｽ・ｬ鬯ｮ・｢闕ｵ譏ｴ繝ｻ驛｢譎｢・ｽ・ｪ驛｢・ｧ繝ｻ・ｷ驛｢譎｢・ｽ・ｼ驛｢・ｧ髮区ｨ抵ｽ朱ｬｮ・ｯ繝ｻ・､
DROP POLICY IF EXISTS "Anyone can view fact check results" ON fact_check_results;

-- 髫ｴ魃会ｽｽ・｢髯昴・ﾂ・･郢晢ｽｻSELECT驛｢譎・ｺ｢・取㏍・ｹ・ｧ繝ｻ・ｷ驛｢譎｢・ｽ・ｼ驍ｵ・ｺ陟募ｨｯ譌ｺ驛｢・ｧ陟募ｾ後・驛｢・ｧ繝ｻ・ｯ驛｢譎｢・ｽ・ｪ驛｢・ｧ繝ｻ・｢郢晢ｽｻ闔・･郢晢ｽｻ髣厄ｽｴ隲帛現繝ｻ驍ｵ・ｺ繝ｻ・ｮ驍ｵ・ｺ雋・∞・ｽ竏壹・郢晢ｽｻDROP POLICY IF EXISTS "Users can view their own fact check results" ON fact_check_results;

-- 驛｢・ｧ繝ｻ・ｹ驛｢・ｧ繝ｻ・ｱ驛｢・ｧ繝ｻ・ｸ驛｢譎｢・ｽ・･驛｢譎｢・ｽ・ｼ驛｢譎｢・ｽ・ｫ髫ｰ繝ｻﾂ髫ｴ蟷・ｭ難ｾつ郢晢ｽｻ郢晢ｽｻ驍ｵ・ｺ繝ｻ・ｿ鬯ｮ・｢繝ｻ・ｲ鬮ｫ蛹・ｽｽ・ｧ髯ｷ・ｿ繝ｻ・ｯ鬮｢・ｭ繝ｻ・ｽ
CREATE POLICY "Users can view their own fact check results"
  ON fact_check_results FOR SELECT
  USING (
    EXISTS (
      SELECT 1
      FROM schedule_settings s
      WHERE s.id = fact_check_results.schedule_id
        AND s.user_id = auth.uid()
    )
  );

-- 髫ｰ蜴・ｽｽ・ｿ髯ｷ闌ｨ・ｽ・･驍ｵ・ｺ繝ｻ・ｯ髯溷｢鍋袖隰ｫ繧会ｽｸ・ｺ繝ｻ・ｩ驍ｵ・ｺ驗呻ｽｫ繝ｻ鬘費ｽｹ・ｧ繝ｻ・ｵ驛｢譎｢・ｽ・ｼ驛｢譎∽ｾｭ邵ｺ蟶ｷ・ｹ譎｢・ｽ・ｭ驛｢譎｢・ｽ・ｼ驛｢譎｢・ｽ・ｫ鬨ｾ蛹・ｽｽ・ｨ鬯ｨ・ｾ隴∵腸・ｽ蟶昴￠繝ｻ・ｭ髫ｰ謔ｶ繝ｻDROP POLICY IF EXISTS "Service role can insert fact check results" ON fact_check_results;
CREATE POLICY "Service role can insert fact check results"
  ON fact_check_results FOR INSERT
  WITH CHECK (true);
