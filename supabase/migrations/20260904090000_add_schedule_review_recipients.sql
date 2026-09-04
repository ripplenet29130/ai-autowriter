ALTER TABLE schedule_settings
  ADD COLUMN IF NOT EXISTS chatwork_recipients jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS chatwork_notify_on_review boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS chatwork_review_permission text NOT NULL DEFAULT 'comment'
    CHECK (chatwork_review_permission IN ('view', 'comment', 'edit')),
  ADD COLUMN IF NOT EXISTS chatwork_review_expires_days integer NOT NULL DEFAULT 30
    CHECK (chatwork_review_expires_days BETWEEN 1 AND 365);

COMMENT ON COLUMN schedule_settings.chatwork_recipients IS 'ChatWork To recipients: [{"name":"田中さん","accountId":"123"}]';
