/*
  # Add is_active column to ai_configs table

  1. Changes
    - Add `is_active` column to `ai_configs` table
      - Type: boolean
      - Default: false
      - Allows only one active AI config at a time
    
  2. Notes
    - This enables the application to track which AI configuration is currently active
    - Only one AI config should be active at any time for consistent article generation
*/

-- Add is_active column if it doesn't exist
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'ai_configs' AND column_name = 'is_active'
  ) THEN
    ALTER TABLE ai_configs ADD COLUMN is_active boolean DEFAULT false;
  END IF;
END $$;

-- Create index for faster queries on active configs
CREATE INDEX IF NOT EXISTS idx_ai_configs_is_active ON ai_configs(is_active) WHERE is_active = true;
