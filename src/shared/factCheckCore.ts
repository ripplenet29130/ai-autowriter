export type FactCheckVerdict = 'correct' | 'incorrect' | 'partially_correct' | 'unverified';

export type FactCheckItem = {
  claim: string;
  context: string;
  priority: 'high' | 'normal';
};

export type FactCheckResult = {
  claim: string;
  verdict: FactCheckVerdict;
  confidence: number;
  correctInfo?: string;
  sourceUrl: string;
  explanation: string;
};

export type PerplexityBatchResult = {
  claim_number: number;
  verdict: FactCheckVerdict;
  confidence: number;
  correct_info?: string;
  source_url?: string;
  explanation?: string;
};

type Candidate = FactCheckItem & { score: number };

export const DEFAULT_FACT_CHECK_MAX_ITEMS = 50;
export const DEFAULT_FACT_CHECK_BATCH_SIZE = 10;
export const DEFAULT_FACT_CHECK_MODEL_NAME = 'sonar';
export const FACT_CHECK_REQUEST_TIMEOUT_MS = 90 * 1000;
export const FACT_CHECK_MAX_RETRIES = 2;

export class FactCheckHttpError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = 'FactCheckHttpError';
    this.status = status;
  }
}

// 429 / 5xx / ネットワーク断・タイムアウトのみリトライ対象とする（4xx は設定ミスなので即失敗）
export const isRetryableFactCheckError = (error: unknown): boolean => {
  const status = (error as { status?: unknown })?.status;
  if (typeof status === 'number') return status === 429 || status >= 500;
  if (error instanceof Error) {
    return error.name === 'AbortError'
      || error.name === 'TimeoutError'
      || /network|fetch|abort|timeout|秒以内に完了しませんでした/i.test(error.message);
  }
  return false;
};

export const runWithFactCheckRetries = async <T>(
  operation: () => Promise<T>,
  maxRetries = FACT_CHECK_MAX_RETRIES,
  baseDelayMs = 1500,
): Promise<T> => {
  let lastError: unknown;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      if (attempt === maxRetries || !isRetryableFactCheckError(error)) throw error;
      await new Promise((resolve) => setTimeout(resolve, baseDelayMs * 2 ** attempt));
    }
  }
  throw lastError;
};

// Perplexity の structured output（JSON Schema）。ルートはオブジェクト必須のため results で包む。
export const buildFactCheckResponseFormat = () => ({
  type: 'json_schema',
  json_schema: {
    schema: {
      type: 'object',
      properties: {
        results: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              claim_number: { type: 'integer' },
              verdict: { type: 'string', enum: ['correct', 'incorrect', 'partially_correct', 'unverified'] },
              confidence: { type: 'number' },
              correct_info: { type: 'string' },
              explanation: { type: 'string' },
              source_url: { type: 'string' },
            },
            required: ['claim_number', 'verdict'],
          },
        },
      },
      required: ['results'],
    },
  },
});

const normalize = (text: string): string => text.replace(/\s+/g, ' ').trim();

export const normalizeFactCheckConfidence = (value: unknown): number => {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  if (n <= 0) return 0;
  if (n <= 1) return Math.round(n * 100);
  return Math.round(Math.min(100, n));
};

const hasInvalidAmountPattern = (text: string): boolean => {
  const t = text.replace(/\s+/g, '');
  return (
    /いくらか[,，]?0{3,}(?:円|万円|千円)/.test(t) ||
    /(^|[^\d])[,，]?0{3,}(?:円|万円|千円)/.test(t) ||
    /(約|およそ)?[,，]0{3,}(?:円|万円|千円)/.test(t)
  );
};

