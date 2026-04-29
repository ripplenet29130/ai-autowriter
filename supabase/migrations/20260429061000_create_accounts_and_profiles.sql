-- Create account and profile foundations for admin/client externalization.

CREATE TABLE IF NOT EXISTS public.accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  status text NOT NULL DEFAULT 'active',
  wordpress_site_limit integer NOT NULL DEFAULT 1,
  feature_flags jsonb NOT NULL DEFAULT '{}'::jsonb,
  monthly_article_limit integer,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT accounts_status_check CHECK (status IN ('active', 'suspended')),
  CONSTRAINT accounts_wordpress_site_limit_check CHECK (wordpress_site_limit >= 0),
  CONSTRAINT accounts_monthly_article_limit_check CHECK (
    monthly_article_limit IS NULL OR monthly_article_limit >= 0
  )
);

CREATE INDEX IF NOT EXISTS idx_accounts_status ON public.accounts(status);
CREATE INDEX IF NOT EXISTS idx_accounts_created_at ON public.accounts(created_at DESC);

CREATE TABLE IF NOT EXISTS public.profiles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
  account_id uuid REFERENCES public.accounts(id) ON DELETE SET NULL,
  role text NOT NULL,
  display_name text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT profiles_role_check CHECK (role IN ('admin', 'client')),
  CONSTRAINT profiles_client_requires_account_check CHECK (
    role <> 'client' OR account_id IS NOT NULL
  )
);

CREATE INDEX IF NOT EXISTS idx_profiles_account_id ON public.profiles(account_id);
CREATE INDEX IF NOT EXISTS idx_profiles_role ON public.profiles(role);

CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS trigger AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS update_accounts_updated_at ON public.accounts;
CREATE TRIGGER update_accounts_updated_at
  BEFORE UPDATE ON public.accounts
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

DROP TRIGGER IF EXISTS update_profiles_updated_at ON public.profiles;
CREATE TRIGGER update_profiles_updated_at
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

ALTER TABLE public.accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.current_profile_role()
RETURNS text
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT role
  FROM public.profiles
  WHERE user_id = auth.uid()
  LIMIT 1
$$;

CREATE OR REPLACE FUNCTION public.current_profile_account_id()
RETURNS uuid
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT account_id
  FROM public.profiles
  WHERE user_id = auth.uid()
  LIMIT 1
$$;

CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(public.current_profile_role() = 'admin', false)
$$;

DROP POLICY IF EXISTS "Admins can manage accounts" ON public.accounts;
CREATE POLICY "Admins can manage accounts"
  ON public.accounts
  FOR ALL
  TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS "Clients can view own account" ON public.accounts;
CREATE POLICY "Clients can view own account"
  ON public.accounts
  FOR SELECT
  TO authenticated
  USING (id = public.current_profile_account_id());

DROP POLICY IF EXISTS "Admins can manage profiles" ON public.profiles;
CREATE POLICY "Admins can manage profiles"
  ON public.profiles
  FOR ALL
  TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS "Users can view own profile" ON public.profiles;
CREATE POLICY "Users can view own profile"
  ON public.profiles
  FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());

INSERT INTO public.profiles (user_id, role, display_name)
SELECT u.id, 'admin', COALESCE(u.raw_user_meta_data->>'full_name', u.email)
FROM auth.users u
WHERE lower(u.email) = lower('cev29130@gmail.com')
ON CONFLICT (user_id) DO UPDATE
SET role = 'admin',
    account_id = NULL,
    display_name = COALESCE(EXCLUDED.display_name, public.profiles.display_name),
    updated_at = now();
