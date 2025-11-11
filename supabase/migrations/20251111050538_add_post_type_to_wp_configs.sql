/*
  # Add post_type field to wp_configs table

  1. Changes
    - Add `post_type` column to wp_configs table with default value 'post'
    - This field allows users to specify custom post types (e.g., 'product', 'event')
    - Either default_category or post_type can be used when posting to WordPress

  2. Notes
    - post_type defaults to 'post' (standard WordPress post type)
    - Users can specify custom post types registered in their WordPress site
*/

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'wp_configs' AND column_name = 'post_type'
  ) THEN
    ALTER TABLE wp_configs ADD COLUMN post_type text DEFAULT 'post';
  END IF;
END $$;