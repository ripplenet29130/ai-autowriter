export type ArticleLength = 'short' | 'medium' | 'long';

export const TARGET_WORD_COUNT_BY_LENGTH: Record<ArticleLength, number> = {
  short: 1000,
  medium: 2000,
  long: 3000,
};

export const DEFAULT_TARGET_WORD_COUNT = TARGET_WORD_COUNT_BY_LENGTH.medium;
export const DEFAULT_WORD_COUNT_TOLERANCE = 0.1;

// 思考の上限（記事改善プラン 1-3）。自動投稿では環境変数で変えられる
export const DEFAULT_WRITER_THINKING_BUDGET = 4096;
export const DEFAULT_REVIEW_THINKING_BUDGET = 8192;

// 文字数は目安として扱う（1-6）。これより外れたときだけ AI で直す
export const LOOSE_LENGTH_MIN_RATIO = 0.5;
export const LOOSE_LENGTH_MAX_RATIO = 1.5;

// 1 見出しあたりの最低文字数（1-7）。導入を除く見出しの上限はこれで決める
export const MIN_CHARS_PER_HEADING = 250;

export function maxHeadingsForLength(targetChars: number): number {
  const target = Number.isFinite(targetChars) && targetChars > 0 ? targetChars : DEFAULT_TARGET_WORD_COUNT;
  return Math.max(4, Math.floor(target / MIN_CHARS_PER_HEADING));
}

export function getLooseWordCountBounds(targetWordCount: number): { minAllowed: number; maxAllowed: number } {
  return {
    minAllowed: Math.floor(targetWordCount * LOOSE_LENGTH_MIN_RATIO),
    maxAllowed: Math.ceil(targetWordCount * LOOSE_LENGTH_MAX_RATIO),
  };
}

export function resolveTargetWordCount(
  length?: ArticleLength,
  explicitTarget?: number
): number {
  if (explicitTarget && explicitTarget > 0) return explicitTarget;
  if (!length) return DEFAULT_TARGET_WORD_COUNT;
  return TARGET_WORD_COUNT_BY_LENGTH[length] ?? DEFAULT_TARGET_WORD_COUNT;
}

export function getWordCountBounds(
  targetWordCount: number,
  tolerance = DEFAULT_WORD_COUNT_TOLERANCE
): { minAllowed: number; maxAllowed: number } {
  return {
    minAllowed: Math.floor(targetWordCount * (1 - tolerance)),
    maxAllowed: Math.ceil(targetWordCount * (1 + tolerance)),
  };
}
