/*
  # Update RLS Policies to Allow Anonymous Access

  1. Changes
    - Drop existing restrictive policies on all tables
    - Create new policies that allow both authenticated and anonymous users
    - Applies to: ai_configs, wp_configs, schedule_settings
  
  2. Security Note
    - This allows anonymous access to all tables
    - Suitable for development/testing or single-user scenarios
    - For production with multiple users, implement proper authentication
*/

-- Drop existing policies for ai_configs
DROP POLICY IF EXISTS "Users can view ai_configs" ON ai_configs;
DROP POLICY IF EXISTS "Users can insert ai_configs" ON ai_configs;
DROP POLICY IF EXISTS "Users can update ai_configs" ON ai_configs;
DROP POLICY IF EXISTS "Users can delete ai_configs" ON ai_configs;

-- Create new policies for ai_configs (allow anon and authenticated)
CREATE POLICY "Anyone can view ai_configs"
  ON ai_configs FOR SELECT
  USING (true);

CREATE POLICY "Anyone can insert ai_configs"
  ON ai_configs FOR INSERT
  WITH CHECK (true);

CREATE POLICY "Anyone can update ai_configs"
  ON ai_configs FOR UPDATE
  USING (true)
  WITH CHECK (true);

CREATE POLICY "Anyone can delete ai_configs"
  ON ai_configs FOR DELETE
  USING (true);

-- Drop existing policies for wp_configs
DROP POLICY IF EXISTS "Users can view wp_configs" ON wp_configs;
DROP POLICY IF EXISTS "Users can insert wp_configs" ON wp_configs;
DROP POLICY IF EXISTS "Users can update wp_configs" ON wp_configs;
DROP POLICY IF EXISTS "Users can delete wp_configs" ON wp_configs;

-- Create new policies for wp_configs (allow anon and authenticated)
CREATE POLICY "Anyone can view wp_configs"
  ON wp_configs FOR SELECT
  USING (true);

CREATE POLICY "Anyone can insert wp_configs"
  ON wp_configs FOR INSERT
  WITH CHECK (true);

CREATE POLICY "Anyone can update wp_configs"
  ON wp_configs FOR UPDATE
  USING (true)
  WITH CHECK (true);

CREATE POLICY "Anyone can delete wp_configs"
  ON wp_configs FOR DELETE
  USING (true);

-- Drop existing policies for schedule_settings
DROP POLICY IF EXISTS "Users can view schedule_settings" ON schedule_settings;
DROP POLICY IF EXISTS "Users can insert schedule_settings" ON schedule_settings;
DROP POLICY IF EXISTS "Users can update schedule_settings" ON schedule_settings;
DROP POLICY IF EXISTS "Users can delete schedule_settings" ON schedule_settings;

-- Create new policies for schedule_settings (allow anon and authenticated)
CREATE POLICY "Anyone can view schedule_settings"
  ON schedule_settings FOR SELECT
  USING (true);

CREATE POLICY "Anyone can insert schedule_settings"
  ON schedule_settings FOR INSERT
  WITH CHECK (true);

CREATE POLICY "Anyone can update schedule_settings"
  ON schedule_settings FOR UPDATE
  USING (true)
  WITH CHECK (true);

CREATE POLICY "Anyone can delete schedule_settings"
  ON schedule_settings FOR DELETE
  USING (true);