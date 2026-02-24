ALTER TABLE public.schedule_settings
ADD COLUMN IF NOT EXISTS fact_check_auto_fix_enabled BOOLEAN;

COMMENT ON COLUMN public.schedule_settings.fact_check_auto_fix_enabled IS
'Schedule-level override for fact-check auto-fix';
