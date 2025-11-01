/*
  # Add post history table and pg_cron setup

  1. New Tables
    - `post_history`
      - `id` (uuid, primary key)
      - `schedule_id` (uuid, foreign key to schedule_settings)
      - `ai_config_id` (uuid, foreign key to ai_configs)
      - `wp_config_id` (uuid, foreign key to wp_configs)
      - `title` (text) - Generated article title
      - `content` (text) - Generated article content
      - `wp_post_id` (bigint) - WordPress post ID
      - `wp_post_url` (text) - WordPress post URL
      - `status` (text) - success or error
      - `error_message` (text) - Error message if failed
      - `created_at` (timestamptz) - When the post was created

  2. Security
    - Enable RLS on `post_history` table
    - Add policy for anonymous users to insert and read post history

  3. pg_cron Setup
    - Enable pg_cron extension
    - Schedule auto-post function to run every minute
*/

-- Create post_history table
CREATE TABLE IF NOT EXISTS post_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  schedule_id uuid REFERENCES schedule_settings(id) ON DELETE CASCADE,
  ai_config_id uuid REFERENCES ai_configs(id) ON DELETE SET NULL,
  wp_config_id uuid REFERENCES wp_configs(id) ON DELETE SET NULL,
  title text DEFAULT '',
  content text DEFAULT '',
  wp_post_id bigint,
  wp_post_url text,
  status text NOT NULL CHECK (status IN ('success', 'error')),
  error_message text,
  created_at timestamptz DEFAULT now()
);

-- Enable RLS
ALTER TABLE post_history ENABLE ROW LEVEL SECURITY;

-- Allow anonymous users to insert and read post history
CREATE POLICY "Allow anonymous to insert post history"
  ON post_history
  FOR INSERT
  TO anon
  WITH CHECK (true);

CREATE POLICY "Allow anonymous to read post history"
  ON post_history
  FOR SELECT
  TO anon
  USING (true);

-- Enable pg_cron extension
CREATE EXTENSION IF NOT EXISTS pg_cron;

-- Grant usage to postgres user
GRANT USAGE ON SCHEMA cron TO postgres;

-- Schedule the auto-post function to run every minute
-- This will check all active schedules and execute those matching the current time
SELECT cron.schedule(
  'auto-post-job',
  '* * * * *',  -- Every minute
  $$
    SELECT net.http_post(
      url := current_setting('app.settings.supabase_url') || '/functions/v1/auto-post',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || current_setting('app.settings.service_role_key')
      )
    );
  $$
);

-- Store Supabase URL and Service Role Key in app settings
-- These will be set via environment variables or Supabase dashboard
DO $$
BEGIN
  -- Check if the settings already exist
  IF NOT EXISTS (
    SELECT 1 FROM pg_settings WHERE name = 'app.settings.supabase_url'
  ) THEN
    -- These need to be set manually via SQL or Supabase dashboard
    -- ALTER DATABASE postgres SET app.settings.supabase_url = 'your-supabase-url';
    -- ALTER DATABASE postgres SET app.settings.service_role_key = 'your-service-role-key';
    RAISE NOTICE 'Please set app.settings.supabase_url and app.settings.service_role_key';
  END IF;
END $$;
