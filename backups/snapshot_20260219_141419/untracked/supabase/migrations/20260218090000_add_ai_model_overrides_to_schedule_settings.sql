-- Allow per-schedule AI provider/model overrides while keeping ai_config_id for auth/base settings.
ALTER TABLE public.schedule_settings
ADD COLUMN IF NOT EXISTS ai_provider_override text,
ADD COLUMN IF NOT EXISTS ai_model_override text;

COMMENT ON COLUMN public.schedule_settings.ai_provider_override IS
'Optional provider override used only for this schedule execution (openai/claude/gemini).';

COMMENT ON COLUMN public.schedule_settings.ai_model_override IS
'Optional model override used only for this schedule execution.';
