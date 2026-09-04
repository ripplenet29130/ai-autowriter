-- ChatWork は全体で 1 トークン、通知先と担当者は予約投稿ごとに管理する。
CREATE TABLE IF NOT EXISTS chatwork_settings (
  id boolean PRIMARY KEY DEFAULT true CHECK (id),
  api_token text NOT NULL DEFAULT '',
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid REFERENCES auth.users(id) ON DELETE SET NULL
);

ALTER TABLE chatwork_settings ENABLE ROW LEVEL SECURITY;

ALTER TABLE schedule_settings
  ADD COLUMN IF NOT EXISTS chatwork_recipients jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS chatwork_notify_on_review boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS chatwork_review_permission text NOT NULL DEFAULT 'comment'
    CHECK (chatwork_review_permission IN ('view', 'comment', 'edit')),
  ADD COLUMN IF NOT EXISTS chatwork_review_expires_days integer NOT NULL DEFAULT 30
    CHECK (chatwork_review_expires_days BETWEEN 1 AND 365);

COMMENT ON COLUMN schedule_settings.chatwork_recipients IS 'ChatWork To recipients: [{"name":"田中さん","accountId":"123"}]';
