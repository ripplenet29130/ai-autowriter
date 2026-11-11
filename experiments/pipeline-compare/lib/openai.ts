// OpenAI Responses API（Web 検索付き）の最小限の呼び出し
import { envNumber } from './env.ts';

export interface OpenAiCitation {
  url: string;
  title: string;
}

export interface OpenAiResponse {
  text: string;
  citations: OpenAiCitation[];
  webSearchCalls: number;
  incomplete: boolean;
}

export interface OpenAiUsage {
  calls: number;
  inputTokens: number;
  outputTokens: number;
  reasoningTokens: number;
  webSearchCalls: number;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export class OpenAiClient {
  readonly usage: OpenAiUsage = { calls: 0, inputTokens: 0, outputTokens: 0, reasoningTokens: 0, webSearchCalls: 0 };
  private webSearchToolType = 'web_search';
  private useReasoning = true;

  constructor(readonly apiKey: string, readonly model: string) {}

  async respond(prompt: string, options: {
    webSearch?: boolean;
    maxOutputTokens?: number;
    effort?: 'low' | 'medium' | 'high';
  } = {}): Promise<OpenAiResponse> {
    for (let attempt = 0; ; attempt++) {
      const body: Record<string, unknown> = {
        model: this.model,
        input: prompt,
        max_output_tokens: options.maxOutputTokens ?? 16000,
        ...(this.useReasoning ? { reasoning: { effort: options.effort ?? 'medium' } } : {}),
        ...(options.webSearch ? { tools: [{ type: this.webSearchToolType }] } : {}),
      };
      const res = await fetch('https://api.openai.com/v1/responses', {
        method: 'POST',
        headers: { Authorization: `Bearer ${this.apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(360_000),
      });

      if (!res.ok) {
        const errorText = await res.text();
        // 推論設定に対応していないモデルでは外して再試行
        if (res.status === 400 && this.useReasoning && /reasoning/i.test(errorText)) {
          this.useReasoning = false;
          continue;
        }
        // 古い名前の検索ツールしか使えない場合
        if (res.status === 400 && options.webSearch && this.webSearchToolType === 'web_search' && /web_search/i.test(errorText)) {
          this.webSearchToolType = 'web_search_preview';
          continue;
        }
        if ((res.status === 429 || res.status >= 500) && attempt < 4) {
          const retryAfter = Number(res.headers.get('retry-after'));
          const waitMs = Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : 3000 * 2 ** attempt;
          console.warn(`    OpenAI ${res.status}。${Math.round(waitMs / 1000)}秒待って再試行します`);
          await sleep(waitMs);
          continue;
        }
        throw new Error(`OpenAI API error: ${res.status} - ${errorText.slice(0, 500)}`);
      }

      const data = await res.json();
      return this.parse(data);
    }
  }

  private parse(data: any): OpenAiResponse {
    const output: any[] = Array.isArray(data?.output) ? data.output : [];
    const texts: string[] = [];
    const citations: OpenAiCitation[] = [];
    let webSearchCalls = 0;
    for (const item of output) {
      if (item?.type === 'web_search_call') webSearchCalls += 1;
      if (item?.type !== 'message' || !Array.isArray(item.content)) continue;
      for (const part of item.content) {
        if (part?.type === 'output_text' && typeof part.text === 'string') {
          texts.push(part.text);
          for (const a of Array.isArray(part.annotations) ? part.annotations : []) {
            if (a?.type === 'url_citation' && a.url) citations.push({ url: String(a.url), title: String(a.title || '') });
          }
        }
      }
    }

    const usage = data?.usage || {};
    this.usage.calls += 1;
    this.usage.inputTokens += Number(usage.input_tokens) || 0;
    this.usage.outputTokens += Number(usage.output_tokens) || 0;
    this.usage.reasoningTokens += Number(usage.output_tokens_details?.reasoning_tokens) || 0;
    this.usage.webSearchCalls += webSearchCalls;

    return {
      text: texts.join('\n').trim(),
      citations,
      webSearchCalls,
      incomplete: data?.status === 'incomplete',
    };
  }
}

// 単価が .env に入っていれば費用（ドル）を返す。入っていなければ null
export function estimateOpenAiUsd(usage: OpenAiUsage): number | null {
  const input = envNumber('OPENAI_INPUT_USD_PER_M');
  const output = envNumber('OPENAI_OUTPUT_USD_PER_M');
  if (input === null || output === null) return null;
  const search = envNumber('OPENAI_WEB_SEARCH_USD_PER_CALL') ?? 0;
  // 推論トークンは出力トークンに含まれて課金される
  return (usage.inputTokens / 1_000_000) * input + (usage.outputTokens / 1_000_000) * output + usage.webSearchCalls * search;
}
