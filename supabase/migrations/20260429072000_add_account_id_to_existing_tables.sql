-- Add account ownership to existing data without deleting or restricting rows.

INSERT INTO public.accounts (
  id,
  name,
  status,
  wordpress_site_limit,
  feature_flags,
  monthly_article_limit
)
VALUES (
  '00000000-0000-0000-0000-000000000001',
  'Default Account',
  'active',
  10,
  '{
    "wordpress_publish": true,
    "scheduler": true,
    "image_generation": true,
    "fact_check": true
  }'::jsonb,
  NULL
)
ON CONFLICT (id) DO UPDATE
SET name = EXCLUDED.name,
    status = EXCLUDED.status,
    wordpress_site_limit = EXCLUDED.wordpress_site_limit,
    feature_flags = EXCLUDED.feature_flags,
    updated_at = now();

ALTER TABLE IF EXISTS public.articles
  ADD COLUMN IF NOT EXISTS account_id uuid REFERENCES public.accounts(id) ON DELETE SET NULL;
ALTER TABLE IF EXISTS public.wordpress_configs
  ADD COLUMN IF NOT EXISTS account_id uuid REFERENCES public.accounts(id) ON DELETE SET NULL;
ALTER TABLE IF EXISTS public.wp_configs
  ADD COLUMN IF NOT EXISTS account_id uuid REFERENCES public.accounts(id) ON DELETE SET NULL;
ALTER TABLE IF EXISTS public.ai_configs
  ADD COLUMN IF NOT EXISTS account_id uuid REFERENCES public.accounts(id) ON DELETE SET NULL;
ALTER TABLE IF EXISTS public.schedule_settings
  ADD COLUMN IF NOT EXISTS account_id uuid REFERENCES public.accounts(id) ON DELETE SET NULL;
ALTER TABLE IF EXISTS public.execution_history
  ADD COLUMN IF NOT EXISTS account_id uuid REFERENCES public.accounts(id) ON DELETE SET NULL;
ALTER TABLE IF EXISTS public.keyword_sets
  ADD COLUMN IF NOT EXISTS account_id uuid REFERENCES public.accounts(id) ON DELETE SET NULL;
ALTER TABLE IF EXISTS public.keywords
  ADD COLUMN IF NOT EXISTS account_id uuid REFERENCES public.accounts(id) ON DELETE SET NULL;
ALTER TABLE IF EXISTS public.prompt_sets
  ADD COLUMN IF NOT EXISTS account_id uuid REFERENCES public.accounts(id) ON DELETE SET NULL;
ALTER TABLE IF EXISTS public.title_sets
  ADD COLUMN IF NOT EXISTS account_id uuid REFERENCES public.accounts(id) ON DELETE SET NULL;
ALTER TABLE IF EXISTS public.app_settings
  ADD COLUMN IF NOT EXISTS account_id uuid REFERENCES public.accounts(id) ON DELETE SET NULL;
ALTER TABLE IF EXISTS public.fact_check_settings
  ADD COLUMN IF NOT EXISTS account_id uuid REFERENCES public.accounts(id) ON DELETE SET NULL;
ALTER TABLE IF EXISTS public.fact_check_results
  ADD COLUMN IF NOT EXISTS account_id uuid REFERENCES public.accounts(id) ON DELETE SET NULL;
ALTER TABLE IF EXISTS public.generation_regression_results
  ADD COLUMN IF NOT EXISTS account_id uuid REFERENCES public.accounts(id) ON DELETE SET NULL;
ALTER TABLE IF EXISTS public.competitor_research
  ADD COLUMN IF NOT EXISTS account_id uuid REFERENCES public.accounts(id) ON DELETE SET NULL;
ALTER TABLE IF EXISTS public.facts_cache
  ADD COLUMN IF NOT EXISTS account_id uuid REFERENCES public.accounts(id) ON DELETE SET NULL;
ALTER TABLE IF EXISTS public.schedule_used_keywords
  ADD COLUMN IF NOT EXISTS account_id uuid REFERENCES public.accounts(id) ON DELETE SET NULL;
ALTER TABLE IF EXISTS public.scheduler_execution_locks
  ADD COLUMN IF NOT EXISTS account_id uuid REFERENCES public.accounts(id) ON DELETE SET NULL;
ALTER TABLE IF EXISTS public.scheduler_lock
  ADD COLUMN IF NOT EXISTS account_id uuid REFERENCES public.accounts(id) ON DELETE SET NULL;
ALTER TABLE IF EXISTS public.trend_keywords
  ADD COLUMN IF NOT EXISTS account_id uuid REFERENCES public.accounts(id) ON DELETE SET NULL;
ALTER TABLE IF EXISTS public.custom_topics
  ADD COLUMN IF NOT EXISTS account_id uuid REFERENCES public.accounts(id) ON DELETE SET NULL;
ALTER TABLE IF EXISTS public.generation_prompts
  ADD COLUMN IF NOT EXISTS account_id uuid REFERENCES public.accounts(id) ON DELETE SET NULL;

DO $$
DECLARE
  table_name text;
  target_tables text[] := ARRAY[
    'articles',
    'wordpress_configs',
    'wp_configs',
    'ai_configs',
    'schedule_settings',
    'execution_history',
    'keyword_sets',
    'keywords',
    'prompt_sets',
    'title_sets',
    'app_settings',
    'fact_check_settings',
    'fact_check_results',
    'generation_regression_results',
    'competitor_research',
    'facts_cache',
    'schedule_used_keywords',
    'scheduler_execution_locks',
    'scheduler_lock',
    'trend_keywords',
    'custom_topics',
    'generation_prompts'
  ];
BEGIN
  FOREACH table_name IN ARRAY target_tables LOOP
    IF to_regclass('public.' || table_name) IS NOT NULL THEN
      EXECUTE format(
        'UPDATE public.%I SET account_id = $1 WHERE account_id IS NULL',
        table_name
      )
      USING '00000000-0000-0000-0000-000000000001'::uuid;
    END IF;
  END LOOP;
END $$;

DO $$
DECLARE
  table_name text;
  target_tables text[] := ARRAY[
    'articles',
    'wordpress_configs',
    'wp_configs',
    'ai_configs',
    'schedule_settings',
    'execution_history',
    'keyword_sets',
    'keywords',
    'prompt_sets',
    'title_sets',
    'app_settings',
    'fact_check_settings',
    'fact_check_results',
    'generation_regression_results',
    'competitor_research',
    'facts_cache',
    'schedule_used_keywords',
    'scheduler_execution_locks',
    'scheduler_lock',
    'trend_keywords',
    'custom_topics',
    'generation_prompts'
  ];
BEGIN
  FOREACH table_name IN ARRAY target_tables LOOP
    IF to_regclass('public.' || table_name) IS NOT NULL THEN
      EXECUTE format(
        'CREATE INDEX IF NOT EXISTS %I ON public.%I(account_id)',
        'idx_' || table_name || '_account_id',
        table_name
      );
    END IF;
  END LOOP;
END $$;
