-- Add target_word_count and writing_tone to schedule_settings
ALTER TABLE schedule_settings 
ADD COLUMN IF NOT EXISTS target_word_count INTEGER DEFAULT 2000,
ADD COLUMN IF NOT EXISTS writing_tone TEXT DEFAULT 'professional';

-- Comment on columns
COMMENT ON COLUMN schedule_settings.target_word_count IS 'Target word count for the generated article (Default: 2000)';
COMMENT ON COLUMN schedule_settings.writing_tone IS 'Writing tone (professional, casual, technical, friendly)';
