// 編集見直し（書き終えた記事を上位モデルで読み直して直す）
// 記事改善プラン 段階 2:
// - 2-1 見直しを 2 段階にする。①批評: 読者の立場で弱い点を具体的に挙げる ②書き直し: 批評をもとに全文を直す
// - 2-2 採用条件をゆるめる。見出しの文言の変更と、文字数の 30% までの変化を認める
// - 2-3 批評の結果を品質レポートと通知に出す（呼び出し側で EditorialReviewDecision.critique を使う）
import { countGeneratedChars } from './articleGenerationCore.ts';
import { buildArticleFactInstructions, type FactSheet } from './factSheetCore.ts';
import { extractJsonValue, type GeminiCaller } from './geminiCore.ts';
import { DEFAULT_REVIEW_THINKING_BUDGET } from './generationPolicy.ts';

export const EDITORIAL_REVIEW_LENGTH_TOLERANCE = 0.3;

// 批評で挙げる弱点の種類
export const CRITIQUE_ISSUE_TYPES = {
  thin: '説明が薄い',
  duplicate: '重複',
  unsupported: '根拠のない断定',
  unanswered: '答えていない疑問',
  off_topic: '検索意図から外れる',
  flow: 'つながりが悪い',
  readability: '読みにくい',
} as const;
export type CritiqueIssueType = keyof typeof CRITIQUE_ISSUE_TYPES;

export interface CritiqueIssue {
  type: CritiqueIssueType;
  // どの見出しの部分か（記事全体なら「全体」）
  section: string;
  problem: string;
  fix: string;
}

export interface EditorialCritique {
  summary: string;
  issues: CritiqueIssue[];
}

export interface EditorialReviewDecision {
  accepted: boolean;
  reason: string;
  content: string;
  // 批評の結果（批評を行わなかった・失敗したときは null）
  critique?: EditorialCritique | null;
}

interface ReviewParams {
  title: string;
  keyword: string;
  content: string;
  factSheet?: FactSheet | null;
  toneInstruction?: string;
  customInstructions?: string;
}

// ① 批評: 読者の立場で、弱い点を具体的に挙げる（直した本文は出さない）
export function buildEditorialCritiquePrompt(params: ReviewParams): string {
  const factInstructions = buildArticleFactInstructions(params.factSheet);
  const types = Object.entries(CRITIQUE_ISSUE_TYPES).map(([key, label]) => `${key}（${label}）`).join('、');
  return [
    `あなたは厳しい編集者です。「${params.keyword}」で検索してこの記事にたどり着いた読者の立場で、次の日本語記事を読み、弱い点を具体的に挙げてください。記事を直す必要はありません。`,
    '',
    `記事タイトル: ${params.title}`,
    `メインキーワード: ${params.keyword}`,
    '',
    '見る点:',
    '- 説明が薄い箇所（読者が「で、具体的には？」と思う箇所。例・数字・手順・判断基準が足りない）',
    '- 同じ説明の繰り返し（別の見出しで同じことを言っている、まとめ以外で結論を何度も繰り返している）',
    '- 根拠のない断定（根拠メモにない数字・料金・期限・制度を言い切っている、条件や例外を省いている）',
    '- 答えていない疑問（このキーワードで検索した人が当然知りたいのに、記事が答えていないこと）',
    '- 検索意図から外れる細部（読者の疑問に関係の薄い周辺の話題）',
    '- つながりの悪さ、読みにくい文',
    '',
    '出し方:',
    '- 重要なものから順に、最大 10 件まで。細かい言い回しの好みは挙げない',
    '- 1 件ごとに、どの見出しの部分か、何が問題か、どう直せばよいかを具体的に書く',
    `- type は次のどれか: ${types}`,
    '- 出力は次の JSON だけにしてください（説明やコードフェンスは不要）:',
    '{"summary":"記事全体の評価を2文で","issues":[{"type":"thin","section":"見出しの文言（全体なら「全体」）","problem":"何が問題か","fix":"どう直すか"}]}',
    factInstructions ? `\n${factInstructions}` : '',
    '',
    '【記事】',
    params.content,
  ].filter((line) => line !== '').join('\n');
}

