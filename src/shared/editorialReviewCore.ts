// 編集見直し（書き終えた記事を上位モデルで読み直し、重複・根拠のない断定・つながりを整える）
import { countGeneratedChars } from './articleGenerationCore.ts';
import { buildArticleFactInstructions, type FactSheet } from './factSheetCore.ts';
import type { GeminiCaller } from './geminiCore.ts';
import { DEFAULT_REVIEW_THINKING_BUDGET } from './generationPolicy.ts';

export const EDITORIAL_REVIEW_LENGTH_TOLERANCE = 0.15;

export function buildEditorialReviewPrompt(params: {
  title: string;
  keyword: string;
  content: string;
  factSheet?: FactSheet | null;
  toneInstruction?: string;
  customInstructions?: string;
}): string {
  const chars = countGeneratedChars(params.content);
  const minChars = Math.round(chars * (1 - EDITORIAL_REVIEW_LENGTH_TOLERANCE + 0.03));
  const maxChars = Math.round(chars * (1 + EDITORIAL_REVIEW_LENGTH_TOLERANCE - 0.03));
  const factInstructions = buildArticleFactInstructions(params.factSheet);

  return [
    'あなたは経験豊富な編集者です。次の日本語記事を読み直し、品質を上げた修正版の全文を返してください。',
    '',
    `記事タイトル: ${params.title}`,
    `メインキーワード: ${params.keyword}`,
    params.toneInstruction ? `文体: ${params.toneInstruction}` : '',
    '',
    '直す点:',
    '- 同じ内容の繰り返しを減らす',
    '- 根拠メモにない数字・料金・制度の断定を、断定しない書き方に直すか削る',
    '- 見出しと本文の内容のずれを直す',
    '- セクション間のつながりを自然にする（前のセクションと同じ説明から始めない）',
    '- 読者の疑問に答える。各セクションは結論を先に書く',
    '- 冗長な言い回し、硬すぎる表現を読みやすくする',
    '- 「（2026年4月時点）」のような時点の注記が本文に何度も出てくる場合は、記事の冒頭か末尾の1回だけにまとめる',
    '',
    '守る点:',
    '- 見出し（## と ###）の数・順番・文言を変えない',
    `- 本文の文字数を ${minChars}〜${maxChars} 字に保つ（元は約 ${chars} 字）`,
    '- 新しい事実・数字・固有名詞を足さない',
    '- Markdown の形式を保つ。段落の間は空行を1行入れる',
    '- 修正版の記事本文だけを返す。説明やコードフェンスは付けない',
    params.customInstructions ? `\n追加の指示:\n${params.customInstructions}` : '',
    factInstructions ? `\n${factInstructions}` : '',
    '',
    '【記事】',
    params.content,
  ].filter((line) => line !== '').join('\n');
}

const headingLines = (content: string): string[] =>
  String(content || '')
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => /^#{2,3}\s+/.test(line))
    .map((line) => line.replace(/\s+/g, ' '));

const hasEmptyHeading = (content: string): boolean => {
  const lines = String(content || '').split('\n').map((line) => line.trim()).filter(Boolean);
  for (let i = 0; i < lines.length; i++) {
    if (!/^#{2,3}\s+/.test(lines[i])) continue;
    const next = lines[i + 1];
    const level = (lines[i].match(/^#+/) || [''])[0].length;
    const nextLevel = next && /^#{2,6}\s+/.test(next) ? (next.match(/^#+/) || [''])[0].length : 0;
    // 次の行が無い、または同じ／上位レベルの見出しなら本文が空
    if (!next || (nextLevel > 0 && nextLevel <= level)) return true;
  }
  return false;
};

export function cleanReviewedText(text: string): string {
  return String(text || '')
    .trim()
    .replace(/^```(?:markdown|md)?\s*/i, '')
    .replace(/\s*```$/, '')
    .trim();
}

export interface EditorialReviewDecision {
  accepted: boolean;
  reason: string;
  content: string;
}

export function evaluateEditorialReview(before: string, after: string): EditorialReviewDecision {
  const cleaned = cleanReviewedText(after);
  if (!cleaned) return { accepted: false, reason: '見直し結果が空でした', content: before };

  const beforeHeadings = headingLines(before);
  const afterHeadings = headingLines(cleaned);
  if (beforeHeadings.length !== afterHeadings.length) {
    return {
      accepted: false,
      reason: `見出しの数が変わったため不採用（${beforeHeadings.length}→${afterHeadings.length}）`,
      content: before,
    };
  }

  const beforeChars = countGeneratedChars(before);
  const afterChars = countGeneratedChars(cleaned);
  if (beforeChars > 0) {
    const ratio = afterChars / beforeChars;
    if (Math.abs(ratio - 1) > EDITORIAL_REVIEW_LENGTH_TOLERANCE) {
      return {
        accepted: false,
        reason: `文字数が大きく変わったため不採用（${beforeChars}→${afterChars}字）`,
        content: before,
      };
    }
  }

  if (hasEmptyHeading(cleaned)) {
    return { accepted: false, reason: '本文のない見出しができたため不採用', content: before };
  }

  return { accepted: true, reason: '採用', content: cleaned };
}

export async function runEditorialReview(params: {
  title: string;
  keyword: string;
  content: string;
  factSheet?: FactSheet | null;
  toneInstruction?: string;
  customInstructions?: string;
  call: GeminiCaller;
  // 思考の上限（省略時は DEFAULT_REVIEW_THINKING_BUDGET）
  thinkingBudget?: number;
}): Promise<EditorialReviewDecision> {
  const prompt = buildEditorialReviewPrompt(params);
  const thinkingBudget = params.thinkingBudget ?? DEFAULT_REVIEW_THINKING_BUDGET;
  // 3.1 Pro は思考の上限を超えて考えることがあり、思考分も出力上限に数えられるため、
  // その分の余裕を足す（足りないと本文が途中で切れる）
  const THINKING_HEADROOM_TOKENS = Math.max(12000, thinkingBudget + 6000);
  const maxOutputTokens = Math.min(
    40000,
    Math.max(4096, Math.ceil(countGeneratedChars(params.content) * 2.5) + 2048) + THINKING_HEADROOM_TOKENS,
  );
  const response = await params.call(prompt, {
    role: 'writer',
    maxOutputTokens,
    temperature: 0.4,
    thinkingBudget,
  });
  if (response.finishReason === 'MAX_TOKENS') {
    return { accepted: false, reason: '見直し結果が途中で切れたため不採用', content: params.content };
  }
  return evaluateEditorialReview(params.content, response.text);
}
