/*
  # Add WordPress integration fields to articles table

  1. Changes
    - Add `is_published` column to track if article is published to WordPress
      - Type: boolean
      - Default: false
      - Indicates whether the article has been published to WordPress
    
    - Add `wordpress_url` column to store the WordPress post URL
      - Type: text
      - Nullable: true
      - Stores the full URL of the published WordPress post
  
  2. Purpose
    - Enable tracking of WordPress publication status
    - Store WordPress post URLs for direct access
    - Allow filtering between published and unpublished articles
*/

-- Add is_published column if it doesn't exist
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'articles' AND column_name = 'is_published'
  ) THEN
    ALTER TABLE articles ADD COLUMN is_published boolean DEFAULT false;
  END IF;
END $$;

-- Add wordpress_url column if it doesn't exist
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'articles' AND column_name = 'wordpress_url'
  ) THEN
    ALTER TABLE articles ADD COLUMN wordpress_url text;
  END IF;
END $$;

-- Create index for faster queries on published articles
CREATE INDEX IF NOT EXISTS idx_articles_is_published ON articles(is_published);
