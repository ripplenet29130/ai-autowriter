-- Zero means no expiry. Keep explicitly configured durations on existing schedules.
ALTER TABLE public.schedule_settings
  DROP CONSTRAINT IF EXISTS schedule_settings_chatwork_review_expires_days_check;

ALTER TABLE public.schedule_settings
  ALTER COLUMN chatwork_review_expires_days SET DEFAULT 0,
  ADD CONSTRAINT schedule_settings_chatwork_review_expires_days_check
    CHECK (chatwork_review_expires_days BETWEEN 0 AND 365);

COMMENT ON COLUMN public.schedule_settings.chatwork_review_expires_days
  IS 'Review link validity in days; 0 means no expiry.';
