ALTER TABLE public.schedule_settings
ADD COLUMN IF NOT EXISTS weekly_day smallint;

ALTER TABLE public.schedule_settings
DROP CONSTRAINT IF EXISTS schedule_settings_weekly_day_valid;

ALTER TABLE public.schedule_settings
ADD CONSTRAINT schedule_settings_weekly_day_valid
CHECK (weekly_day IS NULL OR weekly_day BETWEEN 0 AND 6);

COMMENT ON COLUMN public.schedule_settings.weekly_day IS
'Day of week used when frequency is weekly. 0=Sunday through 6=Saturday.';
