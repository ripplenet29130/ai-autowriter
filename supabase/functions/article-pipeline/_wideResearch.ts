// 広い調査（試験中）: 上位記事の「中身」・Q&A サイトの実際の悩み・公式情報を、同時に調べる
// 今の調査（_research.ts）は上位記事 3 件の見出しだけを使うため、構成が上位記事のなぞりになり、
// 一般論っぽい記事になっていた（2026-11-12）。ここでは材料を広く集め、書く AI にそのまま渡す。
import {
  GeminiHttpError,
  geminiGenerateUrl,
  isRateLimitError,
  parseGeminiResponse,
  sleep,
} from '../../../src/shared/geminiCore.ts';
import type { GenerationRun } from '../scheduler-executor/_run.ts';

export type WideResearchPart = 'top_a' | 'top_b' | 'voices' | 'official';

export const WIDE_RESEARCH_LABELS: Record<WideResearchPart, string> = {
  top_a: '上位記事の中身（1）',
  top_b: '上位記事の中身（2）',
  voices: '実際の悩み（Q&A サイトなど）',
  official: '公式情報と最近の変更',
};

export interface WideResearchResult {
  part: WideResearchPart;
  ok: boolean;
  text: string;
  error?: string;
  grounded: boolean;
  sources: Array<{ title: string; url: string }>;
  ms: number;
}

export interface WideResearch {
  parts: WideResearchResult[];
  // 参考資料の候補（公式情報を先に）
  sources: Array<{ title: string; url: string }>;
}

const TOP_FORMAT = [
  '次の形式で書いてください（JSON やコードフェンスは使わない）。記事の文章をそのまま写さず、要点を自分の言葉でまとめてください。',
  '## 記事ごとのメモ',
  '### 読んだ記事のタイトル',
  'URL: 実際に読んだページの URL',
  '- 結論・主張: その記事が一番伝えていること',
  '- 具体例・数字: 出している具体的な場面・計算例・金額・日数など（あるだけ）',
  '- 説明の工夫: 表・手順・チェックリスト・図解など、分かりやすくしている工夫',
  '- この記事だけの話: 他の記事にない情報や切り口',
  '- 弱い点: 説明が薄い・あいまい・古いと感じた点',
  '## どの記事にも書いてある定番の話',
  '- 定番の話（読者にとっては「もう知っている」可能性が高いこと）',
  '## どの記事も書いていない・薄い話',
  '- 読者が知りたいはずなのに、どの記事も十分に書いていないこと',
].join('\n');

export function buildWideResearchPrompt(part: WideResearchPart, keyword: string): string {
  if (part === 'top_a' || part === 'top_b') {
    const range = part === 'top_a'
      ? '検索結果の上位（1〜4 位あたり）の記事ページを 4 件'
      : '検索結果の 5〜10 位あたりの記事ページを 4 件（上位 1〜4 位とは別のサイトを選ぶ）';
    return [
      `キーワード「${keyword}」で日本の Google 検索をして、${range}実際に読んでください（広告・動画・SNS・EC の商品ページは除く）。`,
      '見出しだけでなく、本文の中身（どんな例・数字・説明の工夫を使っているか）を読んでください。',
      '',
      TOP_FORMAT,
    ].join('\n');
  }
  if (part === 'voices') {
    return [
      `「${keyword}」について、実際の人が書いた悩みや体験を調べてください。`,
      'Yahoo!知恵袋・教えて!goo・発言小町などの Q&A サイトや、体験談を Google 検索し、実際に読んでください。',
      '個人を特定できる情報（名前・住所など）は書かないでください。投稿の文章をそのまま写さず、状況を要約してください。',
      '',
      '次の形式で書いてください（JSON やコードフェンスは使わない）。',
      '## 実際の悩み・状況',
      '- 誰が・どんな状況で・何に困っているか（具体的に。例: 「父が亡くなって 9 か月、兄と話がまとまらない」）',
      '## よくある勘違い・つまずき',
      '- 実際の人が勘違いしていたこと、失敗したこと',
      '## 回答でよく出るアドバイス',
      '- 回答者や体験者がよく勧めていること（正しいかどうかは問わず、そのまま要約）',
      '## 記事で答えるべき本音の疑問',
      '- 一般的な解説記事では答えていない、実際の人の切実な疑問',
    ].join('\n');
  }
  return [
    `「${keyword}」について、公的機関・公式サイト（官公庁・自治体・メーカー・業界団体など）の情報を Google 検索し、実際に読んでください。`,
    '記事に使える正確な条件・数字・手続きと、最近の変更を集めてください。',
    '',
    '次の形式で書いてください（JSON やコードフェンスは使わない）。',
    '## 正確な条件・数字・手続き',
    '- 事実（数字や条件は正確に）｜出典の名前｜いつ時点の情報か',
    '## 例外・特例・判断の分かれ目',
    '- 「この場合はこうなる」という分かれ目や例外',
    '## 最近の変更・今後の変更',
    '- 直近 1〜2 年の変更や、予定されている変更（なければ「なし」）',
  ].join('\n');
}

