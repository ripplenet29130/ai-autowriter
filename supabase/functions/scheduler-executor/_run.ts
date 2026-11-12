// 自動投稿 1 回分の Gemini 呼び出しと時間管理
// - 工程ごとのモデル切り替え（基本モデル / 執筆モデル）と Pro が使えないときの自動代替
// - 429（回数制限）の再試行
// - トークン数・検索回数の記録
// - Edge Function の実行時間上限に対する残り時間の管理
import { AiUsageTracker } from '../../../src/shared/aiUsage.ts';
import {
  isModelUnavailableError,
  isRateLimitError,
  isSearchUnsupportedError,
  isThinkingConfigError,
  requestGeminiOnce,
  resolveRedirectUrls,
  sleep,
  type GeminiCallOptions,
  type GeminiRequestOptions,
  type ParsedGeminiResponse,
} from '../../../src/shared/geminiCore.ts';
import { AI_REQUEST_TIMEOUT_MS } from './_shared.ts';

// 無料プラン（150 秒）から余裕を取った既定値。有料プランでは 380 に変更する。
export const DEFAULT_SCHEDULER_TIME_BUDGET_SECONDS = 140;
export const DEFAULT_GEMINI_MAX_PARALLEL = 2;
const MAX_RATE_LIMIT_RETRIES = 3;

export function readSchedulerTimeBudgetMs(): number {
  const raw = Number(Deno.env.get('SCHEDULER_TIME_BUDGET_SECONDS'));
  const seconds = Number.isFinite(raw) && raw >= 60 ? raw : DEFAULT_SCHEDULER_TIME_BUDGET_SECONDS;
  return seconds * 1000;
}

export function readGeminiMaxParallel(): number {
  const raw = Number(Deno.env.get('GEMINI_MAX_PARALLEL'));
  return Number.isInteger(raw) && raw >= 1 && raw <= 8 ? raw : DEFAULT_GEMINI_MAX_PARALLEL;
}

// 本文のセクションを順番に書くか並列に書くか（記事改善プラン 1-5）。
// sequential: それまでの本文を全文渡して順番に書く（質が高いが時間がかかる）
// parallel: H2 ごとに並列で書く（既定。無料の Supabase の 140 秒に収めやすい）
export type SectionWritingMode = 'sequential' | 'parallel';

export function readSectionWritingMode(): SectionWritingMode {
  return String(Deno.env.get('SECTION_WRITING_MODE') || '').trim().toLowerCase() === 'sequential'
    ? 'sequential'
    : 'parallel';
}

export class SearchUnavailableError extends Error {
  constructor(message = 'Google 検索を使えないキーです') {
    super(message);
    this.name = 'SearchUnavailableError';
  }
}

export class GenerationRun {
  readonly tracker = new AiUsageTracker();
  readonly notes: string[] = [];
  readonly skippedSteps: string[] = [];
  proUnavailable = false;
  searchUnavailable = false;
  writerCalls = 0;

  constructor(
    readonly startTime: number,
    readonly budgetMs: number,
    readonly apiKey: string,
    readonly baseModel: string,
    readonly writerModel: string,
    // true なら、基本モデルと執筆モデルが同じでも執筆の思考を止めない（新方式で全工程を Pro にする場合）。
    // false（今の自動投稿）では、執筆モデルを使えないとき時間を優先して思考を止める
    readonly keepWriterThinking = false,
  ) {}

  get usesWriterModel(): boolean {
    return this.writerModel !== this.baseModel && !this.proUnavailable;
  }

  // 執筆に実際に使ったモデル（通知用）
  get effectiveWriterModel(): string {
    return this.usesWriterModel ? this.writerModel : this.baseModel;
  }

  elapsedMs(): number {
    return Date.now() - this.startTime;
  }

  remainingMs(): number {
    return this.budgetMs - this.elapsedMs();
  }

  hasTime(requiredMs: number): boolean {
    return this.remainingMs() >= requiredMs;
  }

  skip(step: string): void {
    if (!this.skippedSteps.includes(step)) this.skippedSteps.push(step);
    console.warn(`[run] Skipped step due to time budget: ${step} (remaining ${Math.round(this.remainingMs() / 1000)}s)`);
  }

