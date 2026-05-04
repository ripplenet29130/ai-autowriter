-- Store the client login email on profiles so admin screens can show it without
-- reading auth.users from the browser.

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS login_email text;

UPDATE public.profiles AS p
SET login_email = u.email
FROM auth.users AS u
WHERE p.user_id = u.id
  AND p.login_email IS NULL;

CREATE INDEX IF NOT EXISTS idx_profiles_login_email ON public.profiles(login_email);
