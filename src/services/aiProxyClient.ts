import { supabase } from './supabaseClient';

const AI_PROXY_TIMEOUT_MS = 120 * 1000;

export class AiProxyError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = 'AiProxyError';
    this.status = status;
  }
}

/**
 * ai-proxy Edge Function の共通呼び出しヘルパー。
 * ログインユーザーのアクセストークンで認証する（anon key では 401 になる）。
 */
export const callAiProxy = async (payload: Record<string, unknown>): Promise<any> => {
  const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
  const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

  if (!supabaseUrl || !supabaseAnonKey) {
    throw new Error('Supabase configurations are missing');
  }

  if (!supabase) {
    throw new Error('Supabase client is not initialized');
  }

  const { data: sessionData, error: sessionError } = await supabase.auth.getSession();
  const accessToken = sessionData?.session?.access_token;

  if (sessionError || !accessToken) {
    throw new Error('ログインセッションが見つかりません。再度ログインしてください。');
  }

  const response = await fetch(`${supabaseUrl}/functions/v1/ai-proxy`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${accessToken}`,
      'apikey': supabaseAnonKey,
    },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(AI_PROXY_TIMEOUT_MS),
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({} as Record<string, unknown>));
    const message = typeof errorData?.error === 'string'
      ? errorData.error
      : `Unknown error`;
    throw new AiProxyError(response.status, `AI Proxy Error (${response.status}): ${message}`);
  }

  return await response.json();
};
