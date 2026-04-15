ALTER TABLE public.schedule_settings
ADD COLUMN IF NOT EXISTS article_goal TEXT DEFAULT 'standard';

COMMENT ON COLUMN public.schedule_settings.article_goal IS
'Article goal/mode: standard, beginner, practical, seo, authority, comparison, conversion.';
