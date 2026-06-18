import { supabase } from './supabaseClient';
import { IS_CLIENT_DEPLOYMENT } from '@aw/config';
import { getCurrentAccountId } from './accountScope';
import {
  applyFallbackFactCheckFixes,
  buildFactCheckCorrectionPrompt,
  buildFactCheckPrompt,
  cleanFactCheckModelText,
  DEFAULT_FACT_CHECK_BATCH_SIZE,
  DEFAULT_FACT_CHECK_MAX_ITEMS,
  DEFAULT_FACT_CHECK_MODEL_NAME,
  extractFactsFromContent,
  FactCheckItem,
  FactCheckResult,
  getFixableFactCheckIssues,
  hasFixableFactCheckIssues,
  parseFactCheckBatchResults,
  selectFactCheckItems,
} from '../shared/factCheckCore';

type FactCheckSettingsRow = {
  enabled: boolean;
  perplexity_api_key?: string | null;
  max_items_to_check?: number | null;
  model_name?: string | null;
  auto_fix_enabled?: boolean | null;
};

type FactCheckProgress = {
  total: number;
  processed: number;
};

const LOCAL_STORAGE_KEY = 'fact_check_settings_local';
const DEFAULT_MAX_ITEMS = DEFAULT_FACT_CHECK_MAX_ITEMS;
const DEFAULT_BATCH_SIZE = DEFAULT_FACT_CHECK_BATCH_SIZE;
const DEFAULT_MODEL_NAME = DEFAULT_FACT_CHECK_MODEL_NAME;

const parseBoolean = (value: string | null | undefined, fallback = false): boolean => {
  if (value == null || value === '') return fallback;
  const normalized = String(value).trim().toLowerCase();
  return normalized === '1' || normalized === 'true' || normalized === 'yes' || normalized === 'on';
};

const getLocalSettings = (): FactCheckSettingsRow | null => {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(LOCAL_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as {
      enabled?: unknown;
      perplexityApiKey?: unknown;
      autoFixEnabled?: unknown;
      modelName?: unknown;
    };
    const key = String(parsed.perplexityApiKey ?? '').trim();
    if (!key) return null;
    return {
      enabled: Boolean(parsed.enabled ?? true),
      perplexity_api_key: key,
      max_items_to_check: DEFAULT_MAX_ITEMS,
      model_name: String(parsed.modelName ?? DEFAULT_MODEL_NAME),
      auto_fix_enabled: Boolean(parsed.autoFixEnabled ?? false),
    };
  } catch {
    return null;
  }
};