export function parseEditorialCritique(text: string): EditorialCritique | null {
  let parsed: any;
  try {
    parsed = extractJsonValue(String(text || ''));
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== 'object') return null;
  const rawIssues = Array.isArray(parsed.issues) ? parsed.issues : [];
  const issues: CritiqueIssue[] = rawIssues
    .map((item: any) => {
      const type = String(item?.type || '').trim() as CritiqueIssueType;
      return {
        type: (type in CRITIQUE_ISSUE_TYPES ? type : 'readability') as CritiqueIssueType,
        section: String(item?.section || '全体').trim().slice(0, 80),
        problem: String(item?.problem || '').trim().slice(0, 300),
        fix: String(item?.fix || '').trim().slice(0, 300),
      };
    })
    .filter((issue: CritiqueIssue) => issue.problem)
    .slice(0, 10);
  const summary = String(parsed.summary || '').trim().slice(0, 300);
  if (!summary && issues.length === 0) return null;
  return { summary, issues };
}

// 通知や画面に出す短い要約（例: 「指摘6件（説明が薄い3・重複2・根拠のない断定1）」）
export function summarizeCritique(critique: EditorialCritique | null | undefined): string {
  if (!critique) return '';
  if (critique.issues.length === 0) return '指摘なし';
  const counts = new Map<string, number>();
  for (const issue of critique.issues) {
    const label = CRITIQUE_ISSUE_TYPES[issue.type];
    counts.set(label, (counts.get(label) || 0) + 1);
  }
  const parts = [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([label, n]) => `${label}${n}`);
  return `指摘${critique.issues.length}件（${parts.join('・')}）`;
}

function formatCritiqueForRewrite(critique: EditorialCritique): string {
  return critique.issues
    .map((issue, index) =>
      `${index + 1}. [${CRITIQUE_ISSUE_TYPES[issue.type]}] ${issue.section}: ${issue.problem}${issue.fix ? ` → 直し方: ${issue.fix}` : ''}`)
    .join('\n');
}

