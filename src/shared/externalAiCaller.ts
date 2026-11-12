// ChatGPT（OpenAI）と Claude（Anthropic）を、Gemini と同じ呼び出し口（GeminiCaller）で使えるようにする
// - useSearch: true のときは各社の Web 検索ツールを付ける（OpenAI: web_search / Claude: web_search）
// - 応答は ParsedGeminiResponse の形に直す（grounded = 実際に検索したか、sources = 出典）
// - role（base/writer）は無視する（選ばれた 1 つのモデルで全部行う）
import { supportsTemperature, type AiProvider } from './aiModelCatalog.ts';
import type {
  GeminiCallOptions,
  GeminiCaller,
  GeminiGroundingSource,
  GeminiUsage,
  ParsedGeminiResponse,
} from './geminiCore.ts';

export interface ExternalCallerParams {
  provider: Exclude<AiProvider, 'gemini'>;
  apiKey: string;
  model: string;
  // 呼び出しごとの待ち時間の上限（残り時間に合わせて決める）
  timeoutMs: () => number;
  onUsage?: (model: string, usage: GeminiUsage, grounded: boolean, searchQueries: number) => void;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

class ExternalApiError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
    this.name = 'ExternalApiError';
  }
}

function emptyResponse(model: string): ParsedGeminiResponse {
  return {
    text: '',
    finishReason: 'STOP',
    usage: { inputTokens: 0, outputTokens: 0, thoughtsTokens: 0 },
    sources: [],
    supports: [],
    searchQueries: [],
    grounded: false,
    model,
  };
}

function dedupeSources(sources: GeminiGroundingSource[]): GeminiGroundingSource[] {
  const seen = new Set<string>();
  return sources.filter((s) => {
    if (!s.uri || seen.has(s.uri)) return false;
    seen.add(s.uri);
    return true;
  });
}

// --- OpenAI（Responses API） ---

export function parseOpenAiResponse(data: any, model: string): ParsedGeminiResponse {
  const result = emptyResponse(model);
  const texts: string[] = [];
  const sources: GeminiGroundingSource[] = [];
  let searchCalls = 0;
  for (const item of Array.isArray(data?.output) ? data.output : []) {
    if (item?.type === 'web_search_call') {
      searchCalls += 1;
      const query = item?.action?.query;
      if (typeof query === 'string' && query) result.searchQueries.push(query);
      for (const s of Array.isArray(item?.action?.sources) ? item.action.sources : []) {
        if (s?.url) sources.push({ uri: String(s.url), title: String(s.title || '') });
      }
    }
    if (item?.type !== 'message' || !Array.isArray(item.content)) continue;
    for (const part of item.content) {
      if (part?.type !== 'output_text' || typeof part.text !== 'string') continue;
      texts.push(part.text);
      for (const a of Array.isArray(part.annotations) ? part.annotations : []) {
        if (a?.type === 'url_citation' && a.url) sources.push({ uri: String(a.url), title: String(a.title || '') });
      }
    }
  }
  const usage = data?.usage || {};
  const reasoning = Number(usage.output_tokens_details?.reasoning_tokens) || 0;
  result.text = texts.join('\n').trim();
  result.sources = dedupeSources(sources);
  result.grounded = searchCalls > 0;
  if (result.grounded && result.searchQueries.length === 0) result.searchQueries.push('(web_search)');
  result.finishReason = data?.status === 'incomplete' && data?.incomplete_details?.reason === 'max_output_tokens'
    ? 'MAX_TOKENS'
    : 'STOP';
  result.usage = {
    inputTokens: Number(usage.input_tokens) || 0,
    outputTokens: Math.max(0, (Number(usage.output_tokens) || 0) - reasoning),
    thoughtsTokens: reasoning,
  };
  return result;
}