export const factCheckService = {
  isClientMode(): boolean {
    return IS_CLIENT_DEPLOYMENT;
  },

  enforceSettings(settings: FactCheckSettingsRow | null): FactCheckSettingsRow | null {
    if (!settings) return null;

    return {
      ...settings,
      enabled: this.isClientMode() ? true : settings.enabled,
      max_items_to_check: DEFAULT_MAX_ITEMS,
      model_name: settings.model_name || DEFAULT_MODEL_NAME,
      auto_fix_enabled: Boolean(settings.auto_fix_enabled ?? false),
    };
  },

  async resolveSettings(): Promise<FactCheckSettingsRow | null> {
    const localSettings = getLocalSettings();
    if (localSettings?.perplexity_api_key) return this.enforceSettings(localSettings);

    if (!supabase) return null;
    const accountId = getCurrentAccountId();
    if (!accountId) return null;

    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (!authError && user) {
      const { data } = await supabase
        .from('fact_check_settings')
        .select('*')
        .eq('user_id', user.id)
        .eq('account_id', accountId)
        .order('updated_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (data) {
        return this.enforceSettings((data as FactCheckSettingsRow) ?? null);
      }
    }

    const { data: globalRows, error: globalError } = await supabase
      .from('app_settings')
      .select('key, value')
      .eq('account_id', accountId)
      .in('key', [
        'perplexity_api_key',
        'fact_check_enabled',
        'fact_check_model_name',
        'fact_check_auto_fix_enabled',
      ]);

    if (globalError || !globalRows || globalRows.length === 0) {
      return null;
    }

    const map = new Map<string, string>();
    globalRows.forEach((row: any) => {
      map.set(String(row.key), String(row.value ?? ''));
    });

    const globalApiKey = map.get('perplexity_api_key');
    if (!globalApiKey) return null;

    return this.enforceSettings({
      enabled: parseBoolean(map.get('fact_check_enabled'), true),
      perplexity_api_key: globalApiKey,
      model_name: map.get('fact_check_model_name') || DEFAULT_MODEL_NAME,
      max_items_to_check: DEFAULT_MAX_ITEMS,
      auto_fix_enabled: parseBoolean(map.get('fact_check_auto_fix_enabled'), false),
    });
  },

  extractFacts(content: string, userMarkedText?: string): FactCheckItem[] {
    return extractFactsFromContent(content, userMarkedText);
  },

  async verifyFacts(
    items: FactCheckItem[],
    keyword: string,
    modelName?: string,
    onProgress?: (progress: FactCheckProgress) => void
  ): Promise<FactCheckResult[]> {
    if (items.length === 0) return [];

    const settings = await this.resolveSettings();

    if (!settings?.enabled || !settings?.perplexity_api_key) {
      console.warn('Fact check settings not found or API key missing (user/global)');
      return [];
    }

    const results: FactCheckResult[] = [];
    const batchSize = DEFAULT_BATCH_SIZE;
    const maxItems = settings.max_items_to_check;
    const itemsToCheck = selectFactCheckItems(items, maxItems);
    const selectedModel = modelName || settings.model_name || DEFAULT_MODEL_NAME;
    const waitMs = selectedModel.includes('sonar-pro') ? 500 : 800;
    onProgress?.({ total: itemsToCheck.length, processed: 0 });

    for (let i = 0; i < itemsToCheck.length; i += batchSize) {
      const batch = itemsToCheck.slice(i, i + batchSize);

      const prompt = buildFactCheckPrompt(batch, keyword);

      try {
        const response = await fetch('https://api.perplexity.ai/chat/completions', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${settings.perplexity_api_key}`,
          },
          body: JSON.stringify({
            model: selectedModel,
            messages: [
              { role: 'system', content: 'You are a precise fact-checking assistant. Return JSON only.' },
              { role: 'user', content: prompt },
            ],
            temperature: 0.1,
          }),
        });

        if (!response.ok) throw new Error(`Perplexity API error: ${response.status}`);

        const data = await response.json();
        const content: string = data?.choices?.[0]?.message?.content ?? '[]';

        results.push(...parseFactCheckBatchResults(batch, content));

        if (i + batchSize < itemsToCheck.length) {
          await new Promise((resolve) => setTimeout(resolve, waitMs));
        }
      } catch (error) {
        console.error('Batch verification error:', error);
      }
      onProgress?.({ total: itemsToCheck.length, processed: Math.min(i + batchSize, itemsToCheck.length) });
    }

    return results;
  },

  hasFixableIssues(results: FactCheckResult[]): boolean {
    return hasFixableFactCheckIssues(results);
  },

  async getSettings(): Promise<FactCheckSettingsRow | null> {
    return this.resolveSettings();
  },

  async applyFactCheckFixes(
    originalContent: string,
    results: FactCheckResult[],
    keyword: string,
    modelName?: string
  ): Promise<string | null> {
    const settings = await this.getSettings();
    if (!settings?.enabled || !settings?.perplexity_api_key) return null;

    const issues = getFixableFactCheckIssues(results);
    if (issues.length === 0) return originalContent;

    const prompt = buildFactCheckCorrectionPrompt(originalContent, results, keyword);
    if (!prompt) return originalContent;

    try {
      const response = await fetch('https://api.perplexity.ai/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${settings.perplexity_api_key}`,
        },
        body: JSON.stringify({
          model: modelName || settings.model_name || DEFAULT_MODEL_NAME,
          messages: [
            { role: 'system', content: 'You edit Japanese articles to fix factual mistakes while preserving style.' },
            { role: 'user', content: prompt },
          ],
          temperature: 0.2,
        }),
      });

      if (!response.ok) throw new Error(`Perplexity API error: ${response.status}`);

      const data = await response.json();
      const content: string = data?.choices?.[0]?.message?.content ?? '';
      const cleaned = cleanFactCheckModelText(content);
      return cleaned || applyFallbackFactCheckFixes(originalContent, issues);
    } catch (error) {
      console.error('Fact check auto-fix failed:', error);
      return applyFallbackFactCheckFixes(originalContent, issues);
    }
  },
};
