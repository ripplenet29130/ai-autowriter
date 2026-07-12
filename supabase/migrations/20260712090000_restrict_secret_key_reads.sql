-- クライアント(anon/authenticated)からシークレット列を SELECT 不可にする。
-- 書き込み(INSERT/UPDATE/DELETE)は引き続き可能。値の利用は Edge Function が service role で行う。
-- service_role はテーブル全体の権限を保持するため影響なし。

-- クライアントコードが明示 SELECT するカラムを確実に存在させる（無いと PostgREST が 400 を返すため）
ALTER TABLE IF EXISTS public.ai_configs
  ADD COLUMN IF NOT EXISTS image_enabled boolean DEFAULT false;
ALTER TABLE IF EXISTS public.ai_configs
  ADD COLUMN IF NOT EXISTS image_provider text;
ALTER TABLE IF EXISTS public.fact_check_settings
  ADD COLUMN IF NOT EXISTS model_name text;
ALTER TABLE IF EXISTS public.fact_check_settings
  ADD COLUMN IF NOT EXISTS auto_fix_enabled boolean DEFAULT false;

-- カラム単位の SELECT 権限: シークレット列以外の全カラムを列挙して付与する
DO $$
DECLARE
  cols text;
BEGIN
  IF to_regclass('public.ai_configs') IS NOT NULL THEN
    SELECT string_agg(quote_ident(column_name), ', ')
    INTO cols
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'ai_configs'
      AND column_name <> 'api_key';

    REVOKE SELECT ON public.ai_configs FROM anon, authenticated;
    EXECUTE format('GRANT SELECT (%s) ON public.ai_configs TO authenticated', cols);
  END IF;

  IF to_regclass('public.fact_check_settings') IS NOT NULL THEN
    SELECT string_agg(quote_ident(column_name), ', ')
    INTO cols
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'fact_check_settings'
      AND column_name <> 'perplexity_api_key';

    REVOKE SELECT ON public.fact_check_settings FROM anon, authenticated;
    EXECUTE format('GRANT SELECT (%s) ON public.fact_check_settings TO authenticated', cols);
  END IF;
END $$;

-- app_settings に平文で残っている Perplexity キーを fact_check_settings へ移動して削除する。
-- （app_settings は key-value 構造のため列単位で保護できない）
DO $$
BEGIN
  IF to_regclass('public.fact_check_settings') IS NULL OR to_regclass('public.app_settings') IS NULL THEN
    RETURN;
  END IF;

  -- 既に fact_check_settings 行がある user は、キーが空の場合のみ app_settings の値で埋める
  UPDATE public.fact_check_settings fcs
  SET perplexity_api_key = aps.value
  FROM public.app_settings aps
  WHERE aps.key = 'perplexity_api_key'
    AND aps.user_id = fcs.user_id
    AND COALESCE(fcs.perplexity_api_key, '') = ''
    AND COALESCE(aps.value, '') <> '';

  -- fact_check_settings 行が無い user の分は新規作成する
  INSERT INTO public.fact_check_settings (user_id, account_id, enabled, perplexity_api_key)
  SELECT
    aps.user_id,
    aps.account_id,
    COALESCE((
      SELECT lower(a2.value) IN ('1', 'true', 'yes', 'on')
      FROM public.app_settings a2
      WHERE a2.key = 'fact_check_enabled' AND a2.user_id = aps.user_id
      LIMIT 1
    ), true),
    aps.value
  FROM public.app_settings aps
  WHERE aps.key = 'perplexity_api_key'
    AND COALESCE(aps.value, '') <> ''
    AND aps.user_id IS NOT NULL
    AND NOT EXISTS (
      SELECT 1 FROM public.fact_check_settings f WHERE f.user_id = aps.user_id
    );

  -- 平文コピーを削除
  DELETE FROM public.app_settings WHERE key = 'perplexity_api_key';
END $$;