  note(message: string): void {
    if (!this.notes.includes(message)) this.notes.push(message);
  }

  // 工程から呼ぶ入口（GeminiCaller 互換）
  call = async (prompt: string, options: GeminiCallOptions): Promise<ParsedGeminiResponse> => {
    const wantsWriter = options.role === 'writer' && this.usesWriterModel;
    const model = wantsWriter ? this.writerModel : this.baseModel;

    if (options.useSearch && this.searchUnavailable) {
      throw new SearchUnavailableError();
    }

    // 執筆モデルが使えず基本モデルで代わりに書く場合は、時間を優先して思考を止める
    const writerThinks = options.role === 'writer' && (wantsWriter || (this.keepWriterThinking && !this.proUnavailable));
    const thinkingBudget = options.role === 'writer' && !writerThinks ? 0 : options.thinkingBudget;
    const extraThinkingTokens = typeof thinkingBudget === 'number' && thinkingBudget > 0 ? thinkingBudget : 0;
    const requestOptions: GeminiRequestOptions = {
      prompt,
      maxOutputTokens: options.maxOutputTokens + (writerThinks ? extraThinkingTokens : 0),
      temperature: options.temperature,
      thinkingBudget,
      useSearch: options.useSearch,
      jsonOutput: options.jsonOutput,
    };

    try {
      if (wantsWriter) this.writerCalls += 1;
      return await this.request(model, requestOptions, !wantsWriter);
    } catch (error) {
      if (wantsWriter && isModelUnavailableError(error)) {
        this.proUnavailable = true;
        this.note(`${this.writerModel} が使えなかったため ${this.baseModel} で執筆しました（無料キーでは Pro を使えません）`);
        console.warn(`[run] Writer model unavailable; falling back to ${this.baseModel}:`, error);
        return this.call(prompt, options);
      }
      if (options.useSearch && isSearchUnsupportedError(error)) {
        this.searchUnavailable = true;
        this.note('このキーでは Google 検索を使えないため、検索なしで処理しました');
        throw new SearchUnavailableError();
      }
      throw error;
    }
  };

  resolveUrls = (urls: string[]): Promise<Record<string, string>> => {
    const timeout = Math.max(2000, Math.min(5000, this.remainingMs() - 20_000));
    return resolveRedirectUrls(urls, timeout);
  };

  private async request(model: string, options: GeminiRequestOptions, retryOnRateLimit: boolean): Promise<ParsedGeminiResponse> {
    let current = { ...options };
    for (let attempt = 0; ; attempt++) {
      const timeoutMs = Math.max(20_000, Math.min(AI_REQUEST_TIMEOUT_MS, this.remainingMs() - 5_000));
      try {
        const response = await requestGeminiOnce({ apiKey: this.apiKey, model, options: current, timeoutMs });
        this.tracker.record(model, response.usage, response.grounded, response.searchQueries.length);
        return response;
      } catch (error) {
        if (isThinkingConfigError(error) && typeof current.thinkingBudget === 'number') {
          // 思考設定に対応していないモデルでは、指定を外して同じ条件で再試行する
          current = { ...current, thinkingBudget: null };
          continue;
        }
        if (retryOnRateLimit && isRateLimitError(error) && attempt < MAX_RATE_LIMIT_RETRIES) {
          const suggested = (error as { retryAfterMs?: number | null })?.retryAfterMs;
          const waitMs = suggested && suggested > 0 ? suggested : 2000 * 2 ** attempt;
          if (waitMs > this.remainingMs() - 25_000) throw error;
          console.warn(`[run] Gemini rate limited (${model}); waiting ${Math.round(waitMs / 1000)}s before retry`);
          await sleep(waitMs);
          continue;
        }
        throw error;
      }
    }
  }
}

// 期限内に終わらなければ null を返す（処理自体は止められないが、待たずに先へ進む）
export async function withDeadline<T>(promise: Promise<T>, ms: number): Promise<T | null> {
  let timer: number | undefined;
  const timeout = new Promise<null>((resolve) => {
    timer = setTimeout(() => resolve(null), Math.max(0, ms));
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    clearTimeout(timer);
  }
}
