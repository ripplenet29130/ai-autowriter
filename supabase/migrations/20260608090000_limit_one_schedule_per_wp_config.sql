DO $$
DECLARE
  has_account_id boolean;
  has_wp_config_id boolean;
  has_wordpress_config_id boolean;
  has_duplicates boolean;
BEGIN
  SELECT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'schedule_settings'
      AND column_name = 'account_id'
  ) INTO has_account_id;

  SELECT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'schedule_settings'
      AND column_name = 'wp_config_id'
  ) INTO has_wp_config_id;

  SELECT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'schedule_settings'
      AND column_name = 'wordpress_config_id'
  ) INTO has_wordpress_config_id;

  IF has_wp_config_id AND has_account_id THEN
    EXECUTE '
      SELECT EXISTS (
        SELECT 1
        FROM public.schedule_settings
        WHERE wp_config_id IS NOT NULL
        GROUP BY coalesce(account_id, ''00000000-0000-0000-0000-000000000000''::uuid), wp_config_id
        HAVING count(*) > 1
      )
    ' INTO has_duplicates;

    IF has_duplicates THEN
      RAISE NOTICE 'Skipping unique schedule index because legacy account/wp_config duplicates exist';
    ELSE
      EXECUTE '
        CREATE UNIQUE INDEX IF NOT EXISTS idx_schedule_settings_account_wp_config_unique
        ON public.schedule_settings((coalesce(account_id, ''00000000-0000-0000-0000-000000000000''::uuid)), wp_config_id)
        WHERE wp_config_id IS NOT NULL
      ';
    END IF;
  ELSIF has_wp_config_id THEN
    EXECUTE '
      SELECT EXISTS (
        SELECT 1
        FROM public.schedule_settings
        WHERE wp_config_id IS NOT NULL
        GROUP BY wp_config_id
        HAVING count(*) > 1
      )
    ' INTO has_duplicates;

    IF has_duplicates THEN
      RAISE NOTICE 'Skipping unique schedule index because legacy wp_config duplicates exist';
    ELSE
      EXECUTE '
        CREATE UNIQUE INDEX IF NOT EXISTS idx_schedule_settings_wp_config_unique
        ON public.schedule_settings(wp_config_id)
        WHERE wp_config_id IS NOT NULL
      ';
    END IF;
  ELSIF has_wordpress_config_id AND has_account_id THEN
    EXECUTE '
      SELECT EXISTS (
        SELECT 1
        FROM public.schedule_settings
        WHERE wordpress_config_id IS NOT NULL
        GROUP BY coalesce(account_id, ''00000000-0000-0000-0000-000000000000''::uuid), wordpress_config_id
        HAVING count(*) > 1
      )
    ' INTO has_duplicates;

    IF has_duplicates THEN
      RAISE NOTICE 'Skipping unique schedule index because legacy account/wordpress_config duplicates exist';
    ELSE
      EXECUTE '
        CREATE UNIQUE INDEX IF NOT EXISTS idx_schedule_settings_account_wordpress_config_unique
        ON public.schedule_settings((coalesce(account_id, ''00000000-0000-0000-0000-000000000000''::uuid)), wordpress_config_id)
        WHERE wordpress_config_id IS NOT NULL
      ';
    END IF;
  ELSIF has_wordpress_config_id THEN
    EXECUTE '
      SELECT EXISTS (
        SELECT 1
        FROM public.schedule_settings
        WHERE wordpress_config_id IS NOT NULL
        GROUP BY wordpress_config_id
        HAVING count(*) > 1
      )
    ' INTO has_duplicates;

    IF has_duplicates THEN
      RAISE NOTICE 'Skipping unique schedule index because legacy wordpress_config duplicates exist';
    ELSE
      EXECUTE '
        CREATE UNIQUE INDEX IF NOT EXISTS idx_schedule_settings_wordpress_config_unique
        ON public.schedule_settings(wordpress_config_id)
        WHERE wordpress_config_id IS NOT NULL
      ';
    END IF;
  ELSE
    RAISE EXCEPTION 'schedule_settings has neither wp_config_id nor wordpress_config_id';
  END IF;
END $$;
