-- Replace broad public/anon access with account-scoped RLS policies.
-- Apply after account_id has been backfilled and the app reads/writes with account_id.

DO $$
DECLARE
  target_table text;
  policy_name text;
BEGIN
  FOREACH target_table IN ARRAY ARRAY[
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
    'trend_keywords'
  ]
  LOOP
    IF to_regclass('public.' || target_table) IS NULL THEN
      RAISE NOTICE 'Skipping %. Table does not exist.', target_table;
      CONTINUE;
    END IF;

    IF NOT EXISTS (
      SELECT 1
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = target_table
        AND column_name = 'account_id'
    ) THEN
      RAISE NOTICE 'Skipping %. account_id column does not exist.', target_table;
      CONTINUE;
    END IF;

    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', target_table);

    FOR policy_name IN
      SELECT policyname
      FROM pg_policies
      WHERE schemaname = 'public'
        AND tablename = target_table
        AND (
          policyname ILIKE 'Allow all%'
          OR policyname ILIKE 'Allow public%'
          OR policyname IN (
            'Allow anon access',
            'Allow authenticated access',
            'Anyone can view fact check results',
            'Users can view their own fact check settings',
            'Users can insert their own fact check settings',
            'Users can update their own fact check settings',
            'Users can view their own fact check results'
          )
          OR policyname = format('Admins can manage %s', target_table)
          OR policyname = format('Clients can select own %s', target_table)
          OR policyname = format('Clients can insert own %s', target_table)
          OR policyname = format('Clients can update own %s', target_table)
          OR policyname = format('Clients can delete own %s', target_table)
        )
    LOOP
      EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', policy_name, target_table);
    END LOOP;

    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR ALL TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin())',
      format('Admins can manage %s', target_table),
      target_table
    );

    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR SELECT TO authenticated USING (account_id = public.current_profile_account_id())',
      format('Clients can select own %s', target_table),
      target_table
    );

    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR INSERT TO authenticated WITH CHECK (account_id = public.current_profile_account_id())',
      format('Clients can insert own %s', target_table),
      target_table
    );

    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR UPDATE TO authenticated USING (account_id = public.current_profile_account_id()) WITH CHECK (account_id = public.current_profile_account_id())',
      format('Clients can update own %s', target_table),
      target_table
    );

    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR DELETE TO authenticated USING (account_id = public.current_profile_account_id())',
      format('Clients can delete own %s', target_table),
      target_table
    );
  END LOOP;
END $$;
