-- Add temporary OAuth state storage for standalone Google Search Console OAuth.

CREATE TABLE IF NOT EXISTS public.gsc_oauth_states (
  state text PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  account_id uuid REFERENCES public.accounts(id) ON DELETE CASCADE,
  redirect_to text NOT NULL,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_gsc_oauth_states_user_id
  ON public.gsc_oauth_states(user_id);

CREATE INDEX IF NOT EXISTS idx_gsc_oauth_states_expires_at
  ON public.gsc_oauth_states(expires_at);

ALTER TABLE public.gsc_oauth_states ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admins can manage gsc_oauth_states" ON public.gsc_oauth_states;
CREATE POLICY "Admins can manage gsc_oauth_states"
  ON public.gsc_oauth_states
  FOR ALL
  TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS "Users can select own gsc_oauth_states" ON public.gsc_oauth_states;
CREATE POLICY "Users can select own gsc_oauth_states"
  ON public.gsc_oauth_states
  FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());

DROP POLICY IF EXISTS "Users can insert own gsc_oauth_states" ON public.gsc_oauth_states;
CREATE POLICY "Users can insert own gsc_oauth_states"
  ON public.gsc_oauth_states
  FOR INSERT
  TO authenticated
  WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS "Users can delete own gsc_oauth_states" ON public.gsc_oauth_states;
CREATE POLICY "Users can delete own gsc_oauth_states"
  ON public.gsc_oauth_states
  FOR DELETE
  TO authenticated
  USING (user_id = auth.uid());

COMMENT ON TABLE public.gsc_oauth_states IS
  'Temporary state values for standalone Google Search Console OAuth callbacks.';
