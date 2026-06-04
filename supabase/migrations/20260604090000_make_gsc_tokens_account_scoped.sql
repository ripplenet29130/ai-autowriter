-- Make Google Search Console tokens client-account scoped.

UPDATE public.gsc_tokens AS tokens
SET account_id = profiles.account_id
FROM public.profiles AS profiles
WHERE tokens.account_id IS NULL
  AND tokens.user_id = profiles.user_id
  AND profiles.account_id IS NOT NULL;

WITH ranked_tokens AS (
  SELECT
    user_id,
    row_number() OVER (
      PARTITION BY account_id
      ORDER BY updated_at DESC, created_at DESC, user_id DESC
    ) AS row_number
  FROM public.gsc_tokens
  WHERE account_id IS NOT NULL
)
DELETE FROM public.gsc_tokens
WHERE user_id IN (
  SELECT user_id
  FROM ranked_tokens
  WHERE row_number > 1
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_gsc_tokens_account_id_unique
  ON public.gsc_tokens(account_id)
  WHERE account_id IS NOT NULL;
