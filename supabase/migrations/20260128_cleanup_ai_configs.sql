-- Drop unused columns from ai_configs table
-- These columns are no longer used as we moved to a single-config-per-provider model
-- and separate settings for generation parameters.

ALTER TABLE ai_configs 
DROP COLUMN IF EXISTS name,
DROP COLUMN IF EXISTS tone,
DROP COLUMN IF EXISTS article_length,
DROP COLUMN IF EXISTS style,
DROP COLUMN IF EXISTS language,
DROP COLUMN IF EXISTS enable_image; -- Replaced by image_enabled
