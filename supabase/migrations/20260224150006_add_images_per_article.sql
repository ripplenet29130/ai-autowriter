-- Add images_per_article column to ai_configs table
ALTER TABLE ai_configs ADD COLUMN IF NOT EXISTS images_per_article INTEGER DEFAULT 0;

-- Add comment
COMMENT ON COLUMN ai_configs.images_per_article IS '鬮ｫ・ｪ陋溘・・ｽ・ｺ闕ｵ譏ｶ譌ｺ驍ｵ・ｺ雋・∞・ｽ鬘費ｽｸ・ｺ繝ｻ・ｮ鬨ｾ蛹・ｽｽ・ｻ髯ｷ雋槭・陷・ｽｽ髫ｰ謔溘・隶・｢髫ｰ・ｨ繝ｻ・ｰ郢晢ｽｻ郢晢ｽｻ=髴取ｻゑｽｽ・｡髯ｷ莨夲ｽｽ・ｹ驍ｵ・ｲ郢晢ｽｻ-10=髫ｴ・ｫ陞｢・ｽ霎溷｣ｹ繝ｻ郢晢ｽｻ;
