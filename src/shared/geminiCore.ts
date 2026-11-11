// Gemini API の共通部品（自動投稿の Edge Function・ai-proxy・ブラウザで共用）
// - リクエスト本文の組み立て（Google 検索・思考上限・JSON 出力）
// - 応答の解析（本文・トークン数・検索の出典）
// - エラーの分類（429 の待ち時間、Pro が使えないときの判定）

export interface GeminiRequestOptions {
  prompt: string;
  maxOutputTokens: number;
  temperature?: number;
  // null/undefined のときは thinkingConfig を送らない
  thinkingBudget?: number | null;
  useSearch?: boolean;
  jsonOutput?: boolean;
}

export interface GeminiGroundingSource {
  uri: string;
  title: string;
}

export interface GeminiGroundingSupport {
  text: string;
  chunkIndices: number[];
}

export interface GeminiUsage {
  inputTokens: number;
  outputTokens: number;
  thoughtsTokens: number;
}

export interface ParsedGeminiResponse {
  text: string;
  finishReason: string;
  usage: GeminiUsage;
  sources: GeminiGroundingSource[];
  supports: GeminiGroundingSupport[];
  searchQueries: string[];
  // Google 検索を実際に使った応答か（検索付きで呼んでも検索しないことがある）
  grounded: boolean;
  model: string;
}

// 工程ごとの呼び出し口。base = 基本モデル（Flash）、writer = 執筆モデル（高品質モードでは Pro）
export type GeminiRole = 'base' | 'writer';

export interface GeminiCallOptions extends Omit<GeminiRequestOptions, 'prompt'> {
  role?: GeminiRole;
}

export type GeminiCaller = (prompt: string, options: GeminiCallOptions) => Promise<ParsedGeminiResponse>;

// 出典 URL（転送用 URL）→ 元の URL。取得できなかった URL はキーに含めない。
export type UrlResolver = (urls: string[]) => Promise<Record<string, string>>;

export const GEMINI_API_BASE ='https://generativelanguage.googleapis.com/v1beta';

export function geminiGenerateUrl(model: string, apiKey: string): string {
  return `${GEMINI_API_BASE}/models/${model}:generateContent?key=${apiKey}`;
}

export function buildGeminiRequestBody(options: GeminiRequestOptions): Record<string, unknown> {
  const generationConfig: Record<string, unknown> = {
    temperature: options.temperature ?? 0.7,
    maxOutputTokens: options.maxOutputTokens,
  };
  if (typeof options.thinkingBudget === 'number') {
    generationConfig.thinkingConfig = { thinkingBudget: options.thinkingBudget };
  }
  // 検索ツールと JSON 出力の併用はモデルによって拒否されるため、検索時はプロンプトで JSON を指示する
  if (options.jsonOutput && !options.useSearch) {
    generationConfig.responseMimeType = 'application/json';
  }

  return {
    contents: [{ role: 'user', parts: [{ text: options.prompt }] }],
    generationConfig,
    ...(options.useSearch ? { tools: [{ google_search: {} }] } : {}),
  };
}

const toNumber = (value: unknown): number => {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : 0;
};

export function parseGeminiResponse(data: any, model = ''): ParsedGeminiResponse {
  const candidate = data?.candidates?.[0];
  const parts = candidate?.content?.parts;
  const text = Array.isArray(parts)
    ? parts
      // 思考の要約(thought: true)は本文に含めない
      .filter((part: any) => typeof part?.text === 'string' && part?.thought !== true)
      .map((part: any) => part.text)
      .join('')
      .trim()
    : '';

  const usageMeta = data?.usageMetadata || {};
  const usage: GeminiUsage = {
    // 検索結果としてモデルに渡された分（toolUsePromptTokenCount）も入力として課金される
    inputTokens: toNumber(usageMeta.promptTokenCount) + toNumber(usageMeta.toolUsePromptTokenCount),
    outputTokens: toNumber(usageMeta.candidatesTokenCount),
    thoughtsTokens: toNumber(usageMeta.thoughtsTokenCount),
  };

  const grounding = candidate?.groundingMetadata || {};
  const sources: GeminiGroundingSource[] = Array.isArray(grounding.groundingChunks)
    ? grounding.groundingChunks.map((chunk: any) => ({
      uri: String(chunk?.web?.uri || '').trim(),
      title: String(chunk?.web?.title || '').trim(),
    }))
    : [];
  const supports: GeminiGroundingSupport[] = Array.isArray(grounding.groundingSupports)
    ? grounding.groundingSupports
      .map((support: any) => ({
        text: String(support?.segment?.text || ''),
        chunkIndices: Array.isArray(support?.groundingChunkIndices)
          ? support.groundingChunkIndices.map((i: unknown) => Number(i)).filter((i: number) => Number.isInteger(i) && i >= 0)
          : [],
      }))
      .filter((support: GeminiGroundingSupport) => support.text && support.chunkIndices.length > 0)
    : [];
  const searchQueries: string[] = Array.isArray(grounding.webSearchQueries)
    ? grounding.webSearchQueries.map((q: unknown) => String(q || '')).filter(Boolean)
    : [];

  return {
    text,
    finishReason: String(candidate?.finishReason || ''),
    usage,
    sources,
    supports,
    searchQueries,
    grounded: searchQueries.length > 0 || sources.length > 0,
    model: String(data?.modelVersion || model || ''),
  };
}

export class GeminiHttpError extends Error {
  status: number;
  retryAfterMs: number | null;
  body: string;

  constructor(status: number, body: string, model: string) {
    super(`Gemini API error (${status}) [${model}]: ${body.slice(0, 400)}`);
    this.name = 'GeminiHttpError';
    this.status = status;
    this.body = body;
    this.retryAfterMs = parseGeminiRetryDelayMs(body);
  }
}

