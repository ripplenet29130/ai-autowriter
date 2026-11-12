// AI 利用量（トークン数・Google 検索回数）の集計と費用の見積もり
import type { GeminiUsage } from './geminiCore.ts';

export interface ModelRate {
  input: number; // USD / 100万トークン
  output: number; // USD / 100万トークン（思考を含む）
}

// Google 検索グラウンディング: 月 5,000 回の無料枠を超えた分が $14 / 1,000 回
export const GROUNDING_USD_PER_REQUEST = 0.014;
export const GROUNDING_FREE_REQUESTS_PER_MONTH = 5000;
export const USD_TO_JPY = 150;

// Gemini の単価（2026-11 時点の公式料金表）。3.8 Flash は 2027-01-01 から倍になる。
export function resolveGeminiRate(model: string, at: Date = new Date()): ModelRate {
  const m = String(model || '').toLowerCase();
  const after2027 = at.getTime() >= Date.UTC(2027, 0, 1) - 9 * 60 * 60 * 1000;
  if (m.includes('3.8-flash') || m.includes('3.6-flash')) {
    return after2027 ? { input: 1.5, output: 7.5 } : { input: 0.75, output: 3.75 };
  }
  if (m.includes('3.1-pro')) return { input: 2.0, output: 12.0 };
  if (m.includes('3.5-flash-lite')) return { input: 0.3, output: 2.5 };
  if (m.includes('3.1-flash-lite')) return { input: 0.25, output: 1.5 };
  if (m.includes('4-argon')) return { input: 4.0, output: 20.0 };
  if (m.includes('2.5-pro')) return { input: 1.25, output: 10.0 };
  if (m.includes('2.5-flash')) return { input: 0.3, output: 2.5 };
  return { input: 1.5, output: 7.5 };
}

// ChatGPT・Claude の単価（役割ごとの AI で選んだとき用。2026-11 時点のおおよその料金）
export function resolveModelRate(model: string, at: Date = new Date()): ModelRate {
  const m = String(model || '').toLowerCase();
  if (m.startsWith('gpt-')) {
    if (m.includes('gpt-5.5')) return { input: 5.0, output: 30.0 };
    if (m.includes('mini')) return { input: 0.75, output: 4.5 };
    return { input: 2.5, output: 15.0 };
  }
  if (m.startsWith('claude-')) {
    if (m.includes('opus')) return { input: 5.0, output: 25.0 };
    if (m.includes('haiku')) return { input: 1.0, output: 5.0 };
    return { input: 3.0, output: 15.0 };
  }
  return resolveGeminiRate(model, at);
}

export interface ModelUsageSummary {
  model: string;
  calls: number;
  input_tokens: number;
  output_tokens: number;
  thoughts_tokens: number;
  estimated_usd: number;
}

export interface AiUsageSummary {
  models: ModelUsageSummary[];
  grounded_requests: number;
  search_queries: number;
  grounding_estimated_usd: number;
  total_estimated_usd: number;
  total_estimated_jpy: number;
  note: string;
}

export class AiUsageTracker {
  private byModel = new Map<string, { calls: number; input: number; output: number; thoughts: number }>();
  groundedRequests = 0;
  searchQueries = 0;

  record(model: string, usage: GeminiUsage, grounded = false, searchQueryCount = 0): void {
    const key = String(model || 'unknown');
    const current = this.byModel.get(key) || { calls: 0, input: 0, output: 0, thoughts: 0 };
    current.calls += 1;
    current.input += usage.inputTokens;
    current.output += usage.outputTokens;
    current.thoughts += usage.thoughtsTokens;
    this.byModel.set(key, current);
    if (grounded) {
      this.groundedRequests += 1;
      this.searchQueries += Math.max(0, searchQueryCount);
    }
  }

  get hasData(): boolean {
    return this.byModel.size > 0;
  }

  summarize(at: Date = new Date()): AiUsageSummary {
    const models: ModelUsageSummary[] = Array.from(this.byModel.entries()).map(([model, u]) => {
      const rate = resolveModelRate(model, at);
      // 思考トークンは出力単価で課金される
      const usd = (u.input / 1_000_000) * rate.input + ((u.output + u.thoughts) / 1_000_000) * rate.output;
      return {
        model,
        calls: u.calls,
        input_tokens: u.input,
        output_tokens: u.output,
        thoughts_tokens: u.thoughts,
        estimated_usd: Number(usd.toFixed(6)),
      };
    });
    const groundingUsd = this.groundedRequests * GROUNDING_USD_PER_REQUEST;
    const total = models.reduce((sum, m) => sum + m.estimated_usd, 0) + groundingUsd;
    return {
      models,
      grounded_requests: this.groundedRequests,
      search_queries: this.searchQueries,
      grounding_estimated_usd: Number(groundingUsd.toFixed(6)),
      total_estimated_usd: Number(total.toFixed(6)),
      total_estimated_jpy: Math.round(total * USD_TO_JPY),
      note: '有料キーの単価で計算。Google 検索は月5,000回の無料枠を考慮していない（無料枠内なら検索代は0）。',
    };
  }
}
