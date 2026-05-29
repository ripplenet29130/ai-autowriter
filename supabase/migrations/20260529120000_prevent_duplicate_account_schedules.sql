CREATE OR REPLACE FUNCTION public.prevent_duplicate_account_schedules()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.account_id IS NULL THEN
    RETURN NEW;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.schedule_settings
    WHERE account_id = NEW.account_id
      AND id <> COALESCE(NEW.id, '00000000-0000-0000-0000-000000000000'::uuid)
  ) THEN
    RAISE EXCEPTION 'Only one schedule_settings row is allowed per account_id';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS prevent_duplicate_account_schedules_trigger ON public.schedule_settings;

CREATE TRIGGER prevent_duplicate_account_schedules_trigger
BEFORE INSERT OR UPDATE OF account_id ON public.schedule_settings
FOR EACH ROW
EXECUTE FUNCTION public.prevent_duplicate_account_schedules();
