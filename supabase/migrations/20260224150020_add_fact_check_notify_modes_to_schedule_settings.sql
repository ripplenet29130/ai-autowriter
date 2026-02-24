ALTER TABLE public.schedule_settings
ADD COLUMN IF NOT EXISTS fact_check_notify_on_anomaly BOOLEAN DEFAULT true,
ADD COLUMN IF NOT EXISTS fact_check_notify_on_every_run BOOLEAN DEFAULT false;

COMMENT ON COLUMN public.schedule_settings.fact_check_notify_on_anomaly IS
'Notify ChatWork when fact-check anomalies/errors are detected';

COMMENT ON COLUMN public.schedule_settings.fact_check_notify_on_every_run IS
'Notify ChatWork with fact-check summary on every execution';
