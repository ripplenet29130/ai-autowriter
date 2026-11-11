// ChatGPT（Web 検索付き）による事実確認。新しい流れの検証と、両方の記事の採点の両方で使う
import { extractJsonValue } from '../../../src/shared/geminiCore.ts';
import type { FactCheckItem, FactCheckResult, FactCheckVerdict } from '../../../src/shared/factCheckCore.ts';
import { formatFactLines, hasUsableFacts, type FactSheet } from '../../../src/shared/factSheetCore.ts';
import type { OpenAiCitation, OpenAiClient } from './openai.ts';

export type OverallRating = 'ok' | 'needs_review' | 'reject';

export interface VerifyOutcome {
  results: FactCheckResult[];
  overall: { rating: OverallRating; summary: string };
  citations: OpenAiCitation[];
  webSearchCalls: number;
}

const VERDICTS: FactCheckVerdict[] = ['correct', 'incorrect', 'partially_correct', 'unverified'];
const RATINGS: OverallRating[] = ['ok', 'needs_review', 'reject'];

function today(): string {
  const d = new Date();
  return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日`;
}

function buildVerifyPrompt(params: {
  content: string;
  keyword: string;
  factSheet?: FactSheet | null;
  onlyClaims?: FactCheckItem[];
}): string {
  const target = params.onlyClaims && params.onlyClaims.length > 0
    ? [
      '次の主張だけを確認してください（修正後の記事の文です）。',
      ...params.onlyClaims.map((c, i) => `${i + 1}. ${c.claim}`),
    ].join('\n')
    : [
      '記事から、読者の判断に影響する「確認が必要な主張」を最大 20 件抜き出して確認してください。',
      '対象: 数値、日付、料金・費用、制度・法令、統計、固有名詞（団体・製品・サービス）、比較や順位、断定的な事実。',
      '一般論や意見、言い回しだけの文は対象にしないでください。',
    ].join('\n');

  const hint = hasUsableFacts(params.factSheet)
    ? [
      '',
      '参考: 執筆時に集めた根拠メモです。これ自体に誤りがある可能性があるため、うのみにせず、数値・料金・法令は必ず自分で検索して確かめてください。',
      formatFactLines(params.factSheet),
    ].join('\n')
    : '';

  return [
    'あなたは日本語 Web 記事の事実確認の担当者です。Web 検索を使って確認してください。',
    `今日は ${today()} です。料金・制度・統計は最新の情報と照らし合わせてください。`,
    '出典は公的機関・公式サイト・一次情報を優先してください。',
    '',
    target,
    hint,
    '',
    '判定:',
    '- correct: 正しい',
    '- partially_correct: 一部が古い・不正確・言い過ぎ',
    '- incorrect: 誤り',
    '- unverified: 信頼できる情報で確認できない',
    '',
    '最後に、記事全体として公開してよいかを判定してください。',
    '- ok: このまま公開してよい',
    '- needs_review: 人が確認してから公開すべき',
    '- reject: 誤りが重大で公開すべきでない',
    '',
    '出力は次の JSON だけにしてください（前後に説明を書かない）。',
    '{"results":[{"claim":"記事中の文をそのまま抜き出す（30〜120文字）","verdict":"correct|partially_correct|incorrect|unverified","confidence":0から100の整数,"correctInfo":"誤り・一部誤りのときの正しい内容","sourceUrl":"確認に使った URL","explanation":"判定理由を日本語で 1〜2 文"}],"overall":{"rating":"ok|needs_review|reject","summary":"記事全体の正確さについて日本語で 2〜3 文"}}',
    '',
    `キーワード: ${params.keyword}`,
    '',
    '--- 記事ここから ---',
    params.content,
    '--- 記事ここまで ---',
  ].join('\n');
}

export async function verifyWithChatGpt(client: OpenAiClient, params: {
  content: string;
  keyword: string;
  factSheet?: FactSheet | null;
  onlyClaims?: FactCheckItem[];
}): Promise<VerifyOutcome> {
  const response = await client.respond(buildVerifyPrompt(params), { webSearch: true, maxOutputTokens: 24000, effort: 'medium' });
  const parsed = extractJsonValue(response.text) as any;
  if (!parsed || !Array.isArray(parsed.results)) {
    throw new Error(`ChatGPT の検証結果を読み取れませんでした: ${response.text.slice(0, 300)}`);
  }

  const results: FactCheckResult[] = parsed.results
    .map((r: any) => ({
      claim: String(r?.claim || '').trim(),
      verdict: VERDICTS.includes(r?.verdict) ? r.verdict : 'unverified',
      confidence: Math.max(0, Math.min(100, Math.round(Number(r?.confidence) || 0))),
      ...(r?.correctInfo ? { correctInfo: String(r.correctInfo) } : {}),
      sourceUrl: String(r?.sourceUrl || ''),
      explanation: String(r?.explanation || ''),
    }))
    .filter((r: FactCheckResult) => r.claim);

  const rating: OverallRating = RATINGS.includes(parsed?.overall?.rating) ? parsed.overall.rating : 'needs_review';
  return {
    results,
    overall: { rating, summary: String(parsed?.overall?.summary || '') },
    citations: response.citations,
    webSearchCalls: response.webSearchCalls,
  };
}
