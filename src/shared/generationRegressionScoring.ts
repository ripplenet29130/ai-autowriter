export interface GenerationRegressionScores {
  wordCountA: number;
  wordCountB: number;
  wordCountDiff: number;
  wordCountDiffRate: number;
  structureSimilarity: number;
  overlapRate: number;
  duplicateRateA: number;
  duplicateRateB: number;
  readabilityA: number;
  readabilityB: number;
  readabilityDiff: number;
  overallScore: number;
}

function clamp(value: number, min = 0, max = 100): number {
  return Math.max(min, Math.min(max, value));
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

function normalizeText(text: string): string {
  return (text || '')
    .replace(/\r\n/g, '\n')
    .replace(/[ \t]+/g, ' ')
    .trim();
}

function countChars(text: string): number {
  const normalized = normalizeText(text)
    .replace(/^#+\s+/gm, '')
    .replace(/\*\*/g, '')
    .replace(/\*/g, '')
    .replace(/^[-*]\s+/gm, '');
  return normalized.length;
}

function tokenize(text: string): string[] {
  const tokens = normalizeText(text).match(/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}A-Za-z0-9]+/gu) || [];
  return tokens.map((t) => t.toLowerCase());
}

function jaccardSimilarity(a: string[], b: string[]): number {
  const setA = new Set(a);
  const setB = new Set(b);
  if (setA.size === 0 && setB.size === 0) return 1;
  const intersection = [...setA].filter((x) => setB.has(x)).length;
  const union = new Set([...setA, ...setB]).size || 1;
  return intersection / union;
}

function extractHeadingKeys(content: string): string[] {
  return normalizeText(content)
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => /^#{2,3}\s+/.test(line))
    .map((line) => line.replace(/^#{2,3}\s+/, '').toLowerCase());
}

function calcDuplicateRate(content: string): number {
  const paragraphs = normalizeText(content)
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter((p) => p.length > 0);

  if (paragraphs.length <= 1) return 0;
  const unique = new Set(paragraphs).size;
  return 1 - unique / paragraphs.length;
}

function calcReadability(content: string): number {
  const normalized = normalizeText(content);
  const sentences = normalized
    .split(/[。！？!?]/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);

  if (sentences.length === 0) return 0;

  const totalChars = countChars(normalized);
  const avgSentenceLength = totalChars / sentences.length;
  const headingCount = extractHeadingKeys(normalized).length;
  const paragraphCount = normalized.split(/\n{2,}/).filter(Boolean).length || 1;
  const headingDensity = headingCount / paragraphCount;

  // 目安: 1文35〜65文字、見出し密度0.15〜0.6を高評価
  const sentenceScore = clamp(100 - Math.abs(avgSentenceLength - 50) * 1.6);
  const densityScore = clamp(100 - Math.abs(headingDensity - 0.35) * 180);
  return (sentenceScore * 0.7 + densityScore * 0.3);
}

export function scoreGenerationRegression(contentA: string, contentB: string): GenerationRegressionScores {
  const wordCountA = countChars(contentA);
  const wordCountB = countChars(contentB);
  const maxCount = Math.max(wordCountA, wordCountB, 1);
  const wordCountDiff = Math.abs(wordCountA - wordCountB);
  const wordCountDiffRate = wordCountDiff / maxCount;

  const headingsA = extractHeadingKeys(contentA);
  const headingsB = extractHeadingKeys(contentB);
  const structureSimilarity = jaccardSimilarity(headingsA, headingsB) * 100;

  const overlapRate = jaccardSimilarity(tokenize(contentA), tokenize(contentB)) * 100;

  const duplicateRateA = calcDuplicateRate(contentA) * 100;
  const duplicateRateB = calcDuplicateRate(contentB) * 100;

  const readabilityA = calcReadability(contentA);
  const readabilityB = calcReadability(contentB);
  const readabilityDiff = Math.abs(readabilityA - readabilityB);

  const wordCountScore = clamp((1 - wordCountDiffRate) * 100);
  const duplicateScore = clamp(100 - Math.abs(duplicateRateA - duplicateRateB));
  const readabilityScore = clamp(100 - readabilityDiff);
  const overallScore = (
    wordCountScore * 0.2 +
    structureSimilarity * 0.3 +
    overlapRate * 0.25 +
    duplicateScore * 0.1 +
    readabilityScore * 0.15
  );

  return {
    wordCountA,
    wordCountB,
    wordCountDiff,
    wordCountDiffRate: round2(wordCountDiffRate),
    structureSimilarity: round2(structureSimilarity),
    overlapRate: round2(overlapRate),
    duplicateRateA: round2(duplicateRateA),
    duplicateRateB: round2(duplicateRateB),
    readabilityA: round2(readabilityA),
    readabilityB: round2(readabilityB),
    readabilityDiff: round2(readabilityDiff),
    overallScore: round2(overallScore),
  };
}
