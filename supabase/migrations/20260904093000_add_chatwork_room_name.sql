ALTER TABLE schedule_settings
  ADD COLUMN IF NOT EXISTS chatwork_room_name text;

COMMENT ON COLUMN schedule_settings.chatwork_room_name IS 'Manual display name for the ChatWork review notification destination.';
