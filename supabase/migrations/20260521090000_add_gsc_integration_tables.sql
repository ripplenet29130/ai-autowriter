-- Add Google Search Console integration tables.
-- Phase 2 of docs/search-console-integration-plan.md.

CREATE TABLE IF NOT EXISTS public.gsc_tokens (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  account_id uuid REFERENCES public.accounts(id) ON DELETE CASCADE,
  provider_token text NOT NULL,
  provider_refresh_token text,
  expires_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_gsc_tokens_account_id
  ON public.gsc_tokens(account_id);

CREATE INDEX IF NOT EXISTS idx_gsc_tokens_expires_at
  ON public.gsc_tokens(expires_at);

DROP TRIGGER IF EXISTS update_gsc_tokens_updated_at ON public.gsc_tokens;
CREATE TRIGGER update_gsc_tokens_updated_at
  BEFORE UPDATE ON public.gsc_tokens
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

ALTER TABLE public.gsc_tokens ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admins can manage gsc_tokens" ON public.gsc_tokens;
CREATE POLICY "Admins can manage gsc_tokens"
  ON public.gsc_tokens
  FOR ALL
  TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS "Users can select own gsc_tokens" ON public.gsc_tokens;
CREATE POLICY "Users can select own gsc_tokens"
  ON public.gsc_tokens
  FOR SELECT
  TO authenticated
  USING (
    user_id = auth.uid()
    AND account_id = public.current_profile_account_id()
  );

DROP POLICY IF EXISTS "Users can insert own gsc_tokens" ON public.gsc_tokens;
CREATE POLICY "Users can insert own gsc_tokens"
  ON public.gsc_tokens
  FOR INSERT
  TO authenticated
  WITH CHECK (
    user_id = auth.uid()
    AND account_id = public.current_profile_account_id()
  );

DROP POLICY IF EXISTS "Users can update own gsc_tokens" ON public.gsc_tokens;
CREATE POLICY "Users can update own gsc_tokens"
  ON public.gsc_tokens
  FOR UPDATE
  TO authenticated
  USING (
    user_id = auth.uid()
    AND account_id = public.current_profile_account_id()
  )
  WITH CHECK (
    user_id = auth.uid()
    AND account_id = public.current_profile_account_id()
  );

DROP POLICY IF EXISTS "Users can delete own gsc_tokens" ON public.gsc_tokens;
CREATE POLICY "Users can delete own gsc_tokens"
  ON public.gsc_tokens
  FOR DELETE
  TO authenticated
  USING (
    user_id = auth.uid()
    AND account_id = public.current_profile_account_id()
  );

CREATE TABLE IF NOT EXISTS public.gsc_property_statuses (
  wordpress_config_id uuid PRIMARY KEY REFERENCES public.wordpress_configs(id) ON DELETE CASCADE,
  account_id uuid REFERENCES public.accounts(id) ON DELETE CASCADE,
  verified boolean NOT NULL DEFAULT false,
  matched_property_url text,
  checked_at timestamptz,
  error_code text,
  error_message text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_gsc_property_statuses_account_id
  ON public.gsc_property_statuses(account_id);

CREATE INDEX IF NOT EXISTS idx_gsc_property_statuses_verified
  ON public.gsc_property_statuses(verified);

CREATE INDEX IF NOT EXISTS idx_gsc_property_statuses_checked_at
  ON public.gsc_property_statuses(checked_at DESC);

DROP TRIGGER IF EXISTS update_gsc_property_statuses_updated_at ON public.gsc_property_statuses;
CREATE TRIGGER update_gsc_property_statuses_updated_at
  BEFORE UPDATE ON public.gsc_property_statuses
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

ALTER TABLE public.gsc_property_statuses ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admins can manage gsc_property_statuses" ON public.gsc_property_statuses;
CREATE POLICY "Admins can manage gsc_property_statuses"
  ON public.gsc_property_statuses
  FOR ALL
  TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS "Clients can select own gsc_property_statuses" ON public.gsc_property_statuses;
CREATE POLICY "Clients can select own gsc_property_statuses"
  ON public.gsc_property_statuses
  FOR SELECT
  TO authenticated
  USING (account_id = public.current_profile_account_id());

DROP POLICY IF EXISTS "Clients can insert own gsc_property_statuses" ON public.gsc_property_statuses;
CREATE POLICY "Clients can insert own gsc_property_statuses"
  ON public.gsc_property_statuses
  FOR INSERT
  TO authenticated
  WITH CHECK (account_id = public.current_profile_account_id());

DROP POLICY IF EXISTS "Clients can update own gsc_property_statuses" ON public.gsc_property_statuses;
CREATE POLICY "Clients can update own gsc_property_statuses"
  ON public.gsc_property_statuses
  FOR UPDATE
  TO authenticated
  USING (account_id = public.current_profile_account_id())
  WITH CHECK (account_id = public.current_profile_account_id());

DROP POLICY IF EXISTS "Clients can delete own gsc_property_statuses" ON public.gsc_property_statuses;
CREATE POLICY "Clients can delete own gsc_property_statuses"
  ON public.gsc_property_statuses
  FOR DELETE
  TO authenticated
  USING (account_id = public.current_profile_account_id());

COMMENT ON TABLE public.gsc_tokens IS
  'Stores Google Search Console OAuth tokens for authenticated users.';

COMMENT ON COLUMN public.gsc_tokens.provider_token IS
  'Google OAuth access token with Search Console readonly scope.';

COMMENT ON COLUMN public.gsc_tokens.provider_refresh_token IS
  'Google OAuth refresh token. Google may only return this on the first consent flow.';

COMMENT ON TABLE public.gsc_property_statuses IS
  'Stores Search Console property match status for WordPress configurations.';

COMMENT ON COLUMN public.gsc_property_statuses.wordpress_config_id IS
  'Parent WordPress configuration in public.wordpress_configs.';

COMMENT ON COLUMN public.gsc_property_statuses.matched_property_url IS
  'Matched Search Console URL prefix or sc-domain property identifier.';
