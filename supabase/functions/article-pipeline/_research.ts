// 新方式の工程 1「調査」: Gemini の Google 検索＋ページ読み込みで、上位記事・検索意図・読者の疑問をまとめる
// SerpAPI・SearchApi は使わない（新方式の仕様書 2 章・4.0）
import {
  GeminiHttpError,
  geminiGenerateUrl,
  isRateLimitError,
  parseGeminiResponse,
  sleep,
} from '../../../src/shared/geminiCore.ts';
import type { GenerationRun } from '../scheduler-executor/_run.ts';

export interface AiResearch {
  searchIntent: string;
  readerQuestions: string[];
  competitors: Array<{ title: string; url: string; headings: string[] }>;
  relatedKeywords: string[];
  gaps: string[];
  searchQueries: string[];
  groundingSources: Array<{ title: string; url: string }>;
  urlContextUsed: boolean;
  searchUsed: boolean;
}

export function buildResearchPrompt(keyword: string, pages = 3): string {
  return [
    `キーワード「${keyword}」で日本の Google 検索をして、上位に表示される記事ページ（広告・動画・SNS・EC の商品ページを除く）を ${pages} 件だけ実際に読んでください（それ以上は読まない）。`,
    'そのうえで、このキーワードで記事を書くための調査結果をまとめてください。',
    '見出しは推測で作らず、読んだページにあるものだけを書いてください。',
    '',
    // 「JSON だけを返す」と指示すると Gemini が検索せずに記憶だけで答えるため、見出しと箇条書きで書かせる
    '次の形式で書いてください（JSON やコードフェンスは使わない）。',
    '## 検索意図',
    '検索する人が本当に知りたいこと（2〜3 文）',
    '## 読者の疑問',
    '- 読者が持っている具体的な疑問（5〜10 個）',
    '## 上位記事',
    '### 読んだ記事のタイトル',
    'URL: 実際に読んだページの URL',
    '- その記事の H2・H3 見出し（順番どおり、最大 12 個）',
    '## 関連キーワード',
    '- 記事に含めるべき関連キーワード（5〜10 個）',
    '## 上位記事に足りない点',
    '- 上位記事に足りない情報や、差別化できる点（3〜5 個）',
  ].join('\n');
}