// ② 書き直し（批評がないときは、これまでどおりの一般的な見直しになる）
export function buildEditorialReviewPrompt(params: ReviewParams & { critique?: EditorialCritique | null }): string {
  const chars = countGeneratedChars(params.content);
  // 判定の幅（±30%）より少し内側を指示する
  const minChars = Math.round(chars * (1 - EDITORIAL_REVIEW_LENGTH_TOLERANCE + 0.05));
  const maxChars = Math.round(chars * (1 + EDITORIAL_REVIEW_LENGTH_TOLERANCE - 0.05));
  const factInstructions = buildArticleFactInstructions(params.factSheet);
  const critiqueText = params.critique && params.critique.issues.length > 0
    ? formatCritiqueForRewrite(params.critique)
    : '';

  return [
    'あなたは経験豊富な編集者です。次の日本語記事を読み直し、品質を上げた修正版の全文を返してください。',
    '',
    `記事タイトル: ${params.title}`,
    `メインキーワード: ${params.keyword}`,
    params.toneInstruction ? `文体: ${params.toneInstruction}` : '',
    '',
    critiqueText
      ? `編集者の指摘（すべて反映すること。重要なものから順に並んでいる）:\n${critiqueText}\n`
      : '',
    critiqueText ? 'あわせて直す点:' : '直す点:',
    '- 同じ内容の繰り返しを減らす',
    '- 根拠メモにない数字・料金・制度の断定を、断定しない書き方に直すか削る',
    '- 見出しと本文の内容のずれを直す',
    '- セクション間のつながりを自然にする（前のセクションと同じ説明から始めない）',
    '- 読者の疑問に答える。各セクションは結論を先に書く',
    '- 冗長な言い回し、硬すぎる表現を読みやすくする',
    '- 「（2026年4月時点）」のような時点の注記が本文に何度も出てくる場合は、記事の冒頭か末尾の1回だけにまとめる',
    '',
    '守る点:',
    '- 見出し（## と ###）の数・順番・階層は変えない。見出しの文言は、内容に合わせてより分かりやすくするために変えてよい',
    `- 本文の文字数は ${minChars}〜${maxChars} 字の範囲にする（元は約 ${chars} 字）。薄い箇所を補う分だけ増やし、重複を削った分だけ減らしてよい`,
    '- 根拠メモにない新しい数字・料金・固有名詞は足さない（具体例や手順の補足はよい）',
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

const headingLevels = (content: string): string =>
  headingLines(content).map((line) => (line.startsWith('###') ? '3' : '2')).join('');

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

// 採用条件（2-2）: 見出しの数と階層の並びが同じ、文字数の変化が ±30% 以内、本文のない見出しがない。
// 見出しの文言の変更は認める
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
  if (headingLevels(before) !== headingLevels(cleaned)) {
    return { accepted: false, reason: '見出しの階層（H2/H3）が変わったため不採用', content: before };
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

  const renamed = beforeHeadings.filter((heading, index) => heading !== afterHeadings[index]).length;
  return {
    accepted: true,
    reason: renamed > 0 ? `採用（見出し${renamed}個の文言を変更）` : '採用',
    content: cleaned,
  };
}

// 批評だけを行う（失敗したら null）
export async function runEditorialCritique(params: ReviewParams & {
  call: GeminiCaller;
  thinkingBudget?: number;
}): Promise<EditorialCritique | null> {
  const thinkingBudget = params.thinkingBudget ?? DEFAULT_REVIEW_THINKING_BUDGET;
  const response = await params.call(buildEditorialCritiquePrompt(params), {
    role: 'writer',
    maxOutputTokens: 4096 + Math.max(12000, thinkingBudget + 6000),
    temperature: 0.3,
    thinkingBudget,
    jsonOutput: true,
  });
  if (response.finishReason === 'MAX_TOKENS') return null;
  return parseEditorialCritique(response.text);
}

export async function runEditorialReview(params: ReviewParams & {
  call: GeminiCaller;
  // 思考の上限（省略時は DEFAULT_REVIEW_THINKING_BUDGET）
  thinkingBudget?: number;
  // false なら批評を省き、1 回の見直しだけにする（時間が足りないとき）。省略時は批評する
  critique?: boolean;
  // 批評が終わったとき（書き直しの前）に呼ぶ。進み具合の表示用
  onCritique?: (critique: EditorialCritique | null) => void | Promise<void>;
}): Promise<EditorialReviewDecision> {
  const thinkingBudget = params.thinkingBudget ?? DEFAULT_REVIEW_THINKING_BUDGET;

  let critique: EditorialCritique | null = null;
  if (params.critique !== false) {
    try {
      critique = await runEditorialCritique({ ...params, thinkingBudget });
    } catch (error) {
      // 批評に失敗しても、一般的な見直しは続ける
      console.warn('Editorial critique failed; continuing with a general review:', error);
    }
    await params.onCritique?.(critique);
  }

  const prompt = buildEditorialReviewPrompt({ ...params, critique });
  // 3.1 Pro は思考の上限を超えて考えることがあり、思考分も出力上限に数えられるため、
  // その分の余裕を足す（足りないと本文が途中で切れる）
  const THINKING_HEADROOM_TOKENS = Math.max(12000, thinkingBudget + 6000);
  const maxOutputTokens = Math.min(
    40000,
    Math.max(4096, Math.ceil(countGeneratedChars(params.content) * (1 + EDITORIAL_REVIEW_LENGTH_TOLERANCE) * 2.5) + 2048)
      + THINKING_HEADROOM_TOKENS,
  );
  const response = await params.call(prompt, {
    role: 'writer',
    maxOutputTokens,
    temperature: 0.4,
    thinkingBudget,
  });
  if (response.finishReason === 'MAX_TOKENS') {
    return { accepted: false, reason: '見直し結果が途中で切れたため不採用', content: params.content, critique };
  }
  return { ...evaluateEditorialReview(params.content, response.text), critique };
}
