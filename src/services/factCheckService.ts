import { supabase } from './supabaseClient';
import { IS_CLIENT_DEPLOYMENT } from '@aw/config';
import { getCurrentUserId } from './accountScope';
import {
  extractFactsFromContent,
  FactCheckItem,
  FactCheckResult,
  hasFixableFactCheckIssues,
} from '../shared/factCheckCore';
import { applyGeminiFactCheckFixes, runGeminiFactCheck } from '../shared/geminiFactCheck';
import { appendReferencesSection, splitReferencesSection, type FactSheet } from '../shared/factSheetCore';
import { createGeminiSession } from './geminiSession';

// ファクトチェックは Gemini の Google 検索で行う（Perplexity は廃止）。
// Gemini のキーは ai-proxy がサーバー側で解決する（AI設定の Gemini キー）。

type FactCheckSettingsRow = {
  enabled: boolean;
  auto_fix_enabled?: boolean | null;
};

type FactCheckProgress = {
  total: number;
  processed: number;
};

const parseBoolean = (value: string | null | undefined, fallback = false): boolean => {
  if (value == null || value === '') return fallback;
  const normalized = String(value).trim().toLowerCase();
  return normalized === '1' || normalized === 'true' || normalized === 'yes' || normalized === 'on';
};

export const factCheckService = {
  isClientMode(): boolean {
    return IS_CLIENT_DEPLOYMENT;
  },

  async resolveSettings(): Promise<FactCheckSettingsRow> {
    const defaults: FactCheckSettingsRow = { enabled: true, auto_fix_enabled: false };
    if (!supabase) return defaults;
    const userId = getCurrentUserId();
    if (!userId) return defaults;

    const { data } = await supabase
      .from('fact_check_settings')
      .select('enabled, auto_fix_enabled')
      .eq('user_id', userId)
      .order('updated_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (data) {
      return {
        enabled: this.isClientMode() ? true : data.enabled !== false,
        auto_fix_enabled: Boolean(data.auto_fix_enabled),
      };
    }

    const { data: globalRows } = await supabase
      .from('app_settings')
      .select('key, value')
      .eq('user_id', userId)
      .in('key', ['fact_check_enabled', 'fact_check_auto_fix_enabled']);

    const map = new Map<string, string>();
    (globalRows || []).forEach((row: any) => {
      map.set(String(row.key), String(row.value ?? ''));
    });
    return {
      enabled: this.isClientMode() ? true : parseBoolean(map.get('fact_check_enabled'), true),
      auto_fix_enabled: parseBoolean(map.get('fact_check_auto_fix_enabled'), false),
    };
  },

  async getSettings(): Promise<FactCheckSettingsRow> {
    return this.resolveSettings();
  },

  // 従来の機械的な抽出（AI 抽出に失敗したときの予備として共通部品側でも使う）
  extractFacts(content: string, userMarkedText?: string): FactCheckItem[] {
    return extractFactsFromContent(content, userMarkedText);
  },

  /**
   * 記事全体のファクトチェック（AI が主張を選ぶ → 根拠メモと照合 → 残りを Google 検索で確認）
   */
  async checkArticle(
    content: string,
    keyword: string,
    options?: {
      factSheet?: FactSheet | null;
      userMarkedText?: string;
      onProgress?: (progress: FactCheckProgress) => void;
    }
  ): Promise<FactCheckResult[]> {
    const settings = await this.resolveSettings();
    if (!settings.enabled) {
      console.warn('Fact check is not enabled for this user');
      return [];
    }
    const session = await createGeminiSession();
    const run = await runGeminiFactCheck({
      // 記事末の参考資料はチェック対象にしない
      content: splitReferencesSection(content).body,
      keyword,
      userMarkedText: options?.userMarkedText,
      factSheet: options?.factSheet,
      call: session.call,
      resolveUrls: session.resolveUrls,
      concurrency: 1,
      onProgress: options?.onProgress,
    });
    return run.results;
  },

  /**
   * 指定した主張だけを確認する（従来の呼び出し方との互換用）
   */
  async verifyFacts(
    items: FactCheckItem[],
    keyword: string,
    _modelName?: string,
    onProgress?: (progress: FactCheckProgress) => void
  ): Promise<FactCheckResult[]> {
    if (items.length === 0) return [];
    const settings = await this.resolveSettings();
    if (!settings.enabled) return [];
    const session = await createGeminiSession();
    const run = await runGeminiFactCheck({
      content: items.map((item) => item.context).join('\n\n'),
      keyword,
      call: session.call,
      resolveUrls: session.resolveUrls,
      concurrency: 1,
      onlyClaims: items,
      onProgress,
    });
    return run.results;
  },

  hasFixableIssues(results: FactCheckResult[]): boolean {
    return hasFixableFactCheckIssues(results);
  },

  async applyFactCheckFixes(
    originalContent: string,
    results: FactCheckResult[],
    keyword: string,
    _modelName?: string
  ): Promise<string | null> {
    const settings = await this.getSettings();
    if (!settings.enabled) return null;
    if (!hasFixableFactCheckIssues(results)) return originalContent;

    try {
      const session = await createGeminiSession();
      // 参考資料は修正対象から外し、修正後に付け直す
      const { body, references } = splitReferencesSection(originalContent);
      const fixed = await applyGeminiFactCheckFixes({
        content: body,
        results,
        keyword,
        call: session.call,
      });
      return references ? appendReferencesSection(fixed.content, references) : fixed.content;
    } catch (error) {
      console.error('Fact check auto-fix failed:', error);
      return null;
    }
  },
};
