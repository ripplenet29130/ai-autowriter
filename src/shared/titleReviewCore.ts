// 完成した本文に合わせてタイトルを見直す
// タイトルは本文を書く前に作るため、本文の中身とずれることがある
// （例: 「カレンダー」と書いたのに本文に一覧がない、不自然な日本語、宣伝文句）。
// 本文を読んで問題があるときだけ作り直し、問題がなければ元のタイトルを使う。
// タイトルセットなどで人が指定したタイトルには使わない。
import { extractJsonValue } from './geminiCore.ts';
import { TITLE_HYPE_PATTERN, TITLE_QUALITY_RULES } from './titleGenerationCore.ts';

export const TITLE_TARGET_MAX_CHARS = 40;
const TITLE_MIN_CHARS = 12;
const TITLE_HARD_MAX_CHARS = 48;

// 本文に一覧・表がないのに、タイトルで約束している形式
const PROMISED_FORMAT_PATTERN = /カレンダー|早見表|一覧|チェックリスト|テンプレート|ランキング|比較表/;

export interface TitleReviewResult {
  title: string;
  changed: boolean;
  reason: string;
  issues: string[];
}

function hasTableOrList(content: string): boolean {
  return /^\|.*\|$/m.test(content) || /^([-*+]|\d+[.)])\s+/m.test(content);
}

function includesKeyword(title: string, keyword: string): boolean {
  const compactTitle = title.replace(/\s+/g, '');
  const compactKeyword = keyword.replace(/\s+/g, '');
  if (compactKeyword && compactTitle.includes(compactKeyword)) return true;
  return keyword.split(/\s+/).map((t) => t.trim()).filter((t) => t.length >= 2).some((t) => compactTitle.includes(t));
}

// プログラムで分かる問題（AI に見直しを頼むときの手がかりにする）
export function findTitleIssues(title: string, content: string): string[] {
  const issues: string[] = [];
  const promised = title.match(PROMISED_FORMAT_PATTERN);
  if (promised && !hasTableOrList(content)) {
    issues.push(`タイトルに「${promised[0]}」とあるが、本文に表や一覧がない`);
  }
  if (TITLE_HYPE_PATTERN.test(title)) issues.push('「網羅」「徹底解説」などの宣伝文句を使っている');
  if (title.length > TITLE_TARGET_MAX_CHARS) issues.push(`長すぎる（${title.length}字。${TITLE_TARGET_MAX_CHARS}字以内にする）`);
  return issues;
}

export function buildTitleReviewPrompt(params: { title: string; keyword: string; content: string; issues: string[] }): string {
  return [
    'あなたは日本語 SEO 記事の編集者です。完成した記事の本文を読み、今のタイトルが本文に合っているかを確かめてください。',
    '',
    `今のタイトル: ${params.title}`,
    `メインキーワード: ${params.keyword}`,
    params.issues.length > 0 ? `見つかっている問題:\n- ${params.issues.join('\n- ')}` : '',
    '',
    '確かめる点:',
    '- 本文に書かれていない内容や形式を約束していないか（本文に表や一覧がないのに「カレンダー」「一覧」など）',
    '- 日本語として自然か（主語や目的語が抜けて意味が通らない表現がないか）',
    '- 記事を読むと何が分かるかが伝わるか',
    `- ${TITLE_TARGET_MAX_CHARS}字以内か（32字前後が目安）`,
    '- メインキーワードを自然に含んでいるか',
    '',
    '新しいタイトルを作るときのルール:',
    ...TITLE_QUALITY_RULES.map((rule) => `- ${rule}`),
    `- ${TITLE_TARGET_MAX_CHARS}字以内。メインキーワードを含める`,
    '- 本文の中身だけに基づいて作る',
    '',
    '問題がなければ ok を true にし、title は今のタイトルのままにしてください。',
    '出力は次の JSON だけにしてください（説明やコードフェンスは不要）:',
    '{"ok": false, "title": "新しいタイトル", "reason": "直した理由を40字以内で"}',
    '',
    '【本文】',
    params.content.slice(0, 12000),
  ].filter((line) => line !== '').join('\n');
}

export async function reviewTitleAgainstContent(params: {
  title: string;
  keyword: string;
  content: string;
  callAI: (prompt: string, maxTokens: number) => Promise<string>;
}): Promise<TitleReviewResult> {
  const original = String(params.title || '').trim();
  const issues = findTitleIssues(original, params.content);
  let parsed: any;
  try {
    // 上位モデル（Pro）では思考の分も出力の上限に数えられるため、余裕を持たせる
    const text = await params.callAI(buildTitleReviewPrompt({ ...params, title: original, issues }), 4096);
    parsed = extractJsonValue(text);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error || '');
    return { title: original, changed: false, reason: `見直しに失敗したため元のまま（${message.slice(0, 60)}）`, issues };
  }

  const candidate = String(parsed?.title || '').replace(/^["'「『]|["'」』]$/g, '').replace(/\s+/g, ' ').trim();
  const reason = String(parsed?.reason || '').trim().slice(0, 80);
  if (parsed?.ok === true && issues.length === 0) {
    return { title: original, changed: false, reason: '問題なし', issues };
  }
  if (!candidate || candidate === original) {
    return { title: original, changed: false, reason: issues.length > 0 ? '作り直せなかったため元のまま' : '問題なし', issues };
  }
  // 新しいタイトルも確かめる。条件を満たさなければ元のタイトルを使う
  if (candidate.length < TITLE_MIN_CHARS || candidate.length > TITLE_HARD_MAX_CHARS) {
    return { title: original, changed: false, reason: `作り直したタイトルの長さが不適切なため元のまま（${candidate.length}字）`, issues };
  }
  if (!includesKeyword(candidate, params.keyword)) {
    return { title: original, changed: false, reason: '作り直したタイトルにキーワードがないため元のまま', issues };
  }
  // 作り直したタイトルの問題が元より減っていなければ、元のタイトルを使う
  const candidateIssues = findTitleIssues(candidate, params.content);
  if (candidateIssues.length > 0 && candidateIssues.length >= issues.length) {
    return { title: original, changed: false, reason: `作り直したタイトルにも問題があるため元のまま（${candidateIssues[0]}）`, issues };
  }
  return { title: candidate, changed: true, reason: reason || '本文に合わせて作り直した', issues };
}
