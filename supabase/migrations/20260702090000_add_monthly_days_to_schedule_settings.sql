ALTER TABLE public.schedule_settings
ADD COLUMN IF NOT EXISTS monthly_days smallint[];

ALTER TABLE public.schedule_settings
DROP CONSTRAINT IF EXISTS schedule_settings_monthly_days_valid;

ALTER TABLE public.schedule_settings
ADD CONSTRAINT schedule_settings_monthly_days_valid
CHECK (
  monthly_days IS NULL
  OR (
    cardinality(monthly_days) > 0
    AND monthly_days <@ ARRAY[
      1, 2, 3, 4, 5, 6, 7, 8, 9, 10,
      11, 12, 13, 14, 15, 16, 17, 18, 19, 20,
      21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31
    ]::smallint[]
  )
);

COMMENT ON COLUMN public.schedule_settings.monthly_days IS
'Calendar days used when frequency is monthly. Multiple days enable multiple posts per month.';
