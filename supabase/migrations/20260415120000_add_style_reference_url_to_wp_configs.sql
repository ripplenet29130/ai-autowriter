ALTER TABLE public.wordpress_configs
ADD COLUMN IF NOT EXISTS style_reference_url TEXT;

ALTER TABLE public.wp_configs
ADD COLUMN IF NOT EXISTS style_reference_url TEXT;

COMMENT ON COLUMN public.wordpress_configs.style_reference_url IS
'Reference URL used to infer site-specific writing style for generated articles.';

COMMENT ON COLUMN public.wp_configs.style_reference_url IS
'Reference URL used to infer site-specific writing style for generated articles.';
