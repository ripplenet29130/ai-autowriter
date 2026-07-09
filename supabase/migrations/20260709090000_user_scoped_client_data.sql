-- Separate client data by login user while keeping account_id for account/admin grouping.
-- Existing rows are intentionally not backfilled; admins can review and migrate them manually.

DO $$
DECLARE
  target_table text;
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
  FOREACH target_table IN ARRAY target_tables LOOP
    IF to_regclass('public.' || target_table) IS NULL THEN
      RAISE NOTICE 'Skipping %. Table does not exist.', target_table;
      CONTINUE;
    END IF;

    EXECUTE format(
      'ALTER TABLE public.%I ADD COLUMN IF NOT EXISTS user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL',
      target_table
    );

    EXECUTE format(
      'CREATE INDEX IF NOT EXISTS %I ON public.%I(user_id)',
      'idx_' || target_table || '_user_id',
      target_table
    );

    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', target_table);

    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', format('Admins can manage %s', target_table), target_table);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', format('Clients can select own %s', target_table), target_table);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', format('Clients can insert own %s', target_table), target_table);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', format('Clients can update own %s', target_table), target_table);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', format('Clients can delete own %s', target_table), target_table);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', format('Clients can select own user %s', target_table), target_table);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', format('Clients can insert own user %s', target_table), target_table);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', format('Clients can update own user %s', target_table), target_table);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', format('Clients can delete own user %s', target_table), target_table);

    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR ALL TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin())',
      format('Admins can manage %s', target_table),
      target_table
    );

    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR SELECT TO authenticated USING (user_id = auth.uid())',
      format('Clients can select own user %s', target_table),
      target_table
    );

    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid())',
      format('Clients can insert own user %s', target_table),
      target_table
    );

    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR UPDATE TO authenticated USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid())',
      format('Clients can update own user %s', target_table),
      target_table
    );

    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR DELETE TO authenticated USING (user_id = auth.uid())',
      format('Clients can delete own user %s', target_table),
      target_table
    );
  END LOOP;
END $$;

DO $$
BEGIN
  IF to_regclass('public.gsc_tokens') IS NOT NULL THEN
    DROP INDEX IF EXISTS public.idx_gsc_tokens_account_id_unique;
    CREATE UNIQUE INDEX IF NOT EXISTS idx_gsc_tokens_user_id_unique
      ON public.gsc_tokens(user_id)
      WHERE user_id IS NOT NULL;
  END IF;
END $$;

ALTER TABLE IF EXISTS public.app_settings
  DROP CONSTRAINT IF EXISTS app_settings_account_key_unique;

ALTER TABLE IF EXISTS public.app_settings
  DROP CONSTRAINT IF EXISTS app_settings_user_key_unique;

ALTER TABLE IF EXISTS public.app_settings
  ADD CONSTRAINT app_settings_user_key_unique UNIQUE (user_id, key);

DROP INDEX IF EXISTS public.idx_app_settings_account_key;
CREATE INDEX IF NOT EXISTS idx_app_settings_user_key
  ON public.app_settings(user_id, key);

DROP INDEX IF EXISTS public.idx_schedule_settings_account_wp_config_unique;
DROP INDEX IF EXISTS public.idx_schedule_settings_account_wordpress_config_unique;

DO $$
DECLARE
  has_wp_config_id boolean;
  has_wordpress_config_id boolean;
BEGIN
  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'schedule_settings'
      AND column_name = 'wp_config_id'
  ) INTO has_wp_config_id;

  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'schedule_settings'
      AND column_name = 'wordpress_config_id'
  ) INTO has_wordpress_config_id;

  IF has_wp_config_id THEN
    EXECUTE '
      CREATE UNIQUE INDEX IF NOT EXISTS idx_schedule_settings_user_wp_config_unique
      ON public.schedule_settings((coalesce(user_id, ''00000000-0000-0000-0000-000000000000''::uuid)), wp_config_id)
      WHERE user_id IS NOT NULL AND wp_config_id IS NOT NULL
    ';
  END IF;

  IF has_wordpress_config_id THEN
    EXECUTE '
      CREATE UNIQUE INDEX IF NOT EXISTS idx_schedule_settings_user_wordpress_config_unique
      ON public.schedule_settings((coalesce(user_id, ''00000000-0000-0000-0000-000000000000''::uuid)), wordpress_config_id)
      WHERE user_id IS NOT NULL AND wordpress_config_id IS NOT NULL
    ';
  END IF;
END $$;
