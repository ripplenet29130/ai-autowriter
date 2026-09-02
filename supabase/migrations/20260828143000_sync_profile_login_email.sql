-- Keep the email shown to administrators in sync with the email that Auth
-- actually uses for password sign-in.

CREATE OR REPLACE FUNCTION public.sync_profile_login_email()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.profiles
  SET
    login_email = NEW.email,
    updated_at = now()
  WHERE user_id = NEW.id
    AND login_email IS DISTINCT FROM NEW.email;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS sync_profile_login_email_on_auth_user_update ON auth.users;
CREATE TRIGGER sync_profile_login_email_on_auth_user_update
  AFTER UPDATE OF email ON auth.users
  FOR EACH ROW
  WHEN (OLD.email IS DISTINCT FROM NEW.email)
  EXECUTE FUNCTION public.sync_profile_login_email();

-- Repair the confirmed existing mismatch without modifying other legacy rows.
UPDATE public.profiles AS p
SET
  login_email = u.email,
  updated_at = now()
FROM auth.users AS u
WHERE p.user_id = u.id
  AND p.login_email = '001flag@gmail.com'
  AND u.email = 'flag.adm001@gmail.com';
