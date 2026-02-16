export type FactCheckItem = {
  claim: string;
  context: string;
  priority: 'high' | 'normal';
};

export type FactCheckResult = {
  claim: string;
  verdict: 'correct' | 'incorrect' | 'partially_correct' | 'unverified';
  confidence: number;
  correctInfo?: string;
  sourceUrl: string;
  explanation: string;
};

export async function extractFactsFromContent(
  content: string,
  userMarkedText?: string
): Promise<FactCheckItem[]> {
  const items: FactCheckItem[] = [];

  if (userMarkedText) {
    const regex = /\[\[(.+?)\]\]/g;
    let match: RegExpExecArray | null;
    while ((match = regex.exec(userMarkedText)) !== null) {
      const start = Math.max(0, match.index - 50);
      const end = Math.min(userMarkedText.length, match.index + match[0].length + 50);
      items.push({
        claim: match[1],
        context: userMarkedText.substring(start, end),
        priority: 'high',
      });
    }
  }

  const numberRegex = /(\d{1,3}(?:,\d{3})*(?:\.\d+)?(?:%|円|ドル|人|件|倍|km|kg)?)/g;
  let match: RegExpExecArray | null;
  while ((match = numberRegex.exec(content)) !== null) {
    const start = Math.max(0, match.index - 30);
    const end = Math.min(content.length, match.index + match[0].length + 30);
    items.push({
      claim: match[0],
      context: content.substring(start, end),
      priority: 'normal',
    });
  }

  const dateRegex = /(\d{4}年\d{1,2}月\d{1,2}日|\d{4}年\d{1,2}月|\d{4}年)/g;
  while ((match = dateRegex.exec(content)) !== null) {
    const start = Math.max(0, match.index - 30);
    const end = Math.min(content.length, match.index + match[0].length + 30);
    items.push({
      claim: match[0],
      context: content.substring(start, end),
      priority: 'normal',
    });
  }

  return items.sort((a, b) => (a.priority === 'high' ? -1 : b.priority === 'high' ? 1 : 0));
}

export async function verifyFactsBatch(
  items: FactCheckItem[],
  apiKey: string,
  keyword: string,
  modelName: string = 'sonar',
  batchSize: number = 5
): Promise<FactCheckResult[]> {
  const results: FactCheckResult[] = [];

  for (let i = 0; i < items.length; i += batchSize) {
    const batch = items.slice(i, i + batchSize);

    const claimsList = batch
      .map((item, idx) => `${idx + 1}. 主張: ${item.claim}\n   文脈: ${item.context}`)
      .join('\n\n');

    const prompt = [
      '次の主張を最新の公開情報で検証してください。',
      '',
      '【チェック対象】',
      claimsList,
      '',
      `【関連キーワード】${keyword}`,
      '',
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
            { role: 'system', content: 'You are a fact-checking expert. Verify claims and return JSON only.' },
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

      let batchResults: Array<{
        claim_number: number;
        verdict: FactCheckResult['verdict'];
        confidence: number;
        correct_info?: string;
        source_url?: string;
        explanation?: string;
      }> = [];

      try {
        const jsonMatch = content.match(/\[[\s\S]*\]/);
        batchResults = JSON.parse(jsonMatch ? jsonMatch[0] : content);
      } catch {
        batchResults = batch.map((_, idx) => ({
          claim_number: idx + 1,
          verdict: 'unverified',
          confidence: 0,
          explanation: 'レスポンスの解析に失敗しました',
          source_url: '',
        }));
      }

      batch.forEach((item, idx) => {
        const result = batchResults.find((r) => r.claim_number === idx + 1) ?? batchResults[idx];
        if (!result) return;
        results.push({
          claim: item.claim,
          verdict: result.verdict,
          confidence: result.confidence,
          correctInfo: result.correct_info,
          sourceUrl: result.source_url ?? '',
          explanation: result.explanation ?? '',
        });
      });

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
  modelName: string = 'sonar'
): Promise<string | null> {
  const issues = (results || []).filter(
    (result) => result.verdict === 'incorrect' || (result.verdict === 'partially_correct' && Number(result.confidence || 0) >= 40)
  );
  if (issues.length === 0) return originalContent;

  const issuesText = issues
    .slice(0, 20)
    .map((result, idx) => {
      const correction = result.correctInfo ? `\n- 修正情報: ${result.correctInfo}` : '';
      const source = result.sourceUrl ? `\n- 出典: ${result.sourceUrl}` : '';
      return `${idx + 1}. 主張: ${result.claim}\n- 判定: ${result.verdict} (${result.confidence}%)\n- 理由: ${
        result.explanation || ''
      }${correction}${source}`;
    })
    .join('\n\n');

  const prompt = [
    '以下の記事を、指摘された事実誤認のみ修正してください。',
    '文体・構成・見出し・段落順は可能な限り維持してください。',
    '不確かな記述は断定を避ける表現に修正してください。',
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
    const cleaned = content.trim().replace(/^```[a-zA-Z]*\s*/, '').replace(/\s*```$/, '');
    return cleaned || null;
  } catch (error) {
    console.error('Auto-fix correction failed:', error);
    return null;
  }
}
