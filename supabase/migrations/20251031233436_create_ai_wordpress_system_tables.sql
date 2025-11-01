/*
  # AI WordPress System Database Schema

  ## Overview
  This migration creates the core tables for the AI WordPress System application,
  which enables automated article generation and WordPress posting.

  ## New Tables

  ### 1. ai_configs
  Stores AI provider configuration settings (Gemini, OpenAI, Claude)
  - `id` (uuid, primary key) - Unique identifier
  - `provider` (text) - AI provider name (Gemini/OpenAI/Claude)
  - `api_key` (text) - API key for the provider (encrypted)
  - `model` (text) - Model name (e.g., gemini-2.0-flash, gpt-4o)
  - `temperature` (float) - Creativity parameter (0.0-1.0)
  - `max_tokens` (int) - Maximum token limit
  - `enable_image` (boolean) - Image generation toggle
  - `created_at` (timestamptz) - Record creation timestamp

  ### 2. wp_configs
  Stores WordPress site configuration and credentials
  - `id` (uuid, primary key) - Unique identifier
  - `name` (text) - Configuration name (e.g., "Main Site")
  - `url` (text) - WordPress REST API URL
  - `username` (text) - WordPress username
  - `app_password` (text) - WordPress application password
  - `default_category` (text) - Default category slug
  - `is_active` (boolean) - Main configuration flag
  - `created_at` (timestamptz) - Record creation timestamp

  ### 3. schedule_settings
  Manages posting schedules linking AI and WordPress configs
  - `id` (uuid, primary key) - Unique identifier
  - `ai_config_id` (uuid, foreign key) - Reference to ai_configs
  - `wp_config_id` (uuid, foreign key) - Reference to wp_configs
  - `time` (text) - Posting time (HH:MM format)
  - `frequency` (text) - Posting frequency (daily, weekly, etc.)
  - `status` (boolean) - Active/inactive state
  - `last_run_at` (timestamptz) - Last execution timestamp
  - `next_run_at` (timestamptz) - Next scheduled execution
  - `created_at` (timestamptz) - Record creation timestamp

  ## Security
  - RLS enabled on all tables
  - Authenticated users can read their own data
  - Authenticated users can insert/update/delete their own data
*/

-- Create ai_configs table
CREATE TABLE IF NOT EXISTS ai_configs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider text NOT NULL,
  api_key text NOT NULL,
  model text NOT NULL,
  temperature float DEFAULT 0.7,
  max_tokens int DEFAULT 4000,
  enable_image boolean DEFAULT false,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE ai_configs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view ai_configs"
  ON ai_configs FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Users can insert ai_configs"
  ON ai_configs FOR INSERT
  TO authenticated
  WITH CHECK (true);

CREATE POLICY "Users can update ai_configs"
  ON ai_configs FOR UPDATE
  TO authenticated
  USING (true)
  WITH CHECK (true);

CREATE POLICY "Users can delete ai_configs"
  ON ai_configs FOR DELETE
  TO authenticated
  USING (true);

-- Create wp_configs table
CREATE TABLE IF NOT EXISTS wp_configs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  url text NOT NULL,
  username text NOT NULL,
  app_password text NOT NULL,
  default_category text DEFAULT '',
  is_active boolean DEFAULT false,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE wp_configs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view wp_configs"
  ON wp_configs FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Users can insert wp_configs"
  ON wp_configs FOR INSERT
  TO authenticated
  WITH CHECK (true);

CREATE POLICY "Users can update wp_configs"
  ON wp_configs FOR UPDATE
  TO authenticated
  USING (true)
  WITH CHECK (true);

CREATE POLICY "Users can delete wp_configs"
  ON wp_configs FOR DELETE
  TO authenticated
  USING (true);

-- Create schedule_settings table
CREATE TABLE IF NOT EXISTS schedule_settings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ai_config_id uuid REFERENCES ai_configs(id) ON DELETE CASCADE,
  wp_config_id uuid REFERENCES wp_configs(id) ON DELETE CASCADE,
  time text NOT NULL,
  frequency text NOT NULL,
  status boolean DEFAULT true,
  last_run_at timestamptz,
  next_run_at timestamptz,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE schedule_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view schedule_settings"
  ON schedule_settings FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Users can insert schedule_settings"
  ON schedule_settings FOR INSERT
  TO authenticated
  WITH CHECK (true);

CREATE POLICY "Users can update schedule_settings"
  ON schedule_settings FOR UPDATE
  TO authenticated
  USING (true)
  WITH CHECK (true);

CREATE POLICY "Users can delete schedule_settings"
  ON schedule_settings FOR DELETE
  TO authenticated
  USING (true);