export const extractFactsFromContent = (content: string, userMarkedText?: string): FactCheckItem[] => {
  const candidates: Candidate[] = [];

  const numberRegex = /\d{1,3}(?:,\d{3})*(?:\.\d+)?(?:%|円|ドル|人|件|倍|km|kg|万|億)?/;
  const dateRegex = /\d{4}年\d{1,2}月\d{1,2}日|\d{4}年\d{1,2}月|\d{4}年/;
  const quoteRegex = /「[^」]{2,80}」|『[^』]{2,80}』/;
  const compareRegex = /増加|減少|上昇|下落|最多|最少|最大|最小|上回|下回|高い|低い|急増|急減/;
  const sourceRegex = /によると|発表|公表|報告|調査|統計|データ|出典/;
  const katakanaRegex = /[ァ-ヶー]{3,}/;

  const scoreSentence = (sentence: string): number => {
    let score = 0;
    if (numberRegex.test(sentence)) score += 4;
    if (dateRegex.test(sentence)) score += 4;
    if (quoteRegex.test(sentence)) score += 3;
    if (compareRegex.test(sentence)) score += 2;
    if (sourceRegex.test(sentence)) score += 2;
    if (katakanaRegex.test(sentence)) score += 1;
    if (sentence.length >= 20 && sentence.length <= 220) score += 1;
    return score;
  };

  if (userMarkedText) {
    const markedRegex = /\[\[(.+?)\]\]/g;
    let mark: RegExpExecArray | null;
    while ((mark = markedRegex.exec(userMarkedText)) !== null) {
      const claim = normalize(mark[1]);
      if (!claim) continue;
      const start = Math.max(0, mark.index - 80);
      const end = Math.min(userMarkedText.length, mark.index + mark[0].length + 80);
      candidates.push({
        claim,
        context: userMarkedText.slice(start, end),
        priority: 'high',
        score: 100,
      });
    }
  }

  const paragraphs = content
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter((p) => p.length > 0);

  for (const paragraph of paragraphs) {
    const sentenceCandidates = paragraph
      .split(/(?<=[。！？!?])\s+|\n+/)
      .map((s) => normalize(s))
      .filter((s) => s.length >= 12);

    const ranked = sentenceCandidates
      .map((sentence) => {
        const score = scoreSentence(sentence);
        return {
          claim: sentence,
          context: paragraph,
          priority: score >= 7 ? ('high' as const) : ('normal' as const),
          score,
        };
      })
      .filter((c) => c.score >= 2)
      .sort((a, b) => {
        if (a.priority !== b.priority) return a.priority === 'high' ? -1 : 1;
        return b.score - a.score;
      });

    candidates.push(...ranked);
  }

  const deduped = new Map<string, Candidate>();
  for (const candidate of candidates) {
    const key = normalize(candidate.claim);
    const existing = deduped.get(key);
    if (!existing || candidate.score > existing.score) {
      deduped.set(key, candidate);
    }
  }

  return Array.from(deduped.values())
    .sort((a, b) => {
      if (a.priority !== b.priority) return a.priority === 'high' ? -1 : 1;
      return b.score - a.score;
    })
    .map(({ claim, context, priority }) => ({ claim, context, priority }));
};

export const selectFactCheckItems = (items: FactCheckItem[], maxItems?: number | null): FactCheckItem[] => {
  if (maxItems == null) return items;
  return items.slice(0, Math.max(1, maxItems));
};

export const buildFactCheckPrompt = (batch: FactCheckItem[], keyword: string): string => {
  const claimsList = batch
    .map((item, idx) => `${idx + 1}. 主張: ${item.claim}\n   文脈: ${item.context}`)
    .join('\n\n');

  return [
    '次の主張を最新の公開情報で検証してください。',
    '',
    '【チェック対象】',
    claimsList,
    '',
    `【関連キーワード】${keyword}`,
    '',
    '判定ルール: 金額や数値が欠落している表現（例: いくらか,000円 / ,000円）は incorrect を返してください。',
    '判定ルール: 主張の一部でも重大な数値誤り・相場誤りがあれば partially_correct ではなく incorrect を返してください。',
    '次のJSON配列のみを返してください。',
    '[',
    '  {',
    '    "claim_number": 1,',
    '    "verdict": "correct | incorrect | partially_correct | unverified",',
    '    "confidence": 0,',
    '    "correct_info": "補足情報",',
    '    "explanation": "理由",',
    '    "source_url": "https://..."',
    '  }',
    ']',
  ].join('\n');
};

// 配列そのもの / {results: [...]} / それ以外は null
const coerceBatchResults = (value: unknown): PerplexityBatchResult[] | null => {
  if (Array.isArray(value)) return value as PerplexityBatchResult[];
  if (value && typeof value === 'object') {
    const results = (value as { results?: unknown }).results;
    if (Array.isArray(results)) return results as PerplexityBatchResult[];
  }
  return null;
};