// 429 応答の RetryInfo（"retryDelay": "12s"）や "Please retry in 12.3s" から待ち時間を読む
export function parseGeminiRetryDelayMs(body: string): number | null {
  const text = String(body || '');
  const retryInfo = text.match(/"retryDelay"\s*:\s*"([\d.]+)s"/);
  if (retryInfo) return Math.ceil(Number(retryInfo[1]) * 1000);
  const plain = text.match(/retry in\s+([\d.]+)\s*s/i);
  if (plain) return Math.ceil(Number(plain[1]) * 1000);
  return null;
}

// 有料キーが必要なモデル（Pro）を呼べないときの応答。基本モデルへの代替に使う。
export function isModelUnavailableError(error: unknown): boolean {
  const status = (error as { status?: unknown })?.status;
  if (status === 403 || status === 404 || status === 429) return true;
  const message = error instanceof Error ? error.message : String(error || '');
  return /\((403|404|429)\)/.test(message) || /RESOURCE_EXHAUSTED|PERMISSION_DENIED|NOT_FOUND|billing/i.test(message);
}

export function isRateLimitError(error: unknown): boolean {
  const status = (error as { status?: unknown })?.status;
  if (status === 429) return true;
  const message = error instanceof Error ? error.message : String(error || '');
  return /\(429\)|RESOURCE_EXHAUSTED/i.test(message);
}

// 検索ツールに対応していないキー／モデルの応答（無料キーなど）
export function isSearchUnsupportedError(error: unknown): boolean {
  const status = (error as { status?: unknown })?.status;
  const message = error instanceof Error ? error.message : String(error || '');
  if (status === 400 || status === 403) {
    return /google_search|grounding|tool/i.test(message);
  }
  return false;
}

// 思考設定に対応していないモデルの 400
export function isThinkingConfigError(error: unknown): boolean {
  const status = (error as { status?: unknown })?.status;
  const message = error instanceof Error ? error.message : String(error || '');
  return status === 400 && /thinking/i.test(message);
}

// 応答本文から JSON を取り出す（コードフェンスや前後の説明文を許容する）
export function extractJsonValue(text: string): unknown {
  const raw = String(text || '').trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/, '');
  try {
    return JSON.parse(raw);
  } catch {
    // fall through
  }
  const objectStart = raw.indexOf('{');
  const arrayStart = raw.indexOf('[');
  const candidates: Array<[number, string]> = [];
  if (objectStart >= 0) candidates.push([objectStart, '}']);
  if (arrayStart >= 0) candidates.push([arrayStart, ']']);
  candidates.sort((a, b) => a[0] - b[0]);
  for (const [start, closer] of candidates) {
    const end = raw.lastIndexOf(closer);
    if (end <= start) continue;
    try {
      return JSON.parse(raw.slice(start, end + 1));
    } catch {
      // try next
    }
  }
  return null;
}

// 同時実行数を制限して順に処理する（結果は入力順）
export async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  worker: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  const runners = Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, async () => {
    while (next < items.length) {
      const index = next++;
      results[index] = await worker(items[index], index);
    }
  });
  await Promise.all(runners);
  return results;
}

export const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// 1 回の Gemini 呼び出し（fetch が使える環境ならどこでも動く）。429 の再試行は呼び出し側で行う。
export async function requestGeminiOnce(params: {
  apiKey: string;
  model: string;
  options: GeminiRequestOptions;
  timeoutMs: number;
}): Promise<ParsedGeminiResponse> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), params.timeoutMs);
  try {
    const response = await fetch(geminiGenerateUrl(params.model, params.apiKey), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(buildGeminiRequestBody(params.options)),
      signal: controller.signal,
    });
    if (!response.ok) {
      const body = await response.text().catch(() => '');
      throw new GeminiHttpError(response.status, body, params.model);
    }
    return parseGeminiResponse(await response.json(), params.model);
  } catch (error) {
    if ((error as { name?: string })?.name === 'AbortError') {
      throw new Error(`Gemini の応答が${Math.round(params.timeoutMs / 1000)}秒以内に完了しませんでした。`);
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

// Google 検索の出典 URL（vertexaisearch の転送用 URL）を元の URL に変換する。
// サーバー側（Deno）でのみ使う。ブラウザからは他サイトの転送先を読めない。
export function isGroundingRedirectUrl(url: string): boolean {
  return /vertexaisearch\.cloud\.google\.com\/grounding-api-redirect/i.test(String(url || ''));
}

export async function resolveRedirectUrls(urls: string[], timeoutMs = 5000): Promise<Record<string, string>> {
  const unique = Array.from(new Set(urls.filter((url) => /^https?:\/\//i.test(url))));
  const resolved: Record<string, string> = {};

  await mapWithConcurrency(unique, 6, async (url) => {
    if (!isGroundingRedirectUrl(url)) {
      resolved[url] = url;
      return;
    }
    const attempt = async (method: 'HEAD' | 'GET', redirect: RequestRedirect): Promise<string> => {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const response = await fetch(url, { method, redirect, signal: controller.signal });
        const location = response.headers.get('location');
        try {
          await response.body?.cancel();
        } catch {
          // ignore
        }
        if (location && /^https?:\/\//i.test(location)) return location;
        if (redirect === 'follow' && response.url && !isGroundingRedirectUrl(response.url)) return response.url;
        return '';
      } finally {
        clearTimeout(timer);
      }
    };
    try {
      const target = (await attempt('HEAD', 'manual')) || (await attempt('GET', 'follow'));
      if (target) resolved[url] = target;
    } catch {
      // 取得できなかった出典は参考資料に使わない
    }
  });

  return resolved;
}
