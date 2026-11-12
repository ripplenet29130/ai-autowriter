// 文字数おまかせ（記事改善プラン 段階 1 の 1-0・1-1・1-6・1-7）
// - 書く前に、AI がキーワードに合った文字数と理由を決める
// - 見出しの数は「1 見出しあたり 250 字以上」に収まるように上限を決める
// - 書き終えた記事が目安の 1.5 倍を超えたときだけ、AI に内容を保ったまま短く言い直させる
//   （プログラムが文や見出しを機械的に削ることはしない）
import { countGeneratedChars } from './articleGenerationCore.ts';
import {
  LOOSE_LENGTH_MAX_RATIO,
  MIN_CHARS_PER_HEADING,
  maxHeadingsForLength,
} from './generationPolicy.ts';

export { MIN_CHARS_PER_HEADING, maxHeadingsForLength };

export type LengthMode = 'auto' | 'fixed';

export const AUTO_LENGTH_MIN_CHARS = 1500;
export const AUTO_LENGTH_MAX_CHARS = 6000;
export const AUTO_LENGTH_FALLBACK_CHARS = 2500;
// 目安の何倍を超えたら短縮するか
export const LENGTH_OVERFLOW_RATIO = LOOSE_LENGTH_MAX_RATIO;
// 短縮した結果がこれより短ければ削りすぎとみなす（目安に対する割合）
export const LENGTH_UNDERFLOW_RATIO = 0.6;

export interface ArticleLengthPlan {
  mode: LengthMode;
  targetChars: number;
  reason: string;
  // 導入を除く見出し（H2・H3・まとめ）の上限
  maxHeadings: number;
  // AI が決めたか、決められずに既定値を使ったか
  source: 'ai' | 'fallback' | 'fixed';
}

export function normalizeLengthMode(value: unknown, fallback: LengthMode = 'fixed'): LengthMode {
  if (value === 'auto' || value === 'fixed') return value;
  return fallback;
}

export function clampAutoLength(chars: number, maxChars = AUTO_LENGTH_MAX_CHARS): number {
  const upper = Math.max(AUTO_LENGTH_MIN_CHARS, maxChars);
  const rounded = Math.round(chars / 100) * 100;
  return Math.min(upper, Math.max(AUTO_LENGTH_MIN_CHARS, rounded));
}

export function fixedLengthPlan(targetChars: number): ArticleLengthPlan {
  return {
    mode: 'fixed',
    targetChars,
    reason: '文字数指定',
    maxHeadings: maxHeadingsForLength(targetChars),
    source: 'fixed',
  };
}

export interface LengthPlanInput {
  keyword: string;
  title?: string | null;
  competitorTitles?: string[];
  competitorHeadings?: string[];
  relatedKeywords?: string[];
  // 根拠メモなど、調査で見つかった話題の要約（任意）
  researchNotes?: string[];
  maxChars?: number;
}

export function buildLengthPlanPrompt(input: LengthPlanInput): string {
  const maxChars = Math.max(AUTO_LENGTH_MIN_CHARS, input.maxChars || AUTO_LENGTH_MAX_CHARS);
  const list = (label: string, items: string[] | undefined, limit: number) => {
    const rows = (items || []).map((item) => String(item || '').trim()).filter(Boolean).slice(0, limit);
    return rows.length > 0 ? `【${label}】\n- ${rows.join('\n- ')}` : '';
  };

  return [
    'あなたは日本語 SEO 記事の編集長です。これから書く記事の適切な文字数を決めてください。',
    '',
    `メインキーワード: ${input.keyword}`,
    input.title ? `記事タイトル: ${input.title}` : '',
    '',
    list('上位記事のタイトル', input.competitorTitles, 8),
    list('上位記事の見出し', input.competitorHeadings, 20),
    list('関連キーワード', input.relatedKeywords, 10),
    list('調査で見つかった事実', input.researchNotes, 12),
    '',
    '決め方:',
    '- このキーワードで検索した人が知りたいこと（検索意図）に、過不足なく答えられる分量にする',
    '- 検索意図から外れる話題は書かない前提で考える。網羅のために長くしない',
    '- 答えが短く済むテーマは短く、手順・比較・条件分岐が多いテーマは長くする',
    `- 1 見出しあたり ${MIN_CHARS_PER_HEADING} 字以上になるように、見出しの数も合わせて考える`,
    `- 文字数は ${AUTO_LENGTH_MIN_CHARS}〜${maxChars} 字の範囲で、100 字単位にする`,
    '',
    '出力は次の JSON だけにしてください（説明やコードフェンスは不要）:',
    '{"targetChars": 3000, "headings": 10, "reason": "決めた理由を60字以内で"}',
  ].filter((line) => line !== '').join('\n');
}

