-- Keep the legacy Netlify app working after account-scoped RLS was introduced.
-- The legacy app has no login/account context, so it cannot satisfy the new
-- authenticated account_id policies. This policy only opens prompt_sets for
-- anon/public legacy use, matching the pre-externalization behavior.

ALTER TABLE IF EXISTS public.prompt_sets ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Legacy Netlify can manage prompt sets" ON public.prompt_sets;
CREATE POLICY "Legacy Netlify can manage prompt sets"
  ON public.prompt_sets
  FOR ALL
  TO anon
  USING (
    account_id IS NULL
    OR account_id = '00000000-0000-0000-0000-000000000001'::uuid
  )
  WITH CHECK (
    account_id IS NULL
    OR account_id = '00000000-0000-0000-0000-000000000001'::uuid
  );