export const parseFactCheckBatchResults = (batch: FactCheckItem[], content: string): FactCheckResult[] => {
  let batchResults: PerplexityBatchResult[] | null = null;

  // 1. structured output ならそのまま JSON として読める
  try {
    batchResults = coerceBatchResults(JSON.parse(content));
  } catch {
    // fall through
  }

  // 2. 前後に説明文が付いた応答から JSON 部分を切り出す（従来動作）
  if (!batchResults) {
    const jsonMatch = content.match(/\[[\s\S]*\]|\{[\s\S]*\}/);
    if (jsonMatch) {
      try {
        batchResults = coerceBatchResults(JSON.parse(jsonMatch[0]));
      } catch {
        // fall through
      }
    }
  }

  if (!batchResults) {
    batchResults = batch.map((_, idx) => ({
      claim_number: idx + 1,
      verdict: 'unverified',
      confidence: 0,
      explanation: 'レスポンスの解析に失敗しました',
      source_url: '',
    }));
  }

  // claim_number が返っていれば番号で突き合わせる。位置での対応付けは
  // claim_number が一切無い応答へのフォールバックに限定する（順序ズレの誤対応を防ぐ）。
  const hasClaimNumbers = batchResults.some((r) => typeof r?.claim_number === 'number');

  return batch.flatMap((item, idx) => {
    const result = hasClaimNumbers
      ? batchResults!.find((r) => r?.claim_number === idx + 1)
      : batchResults![idx];
    if (!result) {
      return [{
        claim: item.claim,
        verdict: 'unverified' as FactCheckVerdict,
        confidence: 0,
        sourceUrl: '',
        explanation: 'モデル応答に対応する結果が含まれていませんでした',
      }];
    }

    let verdict = result.verdict;
    let confidence = normalizeFactCheckConfidence(result.confidence);
    let explanation = result.explanation ?? '';

    if (hasInvalidAmountPattern(item.claim) && verdict !== 'incorrect') {
      verdict = 'incorrect';
      confidence = Math.max(confidence, 85);
      explanation = explanation
        ? `金額表現が欠落しているため不正確として扱いました。 ${explanation}`
        : '金額表現が欠落しているため不正確として扱いました。';
    }

    return {
      claim: item.claim,
      verdict,
      confidence,
      correctInfo: result.correct_info,
      sourceUrl: result.source_url ?? '',
      explanation,
    };
  });
};

export const getFixableFactCheckIssues = (results: FactCheckResult[]): FactCheckResult[] =>
  results.filter(
    (result) =>
      result.verdict === 'incorrect' ||
      result.verdict === 'partially_correct' ||
      result.verdict === 'unverified'
  );

export const hasFixableFactCheckIssues = (results: FactCheckResult[]): boolean =>
  getFixableFactCheckIssues(results).length > 0;

export const buildFactCheckCorrectionPrompt = (
  originalContent: string,
  results: FactCheckResult[],
  keyword: string
): string | null => {
  const issues = getFixableFactCheckIssues(results);
  if (issues.length === 0) return null;

  const issuesText = issues
    .slice(0, 20)
    .map((result, idx) => {
      const evidence = result.correctInfo ? `\n- 修正情報: ${result.correctInfo}` : '';
      const source = result.sourceUrl ? `\n- 出典: ${result.sourceUrl}` : '';
      return `${idx + 1}. 主張: ${result.claim}\n- 判定: ${result.verdict} (${normalizeFactCheckConfidence(
        result.confidence
      )}%)\n- 理由: ${result.explanation}${evidence}${source}`;
    })
    .join('\n\n');

  return [
    '以下の記事を、指摘された事実誤認のみ修正してください。',
    '文体・構成・見出し・段落順はできるだけ維持してください。',
    '不確かな表現は断定を避ける書き方に修正してください。',
    '回答は修正後の記事本文のみを返してください。',
    '',
    `【関連キーワード】${keyword}`,
    '',
    '【修正対象】',
    issuesText,
    '',
    '【元記事】',
    originalContent,
  ].join('\n');
};

export const cleanFactCheckModelText = (content: string): string =>
  content.trim().replace(/^```[a-zA-Z]*\s*/, '').replace(/\s*```$/, '');

export const applyFallbackFactCheckFixes = (originalContent: string, issues: FactCheckResult[]): string => {
  let next = originalContent;
  const correctionLines: string[] = [];

  issues.forEach((issue) => {
    if (!issue.correctInfo || issue.correctInfo.trim().length === 0) return;
    const claim = issue.claim.trim();
    const correct = issue.correctInfo.trim();
    if (!claim || !correct) return;

    if (next.includes(claim)) {
      next = next.replace(claim, `${claim}（修正: ${correct}）`);
    }

    correctionLines.push(`- ${claim} => ${correct}`);
  });

  if (correctionLines.length === 0) return next;

  const report = ['【AI修正サマリー】', ...correctionLines, '', ''].join('\n');
  if (!next.startsWith('【AI修正サマリー】')) {
    next = report + next;
  }

  return next;
};
