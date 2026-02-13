-- Add images_per_article column to ai_configs table
ALTER TABLE ai_configs ADD COLUMN IF NOT EXISTS images_per_article INTEGER DEFAULT 0;

-- Add comment
COMMENT ON COLUMN ai_configs.images_per_article IS '記事あたりの画像生成枚数（0=無効、1-10=枚数）';
