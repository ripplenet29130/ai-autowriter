ALTER TABLE public.schedule_settings
ADD COLUMN IF NOT EXISTS image_generation_enabled boolean NOT NULL DEFAULT true;

COMMENT ON COLUMN public.schedule_settings.image_generation_enabled IS
'Scheduler-level image generation toggle. When false, image generation cost and image steps are skipped.';
