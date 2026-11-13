// 1 回で書き切る書き方（試験中）: Gemini アプリと同じく、上位モデル（Pro）が検索しながら記事全体を一度に書く
// 工程を分けて「根拠メモにない数字は書かない」「断定しない」と縛ると、無難で一般論っぽい文章になったため
// （2026-11-12）、広い調査の材料を渡して自由に書かせ、間違いはあとのファクトチェックで拾う。
import type { GeminiCaller } from '../../../src/shared/geminiCore.ts';

export const ONE_SHOT_THINKING_BUDGET = 12288;

export interface OneShotParams {
  keyword: string;
  material: string;
  // 人が指定したタイトル（あればそのまま使う）
  fixedTitle?: string | null;
  toneInstruction?: string;
  // 文字数指定のとき（おまかせなら省略）
  targetChars?: number | null;
  customInstructions?: string;
  today?: Date;
}

export function buildOneShotPrompt(params: OneShotParams): string {
  const today = params.today ?? new Date();
  const todayText = `${today.getFullYear()}年${today.getMonth() + 1}月${today.getDate()}日`;
  return [
    `あなたは「${params.keyword}」の分野に詳しい、実務経験のある書き手です。このキーワードで検索した人のための日本語の記事を書いてください。`,
    `今日の日付: ${todayText}`,
    '',
    '下に、上位記事の中身・実際の人の悩み・公式情報の調査結果があります。これを材料にして、上位記事のどれよりも役に立つ記事を書いてください。',
    '数字・条件・制度で不確かなものは、Google 検索で確かめてから書いてください。',
    '',
    '【書き方】',
    '- 冒頭の 2〜3 文で、検索した人の一番の疑問に結論で答える',
    '- 「どの記事にも書いてある定番の話」は短く済ませ、「どの記事も書いていない・薄い話」と「実際の悩み」に答える部分を厚くする',
    '- 抽象的な説明で終わらせず、具体的な場面で示す（例: 日付・金額・家族構成・状況を入れた例）。計算が関係するなら、実際に数字を入れた計算例を出す',
    '- 読者が「自分はどれに当たるか」を判断できるように、条件の分かれ目をはっきり書く。比較や区分が多いときは表を使う',
    '- 実際の人がよくする勘違いやつまずきを取り上げ、なぜそうなるか・どうすればよいかを書く',
    '- 自分が対象かどうかの判定基準や、一緒に知りたい関連の期限・手続きがあれば必ず書く',
    '- 事実ははっきり言い切る。「〜とされています」「〜と考えられます」でぼかさない。本当に不確かな点だけ、その理由と一緒に書く',
    '- 決まり文句を使わない: 「注意が必要です」「確認しましょう」「重要です」「〜することが大切です」「専門家に相談しましょう」を繰り返さない。言うなら、何に・なぜ・どうするかを具体的に書く',
    '- 上位記事の文章をそのまま使わない。自分の言葉で書く',
    '',
    '【形式】',
    params.fixedTitle
      ? `- 1 行目は「# ${params.fixedTitle}」（このタイトルをそのまま使う）`
      : '- 1 行目は「# タイトル」。タイトルは 28〜40 字で、キーワードを自然に含め、記事を読むと何が分かるかが伝わるものにする。「徹底解説」「完全ガイド」などの宣伝文句は使わない',
    '- 2 行目以降は Markdown の本文。見出しは ## と ### を使う。最後の見出しは「## まとめ」で、読者が次にやることを書く',
    params.targetChars
      ? `- 長さは約 ${params.targetChars} 字（±20% 以内）。水増ししない`
      : '- 長さは内容に必要なだけ（目安 3,000〜6,000 字）。水増ししない',
    params.toneInstruction ? `- 文体: ${params.toneInstruction}` : '',
    '- Q&A を入れるときは「## まとめ」の直前に「## よくある疑問」を作り、その下に ### の見出しで質問文そのものを書く（例: 「### 古い機械は放置しても大丈夫ですか」）。「### 質問」「### Q1」のような仮の言葉を見出しにしない',
    '- 箇条書きは各項目を「- 」で始めて 1 行ずつ書く。「・」を文中に続けて並べない',
    '- 1 つの段落は 1〜2 文（100 字まで）にして、段落の間は空行を 1 行入れる。文の途中で改行しない',
    '- 表は Markdown の表で書き、前後に空行を入れる。列は 3〜4 列まで、1 マスは 20 字程度までの短い言葉にする。長い説明（メリット・デメリットなど）は表に入れず、表の下に箇条書きで書く',
    '- 見出しのつもりの行は必ず ## か ### で書く。「**【〜】**」のような太字だけの行を見出し代わりにしない',
    '- 法律・料金・税率など時間で変わる情報を扱うときだけ、本文の最後に「（2026年◯月時点の情報です）」を 1 回だけ書く。本文の途中に時点を何度も書かない',
    '- 参考資料の一覧・説明文・コードフェンスは付けない。記事だけを返す',
    '',
    params.customInstructions ? `【追加の指示】\n${params.customInstructions}\n` : '',
    '【調査結果（材料）】',
    params.material,
  ].filter((line) => line !== null).join('\n');
}

export interface OneShotArticle {
  title: string;
  content: string;
  grounded: boolean;
  sources: Array<{ title: string; uri: string }>;
}

export function splitTitleAndBody(text: string, fallbackTitle: string): { title: string; content: string } {
  const cleaned = String(text || '').trim().replace(/^```(?:markdown|md)?\s*/i, '').replace(/\s*```$/, '').trim();
  const lines = cleaned.split('\n');
  const first = lines.findIndex((line) => line.trim().length > 0);
  if (first >= 0 && /^#\s+/.test(lines[first].trim())) {
    return { title: lines[first].trim().replace(/^#\s+/, '').trim(), content: lines.slice(first + 1).join('\n').trim() };
  }
  return { title: fallbackTitle, content: cleaned };
}

// call: Gemini（GenerationRun.call）か、AI 設定で選んだ ChatGPT・Claude の呼び出し口
// useSearch: ChatGPT・Claude では時間を優先して検索しない（調査の材料とあとのファクトチェックで補う）
export async function writeOneShotArticle(
  call: GeminiCaller,
  params: OneShotParams,
  options: { useSearch?: boolean } = {},
): Promise<OneShotArticle> {
  const response = await call(buildOneShotPrompt(params), {
    role: 'writer',
    useSearch: options.useSearch !== false,
    maxOutputTokens: 16000,
    temperature: 0.7,
    thinkingBudget: ONE_SHOT_THINKING_BUDGET,
  });
  if (response.finishReason === 'MAX_TOKENS') {
    throw new Error('記事が途中で切れました（出力の上限）');
  }
  const split = splitTitleAndBody(response.text, params.fixedTitle || params.keyword);
  const title = params.fixedTitle || split.title;
  const content = split.content;
  if (content.length < 800) throw new Error(`記事が短すぎます（${content.length}字）`);
  return { title, content, grounded: response.grounded, sources: response.sources.map((s) => ({ title: s.title, uri: s.uri })) };
}
