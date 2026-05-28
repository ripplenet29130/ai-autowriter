import { supabase } from './supabaseClient';

const GSC_REDIRECT_PARAM = 'gsc';
const GSC_CONNECTED_VALUE = 'connected';
const GSC_ERROR_PARAM = 'gsc_error';
const GSC_REFRESH_TOKEN_PARAM = 'gsc_refresh_token';

interface StartOAuthResult {
  auth_url?: string;
  error?: string;
}

export interface GscPropertyStatus {
  wordpress_config_id?: string;
  verified: boolean;
  matched_property_url: string | null;
  checked_at?: string | null;
  error_code?: string | null;
  error_message?: string | null;
  site_url?: string;
}

export interface GscAnalyticsRow {
  key: string;
  clicks: number;
  impressions: number;
  ctr: number;
  position: number;
}

export interface GscAnalyticsSummary {
  clicks: number;
  impressions: number;
  ctr: number;
  position: number;
}

export interface GscAnalyticsResponse {
  site_url: string;
  dimension: 'date' | 'query';
  days: number;
  start_date?: string;
  end_date?: string;
  rows: GscAnalyticsRow[];
  summary: GscAnalyticsSummary;
  error?: string;
  error_code?: string;
}

export interface GscAnalyticsOptions {
  days?: number;
  rowLimit?: number;
  startDate?: string;
  endDate?: string;
}

const throwFunctionError = (data: { error?: string } | null | undefined, fallback: string): never => {
  throw new Error(data?.error || fallback);
};

export const searchConsoleService = {
  async startOAuth(): Promise<void> {
    if (!supabase) {
      throw new Error('Supabase is not initialized.');
    }

    const redirectUrl = new URL(window.location.href);
    redirectUrl.searchParams.delete(GSC_REDIRECT_PARAM);
    redirectUrl.searchParams.delete(GSC_ERROR_PARAM);
    redirectUrl.searchParams.delete(GSC_REFRESH_TOKEN_PARAM);

    const { data, error } = await supabase.functions.invoke<StartOAuthResult>(
      'gsc-oauth-start',
      {
        body: {
          redirect_to: redirectUrl.toString(),
        },
      }
    );

    if (error) {
      throw error;
    }

    if (!data?.auth_url) {
      throw new Error(data?.error || 'Google Search Console連携URLを作成できませんでした');
    }

    window.location.assign(data.auth_url);
  },

  isOAuthRedirect(): boolean {
    const params = new URLSearchParams(window.location.search);
    return params.get(GSC_REDIRECT_PARAM) === GSC_CONNECTED_VALUE || params.has(GSC_ERROR_PARAM);
  },

  getOAuthRedirectResult(): { success: boolean; error?: string; hasRefreshToken?: boolean } | null {
    const params = new URLSearchParams(window.location.search);
    const error = params.get(GSC_ERROR_PARAM);
    if (error) {
      return { success: false, error };
    }

    if (params.get(GSC_REDIRECT_PARAM) === GSC_CONNECTED_VALUE) {
      return {
        success: true,
        hasRefreshToken: params.get(GSC_REFRESH_TOKEN_PARAM) === '1',
      };
    }

    return null;
  },

  clearOAuthRedirectFlag(): void {
    const url = new URL(window.location.href);
    url.searchParams.delete(GSC_REDIRECT_PARAM);
    url.searchParams.delete(GSC_ERROR_PARAM);
    url.searchParams.delete(GSC_REFRESH_TOKEN_PARAM);
    window.history.replaceState({}, document.title, `${url.pathname}${url.search}${url.hash}`);
  },

  async checkPropertyStatus(wordpressConfigId: string): Promise<GscPropertyStatus> {
    if (!supabase) {
      throw new Error('Supabase is not initialized.');
    }

    const { data, error } = await supabase.functions.invoke<GscPropertyStatus & { error?: string }>(
      'gsc-property-status',
      {
        body: {
          wordpress_config_id: wordpressConfigId,
        },
      }
    );

    if (error) {
      throw error;
    }

    if (!data) {
      throw new Error('Search Consoleの確認結果を取得できませんでした');
    }

    if (data.error && typeof data.verified !== 'boolean') {
      return throwFunctionError(data, 'Search Consoleの確認に失敗しました');
    }

    return data;
  },

  async fetchAnalytics(
    wordpressConfigId: string,
    dimension: 'date' | 'query' = 'date',
    options: GscAnalyticsOptions | number = 28,
    legacyRowLimit?: number
  ): Promise<GscAnalyticsResponse> {
    if (!supabase) {
      throw new Error('Supabase is not initialized.');
    }

    const requestOptions = typeof options === 'number'
      ? { days: options, rowLimit: legacyRowLimit }
      : options;

    const { data, error } = await supabase.functions.invoke<GscAnalyticsResponse>(
      'gsc-search-analytics',
      {
        body: {
          wordpress_config_id: wordpressConfigId,
          dimension,
          days: requestOptions.days,
          row_limit: requestOptions.rowLimit,
          start_date: requestOptions.startDate,
          end_date: requestOptions.endDate,
        },
      }
    );

    if (error) {
      throw error;
    }

    if (!data) {
      throw new Error('Search Consoleのデータを取得できませんでした');
    }

    if (data.error) {
      return throwFunctionError(data, 'Search Consoleのデータ取得に失敗しました');
    }

    return data;
  },
};
