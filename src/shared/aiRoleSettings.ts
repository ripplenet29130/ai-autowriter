// 役割ごとの AI（AI 設定画面で選ぶ）
// - 執筆: 新方式（広い調査＋1回で書き切る）の本文を書く AI
// - ファクトチェック: 本文の主張を抜き出し、Web 検索で確かめる AI
// app_settings に「provider:model」の形で保存する。'auto' または未設定なら今まで通り Gemini を使う
import { getAiModelOptions, isAiProvider, normalizeAiModel, type AiProvider } from './aiModelCatalog.ts';

export type AiRole = 'writer' | 'factcheck';

export interface AiRoleChoice {
  provider: AiProvider;
  model: string;
}

export const AI_ROLE_SETTING_KEYS: Record<AiRole, string> = {
  writer: 'ai_role_writer',
  factcheck: 'ai_role_factcheck',
};

export const AI_ROLE_LABELS: Record<AiRole, string> = {
  writer: '執筆',
  factcheck: 'ファクトチェック',
};

export const AI_PROVIDER_LABELS: Record<AiProvider, string> = {
  openai: 'ChatGPT（OpenAI）',
  claude: 'Claude（Anthropic）',
  gemini: 'Gemini（Google）',
};

export function parseAiRoleChoice(value: unknown): AiRoleChoice | null {
  const raw = String(value ?? '').trim();
  if (!raw || raw === 'auto') return null;
  const index = raw.indexOf(':');
  if (index <= 0) return null;
  const provider = raw.slice(0, index).toLowerCase();
  if (!isAiProvider(provider)) return null;
  const model = normalizeAiModel(provider, raw.slice(index + 1));
  return model ? { provider, model } : null;
}

export function formatAiRoleChoice(choice: AiRoleChoice | null): string {
  return choice ? `${choice.provider}:${choice.model}` : 'auto';
}

export function describeAiRoleChoice(choice: AiRoleChoice | null): string {
  if (!choice) return 'おまかせ（Gemini）';
  const option = getAiModelOptions(choice.provider).find((o) => o.value === choice.model);
  return `${AI_PROVIDER_LABELS[choice.provider]} ${option?.label || choice.model}`;
}
