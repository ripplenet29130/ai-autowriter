ALTER TABLE public.schedule_settings
  ALTER COLUMN chatwork_review_permission SET DEFAULT 'edit';

COMMENT ON COLUMN public.schedule_settings.chatwork_review_permission IS
  'Review-link permission: view, comment, or edit. Defaults to edit for new schedules.';
