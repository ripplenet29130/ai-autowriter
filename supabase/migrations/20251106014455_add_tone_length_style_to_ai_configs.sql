/*
  # Add article generation parameters to ai_configs table

  1. Schema Changes
    - Add `tone` (text) - Writing tone for article generation (e.g., "ビジネス", "カジュアル")
    - Add `article_length` (text) - Article length preference (e.g., "短文（500〜800字）")
    - Add `style` (text) - Output style for article generation (e.g., "SEO重視")

  2. Notes
    - These parameters will be used to customize AI prompts for article generation
    - Default values are set for backward compatibility with existing records
    - Values are stored as text to allow flexibility in options
*/

-- Add new columns to ai_configs table
DO $$
BEGIN
  -- Add tone column
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'ai_configs' AND column_name = 'tone'
  ) THEN
    ALTER TABLE ai_configs ADD COLUMN tone text DEFAULT 'ビジネス';
  END IF;

  -- Add article_length column
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'ai_configs' AND column_name = 'article_length'
  ) THEN
    ALTER TABLE ai_configs ADD COLUMN article_length text DEFAULT '中（1000〜1500字）';
  END IF;

  -- Add style column
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'ai_configs' AND column_name = 'style'
  ) THEN
    ALTER TABLE ai_configs ADD COLUMN style text DEFAULT 'SEO重視';
  END IF;
END $$;

-- Update existing records to have default values
UPDATE ai_configs 
SET 
  tone = COALESCE(tone, 'ビジネス'),
  article_length = COALESCE(article_length, '中（1000〜1500字）'),
  style = COALESCE(style, 'SEO重視')
WHERE tone IS NULL OR article_length IS NULL OR style IS NULL;
