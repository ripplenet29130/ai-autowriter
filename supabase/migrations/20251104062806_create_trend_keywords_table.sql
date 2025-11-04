/*
  # Create trend_keywords table for keyword analysis

  1. New Tables
    - `trend_keywords`
      - `id` (uuid, primary key) - Unique identifier
      - `keyword` (text) - Original keyword entered by user
      - `related_keywords` (text[]) - Array of AI-suggested related keywords
      - `source` (text) - Source of keywords (e.g., "gemini", "google_trends")
      - `created_at` (timestamptz) - Timestamp when keyword was saved

  2. Security
    - Enable RLS on `trend_keywords` table
    - Add policy for anonymous users to insert, read, and delete keywords

  3. Notes
    - This table stores keyword analysis results from AI
    - Related keywords will be used for automated article generation
    - Future integration with scheduler for automatic posting
*/

-- Create trend_keywords table
CREATE TABLE IF NOT EXISTS trend_keywords (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  keyword text NOT NULL,
  related_keywords text[] DEFAULT '{}',
  source text DEFAULT 'gemini' CHECK (source IN ('gemini', 'google_trends', 'manual')),
  created_at timestamptz DEFAULT now()
);

-- Create index for faster keyword lookups
CREATE INDEX IF NOT EXISTS idx_trend_keywords_keyword ON trend_keywords(keyword);
CREATE INDEX IF NOT EXISTS idx_trend_keywords_created_at ON trend_keywords(created_at DESC);

-- Enable RLS
ALTER TABLE trend_keywords ENABLE ROW LEVEL SECURITY;

-- Allow anonymous users to insert keywords
CREATE POLICY "Allow anonymous to insert trend keywords"
  ON trend_keywords
  FOR INSERT
  TO anon
  WITH CHECK (true);

-- Allow anonymous users to read keywords
CREATE POLICY "Allow anonymous to read trend keywords"
  ON trend_keywords
  FOR SELECT
  TO anon
  USING (true);

-- Allow anonymous users to delete keywords
CREATE POLICY "Allow anonymous to delete trend keywords"
  ON trend_keywords
  FOR DELETE
  TO anon
  USING (true);
