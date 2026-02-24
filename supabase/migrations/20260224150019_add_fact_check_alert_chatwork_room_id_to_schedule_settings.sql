ALTER TABLE public.schedule_settings
ADD COLUMN IF NOT EXISTS fact_check_alert_chatwork_room_id TEXT;

COMMENT ON COLUMN public.schedule_settings.fact_check_alert_chatwork_room_id IS
'ChatWork room IDs for fact-check anomaly alerts (comma-separated)';
