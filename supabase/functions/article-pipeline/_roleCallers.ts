// AI 設定で選んだ役割ごとの AI を、工程ごとに用意する（役割の一覧は src/shared/aiRoleSettings.ts の AI_ROLES）
// - Gemini を選んだ役割: その工程で使う Gemini のモデルを差し替える（GenerationRun を作る前に決める）
// - ChatGPT・Claude を選んだ役割: その API キーで呼び出し口を作る。
//   キーがないとき・呼び出しが失敗したときは Gemini で続け、注意に残す
// 1 つの工程を複数の役割で分け合うことがある（「修正と再確認」= 修正の役割＋ファクトチェックの役割）
import {
  aiRolesForStep,
  describeAiRoleChoice,
  parseAiRoleChoice,
  type AiRole,
  type AiRoleChoice,
} from '../../../src/shared/aiRoleSettings.ts';
import { createExternalCaller } from '../../../src/shared/externalAiCaller.ts';
import type { GeminiCaller } from '../../../src/shared/geminiCore.ts';
import type { GenerationRun } from '../scheduler-executor/_run.ts';
import type { JobSettings, RoleCaller, StepName } from './_steps.ts';

export type RoleCallers = Partial<Record<AiRole, RoleCaller>>;

export function roleChoiceFor(settings: JobSettings, role: AiRole): AiRoleChoice | null {
  return parseAiRoleChoice(settings.aiRoles?.[role]);
}

// Gemini のモデルを選んだ役割の工程では、基本モデルか執筆モデルを差し替える
// （同じ工程で複数の役割が Gemini のモデルを選んでいたら、一覧であとの役割を優先する）
export function geminiModelsForStep(
  step: StepName,
  settings: JobSettings,
  models: { base: string; writer: string },
): { base: string; writer: string } {
  let result = models;
  for (const role of aiRolesForStep(step)) {
    const choice = roleChoiceFor(settings, role.id);
    if (choice?.provider !== 'gemini') continue;
    result = role.geminiSlot === 'writer' ? { ...result, writer: choice.model } : { ...result, base: choice.model };
  }
  return result;
}

// 工程の中で ChatGPT・Claude が失敗したら、残りは Gemini で行う
function withGeminiFallback(primary: GeminiCaller, run: GenerationRun, label: string, roleLabel: string): GeminiCaller {
  let failed = false;
  return async (prompt, options) => {
    if (!failed) {
      try {
        return await primary(prompt, options);
      } catch (error) {
        if (!run.hasTime(40_000)) throw error;
        failed = true;
        const reason = error instanceof Error ? error.message.slice(0, 120) : String(error);
        run.note(`${roleLabel}で ${label} が失敗したため、Gemini で続けました（${reason}）`);
      }
    }
    return run.call(prompt, options);
  };
}

// この工程で使う ChatGPT・Claude の呼び出し口（役割ごと）。Gemini の役割は含めない（工程側で run.call を使う）
export async function externalCallersForStep(params: {
  step: StepName;
  settings: JobSettings;
  run: GenerationRun;
  loadApiKey: (provider: 'openai' | 'claude') => Promise<string | null>;
}): Promise<RoleCallers> {
  const run = params.run;
  const callers: RoleCallers = {};
  for (const role of aiRolesForStep(params.step)) {
    const choice = roleChoiceFor(params.settings, role.id);
    if (!choice || choice.provider === 'gemini') continue;
    const label = describeAiRoleChoice(choice);
    const apiKey = await params.loadApiKey(choice.provider);
    if (!apiKey) {
      run.note(`${role.label}に選んだ ${label} の API キーがないため、Gemini で行いました`);
      continue;
    }
    callers[role.id] = {
      label,
      call: withGeminiFallback(
        createExternalCaller({
          provider: choice.provider,
          apiKey,
          model: choice.model,
          timeoutMs: () => Math.min(180_000, run.remainingMs() - 5_000),
          onUsage: (model, usage, grounded, queries) => run.tracker.record(model, usage, grounded, queries),
        }),
        run,
        label,
        role.label,
      ),
    };
  }
  return callers;
}
