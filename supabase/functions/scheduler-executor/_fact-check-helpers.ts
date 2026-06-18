import {
  buildFactCheckCorrectionPrompt,
  buildFactCheckPrompt,
  cleanFactCheckModelText,
  DEFAULT_FACT_CHECK_MODEL_NAME,
  extractFactsFromContent,
  FactCheckItem,
  FactCheckResult,
  getFixableFactCheckIssues,
  parseFactCheckBatchResults,
} from '../../../src/shared/factCheckCore.ts';

export type { FactCheckItem, FactCheckResult };
export { extractFactsFromContent };

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
      const response = await fetch('https://api.perplexity.ai/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model: modelName,
          messages: [
            { role: 'system', content: 'You are a precise fact-checking assistant. Return JSON only.' },
            { role: 'user', content: prompt },
          ],
          temperature: 0.1,
        }),
      });

      if (!response.ok) {
        throw new Error(`Perplexity API error: ${response.status}`);
      }

      const data = await response.json();
      const content: string = data?.choices?.[0]?.message?.content ?? '[]';
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
    const response = await fetch('https://api.perplexity.ai/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: modelName,
        messages: [
          { role: 'system', content: 'You edit Japanese articles to fix factual mistakes while preserving style.' },
          { role: 'user', content: prompt },
        ],
        temperature: 0.2,
      }),
    });

    if (!response.ok) throw new Error(`Perplexity API error: ${response.status}`);

    const data = await response.json();
    const content = data?.choices?.[0]?.message?.content ?? '';
    return cleanFactCheckModelText(content) || null;
  } catch (error) {
    console.error('Auto-fix correction failed:', error);
    return null;
  }
}
