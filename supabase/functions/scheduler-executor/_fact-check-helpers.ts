import {
  buildFactCheckCorrectionPrompt,
  buildFactCheckPrompt,
  buildFactCheckResponseFormat,
  cleanFactCheckModelText,
  DEFAULT_FACT_CHECK_MODEL_NAME,
  extractFactsFromContent,
  FACT_CHECK_REQUEST_TIMEOUT_MS,
  FactCheckHttpError,
  FactCheckItem,
  FactCheckResult,
  getFixableFactCheckIssues,
  parseFactCheckBatchResults,
  runWithFactCheckRetries,
} from '../../../src/shared/factCheckCore.ts';
import { fetchWithTimeout } from './_shared.ts';

export type { FactCheckItem, FactCheckResult };
export { extractFactsFromContent };

type PerplexityMessage = { role: string; content: string };

async function callPerplexityChat(
  apiKey: string,
  modelName: string,
  messages: PerplexityMessage[],
  temperature: number,
  useStructuredOutput: boolean,
): Promise<string> {
  const body: Record<string, unknown> = {
    model: modelName,
    messages,
    temperature,
  };
  if (useStructuredOutput) {
    body.response_format = buildFactCheckResponseFormat();
  }

  const response = await fetchWithTimeout(
    'https://api.perplexity.ai/chat/completions',
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(body),
    },
    FACT_CHECK_REQUEST_TIMEOUT_MS,
  );

  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new FactCheckHttpError(response.status, `Perplexity API error: ${response.status} ${text.slice(0, 200)}`);
  }

  const data = await response.json();
  return data?.choices?.[0]?.message?.content ?? '';
}

// 429/5xx/タイムアウトは指数バックオフ付きでリトライ。
// structured output 未対応モデルの 400 は、構造化出力なしで一度だけ通常呼び出しに切り替える。
async function callPerplexityStable(
  apiKey: string,
  modelName: string,
  messages: PerplexityMessage[],
  temperature: number,
  useStructuredOutput: boolean,
): Promise<string> {
  try {
    return await runWithFactCheckRetries(() =>
      callPerplexityChat(apiKey, modelName, messages, temperature, useStructuredOutput)
    );
  } catch (error) {
    if (useStructuredOutput && error instanceof FactCheckHttpError && error.status === 400) {
      console.warn('Perplexity rejected response_format; retrying without structured output');
      return await runWithFactCheckRetries(() =>
        callPerplexityChat(apiKey, modelName, messages, temperature, false)
      );
    }
    throw error;
  }
}

export async function verifyFactsBatch(
  items: FactCheckItem[],
  apiKey: string,
  keyword: string,
  modelName: string = DEFAULT_FACT_CHECK_MODEL_NAME,
  batchSize: number = 5
): Promise<FactCheckResult[]> {
  const results: FactCheckResult[] = [];

  for (let i = 0; i < items.length; i += batchSize) {
    const batch = items.slice(i, i + batchSize);
    const prompt = buildFactCheckPrompt(batch, keyword);

    try {
      const content = await callPerplexityStable(
        apiKey,
        modelName,
        [
          { role: 'system', content: 'You are a precise fact-checking assistant. Return JSON only.' },
          { role: 'user', content: prompt },
        ],
        0.1,
        true,
      );
      results.push(...parseFactCheckBatchResults(batch, content));

      if (i + batchSize < items.length) {
        await new Promise((resolve) => setTimeout(resolve, 2000));
      }
    } catch (error: any) {
      console.error(`Batch verification failed for items ${i}-${i + batchSize}:`, error);
      batch.forEach((item) => {
        results.push({
          claim: item.claim,
          verdict: 'unverified',
          confidence: 0,
          explanation: `エラー: ${error?.message ?? 'unknown error'}`,
          sourceUrl: '',
        });
      });
    }
  }

  return results;
}

export async function applyFactCheckCorrections(
  originalContent: string,
  results: FactCheckResult[],
  apiKey: string,
  keyword: string,
  modelName: string = DEFAULT_FACT_CHECK_MODEL_NAME
): Promise<string | null> {
  const issues = getFixableFactCheckIssues(results);
  if (issues.length === 0) return originalContent;

  const prompt = buildFactCheckCorrectionPrompt(originalContent, results, keyword);
  if (!prompt) return originalContent;

  try {
    // 修正結果は本文テキストなので structured output は使わない
    const content = await callPerplexityStable(
      apiKey,
      modelName,
      [
        { role: 'system', content: 'You edit Japanese articles to fix factual mistakes while preserving style.' },
        { role: 'user', content: prompt },
      ],
      0.2,
      false,
    );
    return cleanFactCheckModelText(content) || null;
  } catch (error) {
    console.error('Auto-fix correction failed:', error);
    return null;
  }
}