async function runPart(
  run: GenerationRun,
  part: WideResearchPart,
  keyword: string,
  timeoutMs: number,
): Promise<WideResearchResult> {
  const started = Date.now();
  const deadline = started + timeoutMs;
  let useUrlContext = true;
  let ungrounded: WideResearchResult | null = null;
  for (let attempt = 0; ; attempt++) {
    const remaining = deadline - Date.now();
    if (remaining < 15_000) {
      if (ungrounded) return ungrounded;
      return { part, ok: false, text: '', error: '時間が足りませんでした', grounded: false, sources: [], ms: Date.now() - started };
    }
    try {
      const res = await fetch(geminiGenerateUrl(run.baseModel, run.apiKey), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ role: 'user', parts: [{ text: buildWideResearchPrompt(part, keyword) }] }],
          generationConfig: { temperature: 0.2, maxOutputTokens: 8192 },
          tools: [{ google_search: {} }, ...(useUrlContext ? [{ url_context: {} }] : [])],
        }),
        signal: AbortSignal.timeout(remaining),
      });
      if (!res.ok) {
        const body = await res.text();
        if (res.status === 400 && useUrlContext && /url_context/i.test(body)) {
          useUrlContext = false;
          continue;
        }
        const error = new GeminiHttpError(res.status, body, run.baseModel);
        if (isRateLimitError(error) && attempt < 3) {
          await sleep(error.retryAfterMs ?? 2000 * 2 ** attempt);
          continue;
        }
        throw error;
      }
      const parsed = parseGeminiResponse(await res.json(), run.baseModel);
      run.tracker.record(run.baseModel, parsed.usage, parsed.grounded, parsed.searchQueries.length);
      const resolved = await run.resolveUrls(parsed.sources.map((s) => s.uri).filter(Boolean)).catch(() => ({} as Record<string, string>));
      const result: WideResearchResult = {
        part,
        ok: parsed.text.trim().length > 0,
        text: parsed.text.trim(),
        grounded: parsed.grounded,
        sources: parsed.sources.map((s) => ({ title: s.title, url: resolved[s.uri] || s.uri })),
        ms: Date.now() - started,
      };
      // 検索せずに答えたときは、時間があれば 1 回だけ聞き直す
      if (!parsed.grounded && attempt < 1) {
        ungrounded = result;
        continue;
      }
      return result;
    } catch (error) {
      if (ungrounded) return ungrounded;
      const message = error instanceof Error ? error.message : String(error || '');
      return { part, ok: false, text: '', error: message.slice(0, 200), grounded: false, sources: [], ms: Date.now() - started };
    }
  }
}

// 4 つの調査を同時に行う（1 工程 120 秒に収まるよう、それぞれ timeoutMs で打ち切る）
export async function runWideResearch(run: GenerationRun, keyword: string, timeoutMs = 100_000): Promise<WideResearch> {
  const parts: WideResearchPart[] = ['top_a', 'top_b', 'voices', 'official'];
  const results = await Promise.all(parts.map((part) => runPart(run, part, keyword, timeoutMs)));
  const seen = new Set<string>();
  const sources: WideResearch['sources'] = [];
  for (const r of [...results].sort((a, b) => (a.part === 'official' ? -1 : 0) - (b.part === 'official' ? -1 : 0))) {
    for (const s of r.sources) {
      if (!s.url || seen.has(s.url)) continue;
      seen.add(s.url);
      sources.push(s);
    }
  }
  return { parts: results, sources };
}

// 参考資料に載せる出典（公式情報を先に、動画・SNS・Q&A サイトは除いて最大 maxItems 件）
const NON_REFERENCE_PATTERN = /vertexaisearch|google\.com|youtube\.com|youtu\.be|x\.com|twitter\.com|instagram\.com|tiktok\.com|facebook\.com|chiebukuro|oshiete\.goo|komachi|note\.com\/.*\/n\//;

export function selectWideReferences(sources: WideResearch['sources'], maxItems = 5): WideResearch['sources'] {
  return sources.filter((s) => /^https?:\/\//.test(s.url) && !NON_REFERENCE_PATTERN.test(s.url)).slice(0, maxItems);
}

export function buildWideReferencesMarkdown(sources: WideResearch['sources'], maxItems = 5): string {
  const refs = selectWideReferences(sources, maxItems);
  if (refs.length === 0) return '';
  const label = (url: string, title: string) => {
    try {
      return new URL(url).hostname.replace(/^www\./, '');
    } catch {
      return title;
    }
  };
  return ['## 参考資料', '', ...refs.map((s) => `- [${label(s.url, s.title)}](${s.url})`)].join('\n');
}

// 書く AI に渡す材料（検索で確かめられなかった調査は「参考程度」と明記する）
export function formatWideResearchForWriter(research: WideResearch, maxCharsPerPart = 7000): string {
  return research.parts
    .filter((p) => p.ok)
    .map((p) => [
      `===== ${WIDE_RESEARCH_LABELS[p.part]}${p.grounded ? '' : '（検索が使われなかったため参考程度）'} =====`,
      p.text.slice(0, maxCharsPerPart),
    ].join('\n'))
    .join('\n\n');
}
