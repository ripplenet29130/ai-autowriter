export type AiProvider = 'openai' | 'claude' | 'gemini';

export type AiModelTier = '最高品質・高価格' | '高品質' | 'バランス' | '低価格・高速' | '高品質・プレビュー';

export interface AiModelOption {
  value: string;
  label: string;
  tier: AiModelTier;
}

export const DEFAULT_AI_MODELS: Record<AiProvider, string> = {
  openai: 'gpt-5.4',
  claude: 'claude-sonnet-4-6',
  gemini: 'gemini-3.5-flash',
};

export const AI_MODEL_OPTIONS: Record<AiProvider, readonly AiModelOption[]> = {
  openai: [
    { value: 'gpt-5.4', label: 'GPT-5.4', tier: '高品質' },
    { value: 'gpt-5.5', label: 'GPT-5.5', tier: '最高品質・高価格' },
    { value: 'gpt-5.4-mini', label: 'GPT-5.4 mini', tier: '低価格・高速' },
  ],
  claude: [
    { value: 'claude-sonnet-4-6', label: 'Claude Sonnet 4.6', tier: 'バランス' },
    { value: 'claude-opus-4-8', label: 'Claude Opus 4.8', tier: '最高品質・高価格' },
    { value: 'claude-haiku-4-5-20251001', label: 'Claude Haiku 4.5', tier: '低価格・高速' },
  ],
  gemini: [
    { value: 'gemini-3.5-flash', label: 'Google Gemini 3.5 Flash', tier: 'バランス' },
    { value: 'gemini-3.1-pro-preview', label: 'Google Gemini 3.1 Pro Preview', tier: '高品質・プレビュー' },
    { value: 'gemini-3.1-flash-lite', label: 'Google Gemini 3.1 Flash-Lite', tier: '低価格・高速' },
  ],
};

const MODEL_REPLACEMENTS: Partial<Record<AiProvider, Record<string, string>>> = {
  openai: {
    'gpt-3.5-turbo': DEFAULT_AI_MODELS.openai,
    'gpt-4o': DEFAULT_AI_MODELS.openai,
  },
  claude: {
    'claude-4-5-sonnet-20250929': DEFAULT_AI_MODELS.claude,
    'claude-4-5-opus-20251124': 'claude-opus-4-8',
    'claude-4-5-haiku-20251015': 'claude-haiku-4-5-20251001',
    'claude-3-5-sonnet-latest': DEFAULT_AI_MODELS.claude,
    'claude-3-opus-20240229': 'claude-opus-4-8',
  },
  gemini: {
    'gemini-1.0-pro': DEFAULT_AI_MODELS.gemini,
    'gemini-1.5-pro-latest': DEFAULT_AI_MODELS.gemini,
    'gemini-2.0-flash': DEFAULT_AI_MODELS.gemini,
    'gemini-2.0-flash-001': DEFAULT_AI_MODELS.gemini,
    'gemini-3.0-pro': DEFAULT_AI_MODELS.gemini,
    'gemini-3.0-flash': DEFAULT_AI_MODELS.gemini,
    'gemini-pro': DEFAULT_AI_MODELS.gemini,
  },
};

export function isAiProvider(provider: string): provider is AiProvider {
  return provider === 'openai' || provider === 'claude' || provider === 'gemini';
}

export function getAiModelOptions(provider: string): readonly AiModelOption[] {
  return isAiProvider(provider) ? AI_MODEL_OPTIONS[provider] : [];
}

export function getDefaultAiModel(provider: string): string {
  return isAiProvider(provider) ? DEFAULT_AI_MODELS[provider] : '';
}

export function getAiModelTierLabel(model: string): string {
  for (const options of Object.values(AI_MODEL_OPTIONS)) {
    const option = options.find((item) => item.value === model);
    if (option) return option.tier;
  }
  return '現在の設定';
}

export function normalizeAiModel(provider: string, model?: string | null): string {
  if (!isAiProvider(provider)) return String(model || '').trim();

  const normalized = provider === 'gemini'
    ? String(model || '').trim().replace(/^models\//, '')
    : String(model || '').trim();

  if (!normalized) return DEFAULT_AI_MODELS[provider];
  return MODEL_REPLACEMENTS[provider]?.[normalized] || normalized;
}

export function supportsTemperature(provider: string, model: string): boolean {
  if (provider === 'openai' && /^gpt-5(?:[.-]|$)/.test(model)) return false;
  if (provider === 'claude' && /^claude-opus-4-(?:7|8)$/.test(model)) return false;
  return true;
}
