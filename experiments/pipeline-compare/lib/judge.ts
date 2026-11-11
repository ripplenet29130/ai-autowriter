// 両方の記事を同じ基準で採点する（ChatGPT）
import { extractJsonValue } from '../../../src/shared/geminiCore.ts';
import type { OpenAiClient } from './openai.ts';

export const QUALITY_CRITERIA = [
  { key: 'intent', label: '検索意図への答え' },
  { key: 'specificity', label: '具体性・情報量' },
  { key: 'structure', label: '構成・読みやすさ' },
  { key: 'redundancy', label: '重複の少なさ' },
  { key: 'japanese', label: '日本語の自然さ' },
  { key: 'trust', label: '信頼できる書き方' },
] as const;

export interface QualityScore {
  scores: Record<string, number>;
  average: number;
  strengths: string[];
  weaknesses: string[];
}

export interface PairwiseResult {
  winner: 'current' | 'v2' | 'tie';
  reason: string;
  // 記事 1 / 2 にどちらを置いたか（順番による偏りを避けるため毎回ランダム）
  order: ['current' | 'v2', 'current' | 'v2'];
}

export async function scoreQuality(client: OpenAiClient, params: { keyword: string; title: string; content: string }): Promise<QualityScore> {
  const prompt = [
    'あなたは SEO 記事の編集長です。次の記事を読者の立場で評価してください。事実の正誤は別に確認するので、ここでは書き方と内容の質だけを見てください。',
    '各項目を 1〜5 の整数で採点してください（5 が最高）。',
    ...QUALITY_CRITERIA.map((c) => `- ${c.key}: ${c.label}`),
    '',
    '出力は次の JSON だけにしてください。',
    `{"scores":{${QUALITY_CRITERIA.map((c) => `"${c.key}":1から5`).join(',')}},"strengths":["良い点（最大3つ）"],"weaknesses":["改善点（最大3つ）"]}`,
    '',
    `キーワード: ${params.keyword}`,
    `タイトル: ${params.title}`,
    '--- 記事ここから ---',
    params.content,
    '--- 記事ここまで ---',
  ].join('\n');
  const response = await client.respond(prompt, { maxOutputTokens: 8000, effort: 'low' });
  const parsed = extractJsonValue(response.text) as any;
  const scores: Record<string, number> = {};
  for (const c of QUALITY_CRITERIA) {
    scores[c.key] = Math.max(1, Math.min(5, Math.round(Number(parsed?.scores?.[c.key]) || 0)));
  }
  const values = Object.values(scores);
  return {
    scores,
    average: Math.round((values.reduce((a, b) => a + b, 0) / values.length) * 100) / 100,
    strengths: Array.isArray(parsed?.strengths) ? parsed.strengths.map(String).slice(0, 3) : [],
    weaknesses: Array.isArray(parsed?.weaknesses) ? parsed.weaknesses.map(String).slice(0, 3) : [],
  };
}

export async function comparePair(client: OpenAiClient, params: {
  keyword: string;
  current: { title: string; content: string };
  v2: { title: string; content: string };
  // 並び順を固定したいとき（順番を入れ替えて 2 回比べる場合）に指定する
  order?: PairwiseResult['order'];
}): Promise<PairwiseResult> {
  const order: PairwiseResult['order'] = params.order
    ?? (Math.random() < 0.5 ? ['current', 'v2'] : ['v2', 'current']);
  const article = (which: 'current' | 'v2') => params[which];
  const prompt = [
    `キーワード「${params.keyword}」で検索した読者にとって、次の 2 つの記事のどちらが役に立つかを判断してください。`,
    '正確さ・具体性・検索意図への答え・読みやすさを総合して判断してください。差がほとんどなければ tie にしてください。',
    '出力は次の JSON だけにしてください。',
    '{"winner":"1|2|tie","reason":"理由を日本語で 3〜4 文"}',
    '',
    `=== 記事1: ${article(order[0]).title} ===`,
    article(order[0]).content,
    '',
    `=== 記事2: ${article(order[1]).title} ===`,
    article(order[1]).content,
  ].join('\n');
  const response = await client.respond(prompt, { maxOutputTokens: 8000, effort: 'medium' });
  const parsed = extractJsonValue(response.text) as any;
  const raw = String(parsed?.winner ?? '').trim();
  const winner = raw === '1' ? order[0] : raw === '2' ? order[1] : 'tie';
  return { winner, reason: String(parsed?.reason || ''), order };
}
