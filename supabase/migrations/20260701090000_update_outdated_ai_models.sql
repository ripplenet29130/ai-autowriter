-- Replace retired or incorrectly formatted model IDs while preserving older models
-- that remain supported and may have been selected for cost reasons.
UPDATE public.ai_configs
SET model = CASE model
  WHEN 'gpt-3.5-turbo' THEN 'gpt-5.4'
  WHEN 'gpt-4o' THEN 'gpt-5.4'
  WHEN 'claude-4-5-sonnet-20250929' THEN 'claude-sonnet-4-6'
  WHEN 'claude-4-5-opus-20251124' THEN 'claude-opus-4-8'
  WHEN 'claude-4-5-haiku-20251015' THEN 'claude-haiku-4-5-20251001'
  WHEN 'claude-3-5-sonnet-latest' THEN 'claude-sonnet-4-6'
  WHEN 'claude-3-opus-20240229' THEN 'claude-opus-4-8'
  ELSE model
END
WHERE model IN (
  'gpt-3.5-turbo',
  'gpt-4o',
  'claude-4-5-sonnet-20250929',
  'claude-4-5-opus-20251124',
  'claude-4-5-haiku-20251015',
  'claude-3-5-sonnet-latest',
  'claude-3-opus-20240229'
);

UPDATE public.schedule_settings
SET ai_model_override = CASE ai_model_override
  WHEN 'gpt-3.5-turbo' THEN 'gpt-5.4'
  WHEN 'gpt-4o' THEN 'gpt-5.4'
  WHEN 'claude-4-5-sonnet-20250929' THEN 'claude-sonnet-4-6'
  WHEN 'claude-4-5-opus-20251124' THEN 'claude-opus-4-8'
  WHEN 'claude-4-5-haiku-20251015' THEN 'claude-haiku-4-5-20251001'
  WHEN 'claude-3-5-sonnet-latest' THEN 'claude-sonnet-4-6'
  WHEN 'claude-3-opus-20240229' THEN 'claude-opus-4-8'
  ELSE ai_model_override
END
WHERE ai_model_override IN (
  'gpt-3.5-turbo',
  'gpt-4o',
  'claude-4-5-sonnet-20250929',
  'claude-4-5-opus-20251124',
  'claude-4-5-haiku-20251015',
  'claude-3-5-sonnet-latest',
  'claude-3-opus-20240229'
);
