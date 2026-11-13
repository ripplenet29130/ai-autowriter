// 手動生成（ブラウザ）用の Gemini 呼び出し口。ai-proxy 経由で呼ぶ。
// 自動投稿の GenerationRun と同じく、Pro が使えないときの自動代替・429 の再試行・利用量の記録を行う。
import { AiProxyError, callAiProxy } from './aiProxyClient';
import { aiService } from './aiService';
import {
  DEFAULT_QUALITY_MODE,
  getDefaultAiModel,
  normalizeQualityMode,
  resolveWritingModel,
  type QualityMode,
} from '../shared/aiModelCatalog';
import { AiUsageTracker } from '../shared/aiUsage';
import {
  isModelUnavailableError,
  isRateLimitError,
  parseGeminiResponse,
  parseGeminiRetryDelayMs,
  sleep,
  type GeminiCallOptions,
  type ParsedGeminiResponse,
} from '../shared/geminiCore';

const MAX_RATE_LIMIT_RETRIES = 3;
const MAX_RATE_LIMIT_WAIT_MS = 60_000;

// --- 画面で選んだ品質設定（ブラウザごとの設定として保存） ---

const PREFS_STORAGE_KEY = 'generation_quality_prefs';

export interface GenerationQualityPrefs {
  qualityMode: QualityMode;
  appendReferences: boolean;
}

export function getGenerationQualityPrefs(): GenerationQualityPrefs {
  try {
    const raw = window.localStorage.getItem(PREFS_STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : {};
    return {
      qualityMode: normalizeQualityMode(parsed?.qualityMode),
      appendReferences: parsed?.appendReferences === true,
    };
  } catch {
    return { qualityMode: DEFAULT_QUALITY_MODE, appendReferences: false };
  }
}

export function setGenerationQualityPrefs(prefs: GenerationQualityPrefs): void {
  try {
    window.localStorage.setItem(PREFS_STORAGE_KEY, JSON.stringify(prefs));
  } catch {
    // 保存できなくても生成はできる
  }
}

// ai-proxy のエラー文言から Gemini 側のステータスを取り出す
class ProxiedGeminiError extends Error {
  status: number;
  retryAfterMs: number | null;

  constructor(message: string, status: number) {
    super(message);
    this.name = 'ProxiedGeminiError';
    this.status = status;
    this.retryAfterMs = parseGeminiRetryDelayMs(message);
  }
}

const toGeminiError = (error: unknown): unknown => {
  const message = error instanceof Error ? error.message : String(error || '');
  const match = message.match(/Gemini API error \((\d{3})\)/);
  if (match) return new ProxiedGeminiError(message, Number(match[1]));
  if (error instanceof AiProxyError) return error;
  return error;
};

export class GeminiSession {
  readonly tracker = new AiUsageTracker();
  readonly notes: string[] = [];
  proUnavailable = false;

  constructor(
    readonly configId: string | null,
    readonly baseModel: string,
    readonly writerModel: string,
    readonly qualityMode: QualityMode,
  ) {}

  get usesWriterModel(): boolean {
    return this.writerModel !== this.baseModel && !this.proUnavailable;
  }

  get effectiveWriterModel(): string {
    return this.usesWriterModel ? this.writerModel : this.baseModel;
  }

  private note(message: string) {
    if (!this.notes.includes(message)) this.notes.push(message);
  }

  call = async (prompt: string, options: GeminiCallOptions): Promise<ParsedGeminiResponse> => {
    const wantsWriter = options.role === 'writer' && this.usesWriterModel;
    const model = wantsWriter ? this.writerModel : this.baseModel;
    const thinkingBudget = options.role === 'writer' && !wantsWriter ? 0 : options.thinkingBudget;
    const extra = wantsWriter && typeof thinkingBudget === 'number' && thinkingBudget > 0 ? thinkingBudget : 0;

    for (let attempt = 0; ; attempt++) {
      try {
        const data = await callAiProxy({
          provider: 'gemini',
          ...(this.configId ? { configId: this.configId } : {}),
          model,
          temperature: options.temperature ?? 0.7,
          maxTokens: options.maxOutputTokens + extra,
          prompt,
          useSearch: options.useSearch === true,
          jsonOutput: options.jsonOutput === true,
          ...(typeof thinkingBudget === 'number' ? { thinkingBudget } : {}),
        });
        const parsed = parseGeminiResponse(data, model);
        this.tracker.record(model, parsed.usage, parsed.grounded, parsed.searchQueries.length);
        return parsed;
      } catch (rawError) {
        const error = toGeminiError(rawError);
        if (wantsWriter && isModelUnavailableError(error)) {
          this.proUnavailable = true;
          this.note(`${this.writerModel} が使えなかったため ${this.baseModel} で執筆しました（無料キーでは Pro を使えません）`);
          return this.call(prompt, options);
        }
        if (!wantsWriter && isRateLimitError(error) && attempt < MAX_RATE_LIMIT_RETRIES) {
          const suggested = (error as { retryAfterMs?: number | null }).retryAfterMs;
          const waitMs = suggested && suggested > 0 ? suggested : 2000 * 2 ** attempt;
          if (waitMs <= MAX_RATE_LIMIT_WAIT_MS) {
            await sleep(waitMs);
            continue;
          }
        }
        throw error;
      }
    }
  };

  // 文字列だけが欲しい呼び出し（共通の記事生成部品用）
  callText = async (prompt: string, options: GeminiCallOptions): Promise<string> => {
    const response = await this.call(prompt, options);
    return response.text;
  };

  resolveUrls = async (urls: string[]): Promise<Record<string, string>> => {
    if (urls.length === 0) return {};
    const data = await callAiProxy({ type: 'resolve-urls', urls });
    return (data?.resolved && typeof data.resolved === 'object') ? data.resolved : {};
  };
}

// 有効な AI 設定から Gemini の呼び出し口を作る。
// Gemini 以外で生成している場合も、ai-proxy がユーザーの Gemini 設定のキーを探してファクトチェックに使う。
export async function createGeminiSession(qualityMode?: QualityMode): Promise<GeminiSession> {
  if (!aiService.getActiveConfig()) {
    await aiService.loadActiveConfig();
  }
  const config = aiService.getActiveConfig();
  const mode = qualityMode ?? getGenerationQualityPrefs().qualityMode;
  const isGemini = config?.provider === 'gemini';
  const baseModel = isGemini && config?.model ? config.model : getDefaultAiModel('gemini');
  const writerModel = isGemini ? resolveWritingModel('gemini', baseModel, mode) : baseModel;
  return new GeminiSession(isGemini ? config?.id || null : null, baseModel, writerModel, mode);
}

export function isGeminiActiveProvider(): boolean {
  return aiService.getActiveConfig()?.provider === 'gemini';
}
