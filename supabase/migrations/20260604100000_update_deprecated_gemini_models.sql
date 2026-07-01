-- Replace Gemini model IDs that now return 404 with the current stable default.
UPDATE public.ai_configs
SET model = 'gemini-3.5-flash'
WHERE provider = 'gemini'
  AND model IN (
    'gemini-1.0-pro',
    'gemini-1.5-pro-latest',
    'gemini-2.0-flash',
    'gemini-2.0-flash-001',
    'models/gemini-2.0-flash',
    'models/gemini-2.0-flash-001',
    'gemini-3.0-pro',
    'gemini-3.0-flash',
    'gemini-pro'
  );

UPDATE public.schedule_settings
SET ai_model_override = 'gemini-3.5-flash'
WHERE ai_provider_override = 'gemini'
  AND ai_model_override IN (
    'gemini-1.0-pro',
    'gemini-1.5-pro-latest',
    'gemini-2.0-flash',
    'gemini-2.0-flash-001',
    'models/gemini-2.0-flash',
    'models/gemini-2.0-flash-001',
    'gemini-3.0-pro',
    'gemini-3.0-flash',
    'gemini-pro'
  );