// 見出しと箇条書きで書かれた調査結果を読む
export function parseResearchText(text: string): Pick<AiResearch, 'searchIntent' | 'readerQuestions' | 'competitors' | 'relatedKeywords' | 'gaps'> {
  const result = {
    searchIntent: '',
    readerQuestions: [] as string[],
    competitors: [] as AiResearch['competitors'],
    relatedKeywords: [] as string[],
    gaps: [] as string[],
  };
  let section = '';
  const intentLines: string[] = [];
  for (const rawLine of String(text || '').split('\n')) {
    const line = rawLine.trim();
    if (!line) continue;
    const h2 = line.match(/^##\s+(.+)$/);
    if (h2) {
      const name = h2[1];
      section = /検索意図/.test(name) ? 'intent'
        : /疑問/.test(name) ? 'questions'
        : /足りない|差別化/.test(name) ? 'gaps'
        : /上位記事/.test(name) ? 'competitors'
        : /関連キーワード/.test(name) ? 'keywords'
        : '';
      continue;
    }
    const h3 = line.match(/^###\s+(.+)$/);
    if (h3 && section === 'competitors') {
      result.competitors.push({ title: h3[1].replace(/\*\*/g, '').trim(), url: '', headings: [] });
      continue;
    }
    const current = result.competitors[result.competitors.length - 1];
    const url = line.match(/^[-*]?\s*URL\s*[:：]\s*(\S+)/i);
    if (url && section === 'competitors' && current) {
      current.url = url[1];
      continue;
    }
    const bullet = line.match(/^(?:[-・*•]|\d+[.)．、])\s*(.+)$/);
    const body = (bullet ? bullet[1] : line).replace(/\*\*/g, '').trim();
    if (section === 'intent') intentLines.push(body);
    else if (!bullet) continue;
    else if (section === 'questions') result.readerQuestions.push(body);
    else if (section === 'keywords') result.relatedKeywords.push(body);
    else if (section === 'gaps') result.gaps.push(body);
    else if (section === 'competitors' && current && current.headings.length < 12) current.headings.push(body);
  }
  result.searchIntent = intentLines.join('');
  return result;
}

// Gemini の Google 検索＋URL 読み込みで調査する（geminiCore の共通部品は URL 読み込みに未対応のため個別に呼ぶ）。
// 2026-11-11 のテストで 1 回 110 秒超・作り直し込みで 170 秒かかったため、
// 読むページ数を絞り、作り直しも含めて totalMs 以内に収める（1 工程は 120 秒まで）
export async function researchWithGemini(
  run: GenerationRun,
  keyword: string,
  totalMs = 100_000,
  pages = 3,
): Promise<AiResearch> {
  let useUrlContext = true;
  const deadline = Date.now() + totalMs;
  let ungrounded: { research: ReturnType<typeof parseResearchText>; parsed: ReturnType<typeof parseGeminiResponse>; data: any } | null = null;
  for (let attempt = 0; ; attempt++) {
    const remaining = deadline - Date.now();
    if (remaining < 15_000) {
      // 作り直す時間がなければ、検索なしでまとめた 1 回目の結果を使う
      if (ungrounded) return finishResearch(run, ungrounded.research, ungrounded.parsed, ungrounded.data, useUrlContext);
      throw new Error('調査の時間が足りませんでした');
    }
    const body = {
      contents: [{ role: 'user', parts: [{ text: buildResearchPrompt(keyword, pages) }] }],
      generationConfig: { temperature: 0.2, maxOutputTokens: 6144 },
      tools: [{ google_search: {} }, ...(useUrlContext ? [{ url_context: {} }] : [])],
    };
    let res: Response;
    try {
      res = await fetch(geminiGenerateUrl(run.baseModel, run.apiKey), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(remaining),
      });
    } catch (error) {
      if (ungrounded) return finishResearch(run, ungrounded.research, ungrounded.parsed, ungrounded.data, useUrlContext);
      throw error;
    }
    if (!res.ok) {
      const text = await res.text();
      if (res.status === 400 && useUrlContext && /url_context/i.test(text)) {
        useUrlContext = false;
        continue;
      }
      const error = new GeminiHttpError(res.status, text, run.baseModel);
      if (isRateLimitError(error) && attempt < 3) {
        await sleep(error.retryAfterMs ?? 2000 * 2 ** attempt);
        continue;
      }
      throw error;
    }
    const data = await res.json();
    const parsed = parseGeminiResponse(data, run.baseModel);
    run.tracker.record(run.baseModel, parsed.usage, parsed.grounded, parsed.searchQueries.length);
    const research = parseResearchText(parsed.text);
    if (!research.searchIntent && research.competitors.length === 0) {
      throw new Error(`調査結果を読み取れませんでした: ${parsed.text.slice(0, 300)}`);
    }
    // 検索せずに答えた場合は、時間が残っていれば 1 回だけやり直す
    if (!parsed.grounded && attempt < 1) {
      ungrounded = { research, parsed, data };
      continue;
    }
    return finishResearch(run, research, parsed, data, useUrlContext);
  }
}

async function finishResearch(
  run: GenerationRun,
  research: ReturnType<typeof parseResearchText>,
  parsed: ReturnType<typeof parseGeminiResponse>,
  data: any,
  useUrlContext: boolean,
): Promise<AiResearch> {
  const resolved = await run.resolveUrls(parsed.sources.map((s) => s.uri).filter(Boolean)).catch(() => ({} as Record<string, string>));
  return {
    ...research,
    searchUsed: parsed.grounded,
    searchQueries: parsed.searchQueries,
    groundingSources: parsed.sources.map((s) => ({ title: s.title, url: resolved[s.uri] || s.uri })),
    urlContextUsed: useUrlContext && Boolean(data?.candidates?.[0]?.urlContextMetadata),
  };
}

// 構成案に渡す、調査結果の「材料」（何を書くかは見出し数の上限と検索意図で絞る。仕様書 4.0）
export function buildResearchOutlineInstructions(research: AiResearch | null | undefined): string {
  if (!research) return '';
  return [
    research.searchIntent ? `検索意図: ${research.searchIntent}` : '',
    research.readerQuestions.length
      ? `読者の疑問（見出しの数の上限の中で、検索意図に直接関係するものに答える）:\n- ${research.readerQuestions.join('\n- ')}`
      : '',
    research.gaps.length
      ? `上位記事に足りない点（参考。検索意図に直接関係するものだけ使う）:\n- ${research.gaps.join('\n- ')}`
      : '',
  ].filter(Boolean).join('\n');
}
