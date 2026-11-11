// タイトルセットの「使用済み」判定。予約投稿の実行側（scheduler-executor）と
// 予約投稿画面の両方で同じルールを使う。
//
// - 成功・実行中・手動で使用済みにした履歴があるタイトルは使用済み
// - 失敗した実行ではタイトルを消費しない（次回以降に再挑戦する）
// - ただし同じタイトルで MAX_TITLE_FAILURES 回失敗したら使用済み扱いにして飛ばす
//   （失敗し続けるタイトルで毎回 AI コストを使い続けないため）

export const MAX_TITLE_FAILURES = 3;

export interface TitleHistoryRow {
  article_title?: string | null;
  status?: string | null;
  // cost_breakdown.generation_debug.failure_stage
  failure_stage?: string | null;
}

// 実行ロック待ちでスキップされた履歴は、タイトルで記事生成を試みていないので失敗回数に数えない
const IGNORED_FAILURE_STAGES = new Set(['execution_lock']);

export const normalizeTitle = (value: unknown): string => String(value ?? '').trim();

export function summarizeTitleUsage(rows: TitleHistoryRow[]): {
  used: Set<string>;
  failures: Map<string, number>;
} {
  const used = new Set<string>();
  const failures = new Map<string, number>();

  for (const row of rows || []) {
    const title = normalizeTitle(row.article_title);
    if (!title) continue;

    if (row.status !== 'failed') {
      used.add(title);
      continue;
    }
    if (row.failure_stage && IGNORED_FAILURE_STAGES.has(row.failure_stage)) continue;

    const count = (failures.get(title) || 0) + 1;
    failures.set(title, count);
    if (count >= MAX_TITLE_FAILURES) used.add(title);
  }

  return { used, failures };
}

/** 次に使うタイトルを返す。未使用がなければ null。失敗したことのあるタイトルは後回しにする。 */
export function pickNextTitle(allTitles: string[], rows: TitleHistoryRow[]): string | null {
  const { used, failures } = summarizeTitleUsage(rows);
  const candidates = (allTitles || [])
    .map(normalizeTitle)
    .filter((title) => title && !used.has(title))
    .map((title, index) => ({ title, index, failures: failures.get(title) || 0 }))
    .sort((a, b) => a.failures - b.failures || a.index - b.index);
  return candidates[0]?.title ?? null;
}

/** 実行履歴から使用済みタイトルを取得するときの select 句 */
export const TITLE_USAGE_SELECT =
  'article_title, status, failure_stage:cost_breakdown->generation_debug->>failure_stage';
