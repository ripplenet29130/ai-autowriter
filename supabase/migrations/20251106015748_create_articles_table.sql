/*
  # Create articles table for generated content tracking

  1. New Tables
    - `articles`
      - `id` (uuid, primary key) - Unique identifier
      - `ai_config_id` (uuid) - Reference to AI configuration used
      - `wp_config_id` (uuid) - Reference to WordPress site posted to
      - `keyword` (text) - Keyword used for article generation
      - `title` (text) - Generated article title
      - `content` (text) - Generated article content
      - `wp_url` (text) - URL of published WordPress post
      - `created_at` (timestamptz) - Timestamp when article was created

  2. Security
    - Enable RLS on `articles` table
    - Add policy for anonymous users to insert, read, and delete articles

  3. Notes
    - This table stores generated articles and their publication status
    - Links to AI and WordPress configurations for tracking
    - Future integration with scheduler for automatic posting
*/

-- Create articles table
CREATE TABLE IF NOT EXISTS articles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ai_config_id uuid REFERENCES ai_configs(id) ON DELETE SET NULL,
  wp_config_id uuid REFERENCES wp_configs(id) ON DELETE SET NULL,
  keyword text NOT NULL,
  title text NOT NULL,
  content text NOT NULL,
  wp_url text,
  created_at timestamptz DEFAULT now()
);

-- Create indexes for faster lookups
CREATE INDEX IF NOT EXISTS idx_articles_ai_config_id ON articles(ai_config_id);
CREATE INDEX IF NOT EXISTS idx_articles_wp_config_id ON articles(wp_config_id);
CREATE INDEX IF NOT EXISTS idx_articles_created_at ON articles(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_articles_keyword ON articles(keyword);

-- Enable RLS
ALTER TABLE articles ENABLE ROW LEVEL SECURITY;

-- Allow anonymous users to insert articles
CREATE POLICY "Allow anonymous to insert articles"
  ON articles
  FOR INSERT
  TO anon
  WITH CHECK (true);

-- Allow anonymous users to read articles
CREATE POLICY "Allow anonymous to read articles"
  ON articles
  FOR SELECT
  TO anon
  USING (true);

-- Allow anonymous users to delete articles
CREATE POLICY "Allow anonymous to delete articles"
  ON articles
  FOR DELETE
  TO anon
  USING (true);
