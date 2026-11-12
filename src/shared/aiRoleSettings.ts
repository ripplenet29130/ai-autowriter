// 役割ごとの AI（AI 設定画面で選ぶ）
// 役割の一覧はこのファイルの AI_ROLES 1 か所にまとめる。設定画面・ジョブの設定・工程での AI の差し替え・通知は
// すべてこの一覧から作るので、役割を増やす／標準を変える／工程の受け持ちを変えるときは AI_ROLES だけ直せばよい。
// 保存の形: app_settings に「provider:model」（'auto' は Gemini の標準モデル）
import { getAiModelOptions, isAiProvider, normalizeAiModel, type AiProvider } from './aiModelCatalog.ts';

export type AiRole = 'research' | 'writer' | 'factcheck' | 'fix';

export interface AiRoleChoice {
  provider: AiProvider;
  model: string;
}

export interface AiRoleDefinition {
  id: AiRole;
  // app_settings のキー
  settingKey: string;
  // 通知・メモでの短い名前
  label: string;
  // 設定画面の見出しと説明
  title: string;
  description: string;
  // この役割が受け持つ工程（article-pipeline の工程名）。1 つの工程を複数の役割で分け合うこともある
  // （「修正と再確認」の工程は、直すのが「修正」、確かめ直すのが「ファクトチェック」）
  steps: string[];
  // 選べる AI（Gemini 以外は、その会社の API キーを保存したときだけ画面に出る）
  providers: AiProvider[];
  // Gemini を選んだとき、工程の基本モデル（base）と執筆モデル（writer）のどちらを差し替えるか
  geminiSlot: 'base' | 'writer';
  // 何も保存していないときの選択（'auto' = Gemini の標準）
  defaultValue: string;
}

export const AI_ROLES: readonly AiRoleDefinition[] = [
  {
    id: 'research',
    settingKey: 'ai_role_research',
    label: '調査',
    title: '調査に使う AI',
    description: '上位記事・Q&A サイト・公式情報を調べる AI です。ページの読み込みと Google 検索を同時に使うため、Gemini だけ選べます。',
    steps: ['research'],
    providers: ['gemini'],
    geminiSlot: 'base',
    defaultValue: 'auto',
  },
  {
    id: 'writer',
    settingKey: 'ai_role_writer',
    label: '執筆',
    title: '執筆に使う AI',
    description: '記事の本文を書く AI です（「広い調査＋1回で書き切る」書き方で使います）。ChatGPT・Claude では時間を優先して検索なしで書きます。',
    steps: ['draft'],
    providers: ['gemini', 'claude', 'openai'],
    geminiSlot: 'writer',
    defaultValue: 'auto',
  },
  {
    id: 'factcheck',
    settingKey: 'ai_role_factcheck',
    label: 'ファクトチェック',
    title: 'ファクトチェックに使う AI',
    description: '本文の主張を Web 検索で確かめ、直したあとにもう一度確かめる AI です。書いた AI と別の AI にすると、同じ思い込みで見逃すことが減ります。',
    steps: ['factcheck', 'fix'],
    providers: ['openai', 'claude', 'gemini'],
    geminiSlot: 'base',
    defaultValue: 'openai:gpt-5.4',
  },
  {
    id: 'fix',
    settingKey: 'ai_role_fix',
    label: '修正',
    title: '修正に使う AI',
    description: 'ファクトチェックで見つかった誤りを直す AI です。Gemini は記事全体を書き直して直すので、前後の文のつながりが自然です。ChatGPT・Claude は検索で確かめてから、誤りのある文だけを置き換えます。',
    steps: ['fix'],
    providers: ['gemini', 'openai', 'claude'],
    geminiSlot: 'base',
    defaultValue: 'auto',
  },
];

export const AI_PROVIDER_LABELS: Record<AiProvider, string> = {
  openai: 'ChatGPT（OpenAI）',
  claude: 'Claude（Anthropic）',
  gemini: 'Gemini（Google）',
};

export type AiRoleValues = Record<AiRole, string>;

export function getAiRole(id: AiRole): AiRoleDefinition {
  return AI_ROLES.find((role) => role.id === id) as AiRoleDefinition;
}

export function aiRolesForStep(step: string): AiRoleDefinition[] {
  return AI_ROLES.filter((role) => role.steps.includes(step));
}

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

// 1 つの役割の値を整える。空・未保存なら標準、選べない AI なら 'auto'
export function normalizeAiRoleValue(role: AiRoleDefinition, value: unknown): string {
  const raw = String(value ?? '').trim();
  if (!raw) return role.defaultValue;
  const choice = parseAiRoleChoice(raw);
  if (!choice) return 'auto';
  return role.providers.includes(choice.provider) ? formatAiRoleChoice(choice) : 'auto';
}

export function normalizeAiRoleValues(raw: Partial<Record<string, unknown>> | null | undefined): AiRoleValues {
  const values = {} as AiRoleValues;
  for (const role of AI_ROLES) values[role.id] = normalizeAiRoleValue(role, raw?.[role.id]);
  return values;
}

export function describeAiRoleChoice(choice: AiRoleChoice | null): string {
  if (!choice) return 'Gemini（標準）';
  const option = getAiModelOptions(choice.provider).find((o) => o.value === choice.model);
  return `${AI_PROVIDER_LABELS[choice.provider]} ${option?.label || choice.model}`;
}

// 通知用: 「調査 Gemini（標準） / 執筆 … / ファクトチェック・修正 …」
export function describeAiRoleValues(values: AiRoleValues): string {
  return AI_ROLES.map((role) => `${role.label} ${describeAiRoleChoice(parseAiRoleChoice(values[role.id]))}`).join(' / ');
}