async function requestOpenAi(params: ExternalCallerParams, prompt: string, options: GeminiCallOptions, timeoutMs: number) {
  const thinking = typeof options.thinkingBudget === 'number' && options.thinkingBudget > 0;
  const body: Record<string, unknown> = {
    model: params.model,
    input: prompt,
    // 推論トークンも出力上限に含まれるため、考える分を足しておく
    max_output_tokens: options.maxOutputTokens + (thinking ? Number(options.thinkingBudget) : 2048),
    reasoning: { effort: thinking ? 'medium' : 'low' },
    ...(options.useSearch ? { tools: [{ type: 'web_search' }] } : {}),
    ...(supportsTemperature('openai', params.model) && typeof options.temperature === 'number'
      ? { temperature: options.temperature }
      : {}),
  };
  const res = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: { Authorization: `Bearer ${params.apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) {
    throw new ExternalApiError(res.status, `OpenAI API error: ${res.status} - ${(await res.text()).slice(0, 400)}`);
  }
  return parseOpenAiResponse(await res.json(), params.model);
}

// --- Claude（Messages API） ---

export function parseClaudeResponse(data: any, model: string): ParsedGeminiResponse {
  const result = emptyResponse(model);
  const texts: string[] = [];
  const sources: GeminiGroundingSource[] = [];
  let searchCalls = 0;
  for (const block of Array.isArray(data?.content) ? data.content : []) {
    if (block?.type === 'server_tool_use' && block?.name === 'web_search') {
      searchCalls += 1;
      const query = block?.input?.query;
      if (typeof query === 'string' && query) result.searchQueries.push(query);
    }
    if (block?.type === 'web_search_tool_result' && Array.isArray(block.content)) {
      for (const r of block.content) {
        if (r?.url) sources.push({ uri: String(r.url), title: String(r.title || '') });
      }
    }
    if (block?.type === 'text' && typeof block.text === 'string') {
      texts.push(block.text);
      for (const c of Array.isArray(block.citations) ? block.citations : []) {
        if (c?.url) sources.push({ uri: String(c.url), title: String(c.title || '') });
      }
    }
  }
  const usage = data?.usage || {};
  // 検索付きの応答は文章が引用ごとに細かく分かれて返るため、つなげ直す
  result.text = texts.join('').trim();
  result.sources = dedupeSources(sources);
  result.grounded = searchCalls > 0 || Number(usage?.server_tool_use?.web_search_requests) > 0;
  if (result.grounded && result.searchQueries.length === 0) result.searchQueries.push('(web_search)');
  result.finishReason = data?.stop_reason === 'max_tokens' ? 'MAX_TOKENS' : 'STOP';
  result.usage = {
    inputTokens: (Number(usage.input_tokens) || 0) + (Number(usage.cache_read_input_tokens) || 0),
    outputTokens: Number(usage.output_tokens) || 0,
    thoughtsTokens: 0,
  };
  return result;
}

async function requestClaude(params: ExternalCallerParams, prompt: string, options: GeminiCallOptions, timeoutMs: number) {
  const body: Record<string, unknown> = {
    model: params.model,
    max_tokens: options.maxOutputTokens,
    messages: [{ role: 'user', content: prompt }],
    ...(options.useSearch ? { tools: [{ type: 'web_search_20250305', name: 'web_search', max_uses: 5 }] } : {}),
    ...(supportsTemperature('claude', params.model) && typeof options.temperature === 'number'
      ? { temperature: options.temperature }
      : {}),
  };
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': params.apiKey,
      'anthropic-version': '2023-06-01',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) {
    throw new ExternalApiError(res.status, `Claude API error: ${res.status} - ${(await res.text()).slice(0, 400)}`);
  }
  return parseClaudeResponse(await res.json(), params.model);
}

export function createExternalCaller(params: ExternalCallerParams): GeminiCaller {
  return async (prompt: string, options: GeminiCallOptions): Promise<ParsedGeminiResponse> => {
    for (let attempt = 0; ; attempt++) {
      const timeoutMs = params.timeoutMs();
      if (timeoutMs < 10_000) throw new Error('時間が足りないため AI を呼び出しませんでした');
      try {
        const response = params.provider === 'openai'
          ? await requestOpenAi(params, prompt, options, timeoutMs)
          : await requestClaude(params, prompt, options, timeoutMs);
        params.onUsage?.(params.model, response.usage, response.grounded, response.searchQueries.length);
        return response;
      } catch (error) {
        const status = error instanceof ExternalApiError ? error.status : 0;
        // 混雑（429・529・5xx）は 2 回まで待ってやり直す。時間が足りなければやめる
        const retryable = status === 429 || status >= 500;
        if (retryable && attempt < 2 && params.timeoutMs() > 40_000) {
          await sleep(3000 * 2 ** attempt);
          continue;
        }
        throw error;
      }
    }
  };
}
