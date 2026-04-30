-- Allow each account to store its own app_settings keys.
-- The original table used key as the primary key, which prevents multiple clients
-- from saving the same setting name independently.

ALTER TABLE IF EXISTS public.app_settings
  ADD COLUMN IF NOT EXISTS id uuid DEFAULT gen_random_uuid();

UPDATE public.app_settings
SET id = gen_random_uuid()
WHERE id IS NULL;

ALTER TABLE IF EXISTS public.app_settings
  ALTER COLUMN id SET NOT NULL;

ALTER TABLE IF EXISTS public.app_settings
  DROP CONSTRAINT IF EXISTS app_settings_pkey;

ALTER TABLE IF EXISTS public.app_settings
  ADD CONSTRAINT app_settings_pkey PRIMARY KEY (id);

ALTER TABLE IF EXISTS public.app_settings
  DROP CONSTRAINT IF EXISTS app_settings_account_key_unique;

ALTER TABLE IF EXISTS public.app_settings
  ADD CONSTRAINT app_settings_account_key_unique UNIQUE (account_id, key);

CREATE INDEX IF NOT EXISTS idx_app_settings_account_key
  ON public.app_settings(account_id, key);