export function parseLengthPlanResponse(
  text: string,
  maxChars = AUTO_LENGTH_MAX_CHARS
): { targetChars: number; reason: string } | null {
  const raw = String(text || '').replace(/```(?:json)?/gi, '').trim();
  const jsonMatch = raw.match(/\{[\s\S]*\}/);
  if (jsonMatch) {
    try {
      const parsed = JSON.parse(jsonMatch[0]);
      const chars = Number(parsed?.targetChars ?? parsed?.target_chars ?? parsed?.chars);
      if (Number.isFinite(chars) && chars > 0) {
        return {
          targetChars: clampAutoLength(chars, maxChars),
          reason: String(parsed?.reason || '').trim().slice(0, 120),
        };
      }
    } catch {
      // 下の数字の読み取りに進む
    }
  }
  const numberMatch = raw.match(/(\d[\d,]{2,5})\s*(?:字|文字|chars?)/);
  if (numberMatch) {
    const chars = Number(numberMatch[1].replace(/,/g, ''));
    if (Number.isFinite(chars) && chars > 0) {
      return { targetChars: clampAutoLength(chars, maxChars), reason: '' };
    }
  }
  return null;
}

export async function planArticleLength(
  input: LengthPlanInput & { callAI: (prompt: string, maxTokens: number) => Promise<string> }
): Promise<ArticleLengthPlan> {
  const maxChars = Math.max(AUTO_LENGTH_MIN_CHARS, input.maxChars || AUTO_LENGTH_MAX_CHARS);
  const fallback = (reason: string): ArticleLengthPlan => {
    const targetChars = clampAutoLength(AUTO_LENGTH_FALLBACK_CHARS, maxChars);
    return { mode: 'auto', targetChars, reason, maxHeadings: maxHeadingsForLength(targetChars), source: 'fallback' };
  };

  try {
    // 上位モデル（Pro）では思考の分も出力の上限に数えられるため、余裕を持たせる
    const text = await input.callAI(buildLengthPlanPrompt({ ...input, maxChars }), 4096);
    const parsed = parseLengthPlanResponse(text, maxChars);
    if (!parsed) return fallback('AI の回答を読み取れなかったため既定値を使用');
    return {
      mode: 'auto',
      targetChars: parsed.targetChars,
      reason: parsed.reason || 'AI が検索意図から判断',
      maxHeadings: maxHeadingsForLength(parsed.targetChars),
      source: 'ai',
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error || '');
    return fallback(`文字数を決められなかったため既定値を使用（${message.slice(0, 60)}）`);
  }
}

export function formatLengthPlanLabel(plan: ArticleLengthPlan | null | undefined): string {
  if (!plan) return '';
  if (plan.mode === 'fixed') return `文字数指定 ${plan.targetChars}字`;
  return `おまかせ ${plan.targetChars}字（${plan.reason}）`;
}

// 構成案の作成に渡す、見出し数と検索意図の指示（1-7・1-8）
export function buildOutlineLengthInstructions(plan: ArticleLengthPlan): string {
  return [
    '【分量と見出しの数】',
    `- 記事全体の目安は約${plan.targetChars}字`,
    `- 導入を除く見出し（H2・H3・まとめを合わせて）は最大${plan.maxHeadings}個。1見出しあたり${MIN_CHARS_PER_HEADING}字以上書ける数にする`,
    '- 見出しを増やして網羅するより、少ない見出しで1つずつ深く答える',
    '- 各見出しは「検索した人の疑問に直接答えるか」で選ぶ。調査で見つけた話題でも、検索意図から外れるもの（周辺の手続き・窓口の受付時間などの細部）は見出しにしない',
    '- 一方で、検索した人が一緒に知りたいこと（自分が対象かどうかの判定基準、同じ場面で関係する別の期限・条件、具体的な時系列）は検索意図に含まれる。見出しか本文で必ず扱う',
    '- H3（小見出し）は、そのH2の中に読者が分けて知りたい論点が本当に複数あるときだけ使う。数合わせで作らない',
  ].join('\n');
}

export function isOverLengthLimit(chars: number, targetChars: number): boolean {
  return targetChars > 0 && chars > targetChars * LENGTH_OVERFLOW_RATIO;
}

const headingLines = (content: string): string[] =>
  String(content || '')
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => /^#{2,3}\s+/.test(line));

export function buildCondensePrompt(params: {
  title: string;
  keyword: string;
  content: string;
  targetChars: number;
}): string {
  const currentChars = countGeneratedChars(params.content);
  return [
    'あなたは経験豊富な編集者です。次の日本語記事が長すぎるので、内容を保ったまま短く書き直してください。',
    '',
    `記事タイトル: ${params.title}`,
    `メインキーワード: ${params.keyword}`,
    `今の文字数: 約${currentChars}字 → 目安: 約${params.targetChars}字（上限 ${Math.round(params.targetChars * 1.2)}字）`,
    '',
    '短くする方法:',
    '- 同じことの言い換え、前置き、一般論、繰り返しのまとめを削る',
    '- 検索した人の疑問に直接答えない細部を削る',
    '- 具体例・数字・手順・判断基準・注意点は残す。削るのは説明の重複のほう',
    '- 文を途中で切らない。段落ごと消すときは、前後のつながりを直す',
    '',
    '守る点:',
    '- 見出し（## と ###）の数・順番・文言を変えない。すべての見出しの下に本文を残す',
    '- 新しい事実・数字・固有名詞を足さない',
    '- Markdown の形式を保つ。段落の間は空行を1行入れる',
    '- 書き直した記事本文だけを返す。説明やコードフェンスは付けない',
    '',
    '【記事】',
    params.content,
  ].join('\n');
}

export interface CondenseResult {
  content: string;
  applied: boolean;
  reason: string;
}

// 上限を超えたときだけ AI に短く言い直させる。うまくいかなければ元の記事をそのまま返す（削らない）
export async function condenseArticleIfTooLong(params: {
  title: string;
  keyword: string;
  content: string;
  targetChars: number;
  callAI: (prompt: string, maxTokens: number) => Promise<string>;
}): Promise<CondenseResult> {
  const beforeChars = countGeneratedChars(params.content);
  if (!isOverLengthLimit(beforeChars, params.targetChars)) {
    return { content: params.content, applied: false, reason: '上限内' };
  }

  const maxTokens = Math.min(24000, Math.max(4000, Math.ceil(params.targetChars * 1.2 * 2.5) + 2000));
  let text: string;
  try {
    text = await params.callAI(buildCondensePrompt(params), maxTokens);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error || '');
    return { content: params.content, applied: false, reason: `短縮に失敗したため元のまま（${message.slice(0, 60)}）` };
  }

  const cleaned = String(text || '')
    .trim()
    .replace(/^```(?:markdown|md)?\s*/i, '')
    .replace(/\s*```$/, '')
    .trim();
  const afterChars = countGeneratedChars(cleaned);
  if (!cleaned) {
    return { content: params.content, applied: false, reason: '短縮結果が空だったため元のまま' };
  }
  if (headingLines(cleaned).length !== headingLines(params.content).length) {
    return { content: params.content, applied: false, reason: '短縮で見出しの数が変わったため元のまま' };
  }
  if (afterChars >= beforeChars || afterChars < params.targetChars * LENGTH_UNDERFLOW_RATIO) {
    return { content: params.content, applied: false, reason: `短縮後の文字数が不適切なため元のまま（${beforeChars}→${afterChars}字）` };
  }
  return { content: cleaned, applied: true, reason: `${beforeChars}→${afterChars}字に短縮` };
}
