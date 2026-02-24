-- Add is_active column to ai_configs table
ALTER TABLE ai_configs ADD COLUMN IF NOT EXISTS is_active BOOLEAN DEFAULT false;

-- Set the most recently created config as active initially
UPDATE ai_configs
SET is_active = true
WHERE id = (
  SELECT id FROM ai_configs ORDER BY created_at DESC LIMIT 1
);
