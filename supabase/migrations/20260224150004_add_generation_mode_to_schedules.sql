-- Add generation mode and title set support to schedule_settings table

-- Add generation_mode column (keyword, title, or both)
ALTER TABLE schedule_settings 
ADD COLUMN IF NOT EXISTS generation_mode TEXT DEFAULT 'keyword';

-- Add keyword_set_id column (reference to keyword_sets)
ALTER TABLE schedule_settings 
ADD COLUMN IF NOT EXISTS keyword_set_id UUID REFERENCES keyword_sets(id) ON DELETE SET NULL;

-- Add title_set_id column (reference to title_sets)
ALTER TABLE schedule_settings 
ADD COLUMN IF NOT EXISTS title_set_id UUID REFERENCES title_sets(id) ON DELETE SET NULL;

-- Add comment for documentation
COMMENT ON COLUMN schedule_settings.generation_mode IS 'Generation mode: keyword, title, or both';
COMMENT ON COLUMN schedule_settings.keyword_set_id IS 'Reference to keyword set for keyword-based generation';
COMMENT ON COLUMN schedule_settings.title_set_id IS 'Reference to title set for title-based generation';
