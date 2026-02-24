-- Add prompt_set_id column to schedule_settings table
ALTER TABLE schedule_settings 
ADD COLUMN IF NOT EXISTS prompt_set_id uuid REFERENCES prompt_sets(id) ON DELETE SET NULL;

-- Create index for faster lookups
CREATE INDEX IF NOT EXISTS idx_schedule_settings_prompt_set ON schedule_settings(prompt_set_id);
