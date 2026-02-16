export type ArticleLength = 'short' | 'medium' | 'long';

export const TARGET_WORD_COUNT_BY_LENGTH: Record<ArticleLength, number> = {
  short: 1000,
  medium: 2000,
  long: 4000,
};

export const DEFAULT_TARGET_WORD_COUNT = TARGET_WORD_COUNT_BY_LENGTH.medium;
export const DEFAULT_WORD_COUNT_TOLERANCE = 0.1;

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
