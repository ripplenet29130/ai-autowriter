/*
  # Update trend_keywords table to support AI config and Google Trends data

  1. Schema Changes
    - Add `ai_config_id` (uuid) - Reference to AI configuration used for analysis
    - Add `trend_score` (jsonb) - Google Trends popularity data (timeline, scores)
    - Add `rising_keywords` (text[]) - Rising/trending keywords from Google Trends
    - Update `source` check constraint to include 'hybrid' option

  2. Notes
    - Allows storing combined AI + Google Trends analysis results
    - `ai_config_id` links to the AI profile used for keyword generation
    - `trend_score` stores raw Google Trends JSON data for visualization
    - `rising_keywords` stores trending keywords discovered via Google Trends API
    - 'hybrid' source indicates combined AI + Google Trends analysis
*/

-- Add new columns to trend_keywords table
DO $$
BEGIN
  -- Add ai_config_id column
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'trend_keywords' AND column_name = 'ai_config_id'
  ) THEN
    ALTER TABLE trend_keywords ADD COLUMN ai_config_id uuid REFERENCES ai_configs(id) ON DELETE SET NULL;
  END IF;

  -- Add trend_score column
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'trend_keywords' AND column_name = 'trend_score'
  ) THEN
    ALTER TABLE trend_keywords ADD COLUMN trend_score jsonb;
  END IF;

  -- Add rising_keywords column
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'trend_keywords' AND column_name = 'rising_keywords'
  ) THEN
    ALTER TABLE trend_keywords ADD COLUMN rising_keywords text[] DEFAULT '{}';
  END IF;
END $$;

-- Update source check constraint to include 'hybrid'
DO $$
BEGIN
  -- Drop existing constraint
  ALTER TABLE trend_keywords DROP CONSTRAINT IF EXISTS trend_keywords_source_check;
  
  -- Add new constraint with 'hybrid' option
  ALTER TABLE trend_keywords ADD CONSTRAINT trend_keywords_source_check 
    CHECK (source IN ('gemini', 'google_trends', 'manual', 'hybrid'));
END $$;

-- Create index for ai_config_id lookups
CREATE INDEX IF NOT EXISTS idx_trend_keywords_ai_config_id ON trend_keywords(ai_config_id);
