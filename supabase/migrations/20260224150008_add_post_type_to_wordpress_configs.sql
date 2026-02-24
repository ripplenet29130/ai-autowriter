-- Add post_type column to wordpress_configs table
ALTER TABLE wordpress_configs 
ADD COLUMN IF NOT EXISTS post_type text DEFAULT 'posts';

-- Add comment for documentation
COMMENT ON COLUMN wordpress_configs.post_type IS 'WordPress post type (posts, pages, or custom post type slug)';
