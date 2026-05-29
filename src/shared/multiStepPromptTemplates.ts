import type { ArticleStructureType } from '../types';
import type { SearchConsolePromptQuery } from './articleGenerationCore';

export interface OutlinePromptInput {
  keyword: string;
  targetWordCount: number;
  fixedTitle?: string | null;
  customInstructions?: string;
  competitorHeadings?: string[];
  competitorArticles?: { title: string; headings: string[]; excerpt?: string }[];
  relatedKeywords?: string[];
  searchConsoleQueries?: SearchConsolePromptQuery[];
  articleStructureType?: ArticleStructureType;
}

export interface SectionPromptInput {
  articleTitle: string;
  sectionTitle: string;
  sectionLevel: number;
  sectionDescription: string;
  estimatedWordCount: number;
  isLead: boolean;
  writingTone: string;
  previousContent: string;
  totalEstimatedWordCount: number;
  customInstructions?: string;
}

export function buildSchedulerStructureRules(targetWordCount: number): string {
  if (targetWordCount <= 1200) {
    return [
      '構成ルール:',
      '- Lead 1つ、H2を4つ（最後はまとめ）',
      '- H3は原則使わない',
      '- 見出し同士の重複を避ける',
      '- 原因、具体策、注意点のうち最低2種類を含める',
      '- 入力キーワードをそのまま並べず、読者が理解・判断する順番に整理する',
      '- 見出しは短い単語ではなく、読者に内容と価値が伝わる文章形式にする',
    ].join('\n');
  }

  if (targetWordCount <= 2500) {
    return [
      '構成ルール:',
      '- Lead 1つ、主要H2を3つ前後、最後にまとめ',
      '- H2は章タイトルとして使い、本文は章の導入程度に短くする',
      '- 主要H2の直後にH3を3つ置き、具体論はH3で展開する',
      '- 記事全体でH3を8〜10つ追加。2000字前後では主要H2 3つ × H3 3つを目安にする',
      '- まとめ・導入にはH3を付けない',
      '- 各H2は異なるトピックを担当すること。同じテーマを別の表現で繰り返さない',
      '- 原因、具体策、比較、選び方、注意点、導入手順のうち最低3種類を含める',
      '- 対策系の記事では、原因、優先順位、組み合わせ方、導入前の注意点を含める',
      '- 関連キーワードを横並びにせず、主題に対する役割として整理する',
      '- 抽象的な見出しだけで終わらせず、読者が実行できる粒度に分解する',
      '- 見出しは短い単語ではなく、読者に内容と価値が伝わる文章形式にする',
    ].join('\n');
  }

  return [
    '構成ルール:',
    '- Lead 1つ、主要H2を4つ前後、最後にまとめ',
    '- H2は章タイトルとして使い、本文は章の導入程度に短くする',
    '- 主要H2の直後にH3を3つ置き、具体論はH3で展開する',
    '- 記事全体でH3を10〜13つ追加。ただしまとめ・導入にはH3を付けない',
    '- 各H2は異なるトピックを担当すること。同じテーマを別の表現で繰り返さない',
    '- 網羅性と重複回避を両立する',
    '- 原因、具体策、比較、選び方、注意点、導入手順、費用感のうち最低4種類を含める',
    '- 対策系の記事では、原因、優先順位、組み合わせ方、導入前の注意点を必ず含める',
    '- 関連キーワードを横並びにせず、主題に対する役割として整理する',
    '- 抽象的な見出しだけで終わらせず、読者が実行できる粒度に分解する',
    '- 見出しは短い単語ではなく、読者に内容と価値が伝わる文章形式にする',
  ].join('\n');
}

function buildCountermeasureOutlinePattern(): string {
  return [
    '【課題解決型記事の推奨H2パターン】',
    '- [主題]が起きる理由・原因',
    '- まず確認すべき状況・優先順位',
    '- 主要な対策1: 何をどう改善するか',
    '- 主要な対策2: 別角度から何を補うか',
    '- 複数の対策をどう組み合わせるか',
    '- 導入前に確認すべき費用・施工・安全面の注意点',
    '- まとめ',
    '',
    '避けるべき見出しパターン:',
    '- [主題]の活用方法',
    '- [主題]の選び方と注意点',
    '- [主題]の種類と特徴',
    '- [主題]とは？',
    '- よくある疑問',
  ].join('\n');
}

export function buildArticleStructureTemplate(type: ArticleStructureType = 'standard'): string {
  switch (type) {
    case 'problem_solution':
      return [
        '記事構成タイプ: 課題解決型',
        '- 読者の悩み・困りごとを起点にする',
        '- 原因、優先すべき対策、解決策、選び方、導入手順、注意点、まとめの流れを優先する',
        '- 複数の対策がある場合は、それぞれを羅列せず組み合わせ方まで整理する',
        '- 各対策は「何をすればよいか」が分かる粒度にする',
      ].join('\n');
    case 'comparison':
      return [
        '記事構成タイプ: 比較・選定型',
        '- 選ぶ前の前提、比較軸、選び方、向き不向き、注意点、まとめの流れを優先する',
        '- 条件別にどれを選ぶべきか判断できる構成にする',
        '- 複数の選択肢を単に並べず、読者の条件ごとの優先順位を示す',
        '- 比較項目は抽象論ではなく、費用・効果・手間・リスクなど具体的にする',
      ].join('\n');
    case 'practical':
      return [
        '記事構成タイプ: 実務ノウハウ型',
        '- 現場の課題、実践手順、失敗例、改善策、運用ポイント、まとめの流れを優先する',
        '- 読者が実務でそのまま使える確認項目や手順を入れる',
        '- 現場で確認する順番、導入する順番、運用で見直す点を分ける',
        '- 注意点は実行時に起きやすい問題として具体化する',
      ].join('\n');
    case 'seo_comprehensive':
      return [
        '記事構成タイプ: SEO網羅型',
        '- 基礎知識、原因、具体策、比較、選び方、注意点、よくある疑問、まとめの流れを優先する',
        '- 検索意図を広く拾い、関連論点の抜け漏れを減らす',
        '- 関連キーワードごとの見出しを量産せず、読者の疑問の流れに統合する',
        '- 似た見出しの重複を避け、各見出しの役割を明確に分ける',
      ].join('\n');
    case 'conversion':
      return [
        '記事構成タイプ: 問い合わせ導線型',
        '- 課題提起、放置リスク、解決策、導入メリット、相談前の確認点、まとめの流れを優先する',
        '- 過度に煽らず、問い合わせ前に整理すべき判断材料を入れる',
        '- 自力対応と相談すべきケースの違いが分かる構成にする',
        '- 事業者に相談する理由が自然に伝わる構成にする',
      ].join('\n');
    default:
      return [
        '記事構成タイプ: 標準解説型',
        '- 基礎知識、原因、具体策、選び方、注意点、まとめの流れを優先する',
        '- 読者が全体像を理解して次の行動を決められる構成にする',
        '- 関連キーワードは単独見出しにせず、主題の理解に必要な位置へ統合する',
        '- 一般論だけでなく、実務で使える判断基準を入れる',
      ].join('\n');
  }
}

export function buildAioStructureGuidelines(): string {
  return [
    'AIO・AI検索引用向け構造化ルール（全記事の標準品質）:',
    '- 導入では読者の質問に対する結論を先に示し、記事全体で何が分かるかを明確にする',
    '- 各H2/H3は「定義」「原因」「手順」「比較」「判断基準」「注意点」「FAQ」のどの役割か分かる見出しにする',
    '- AIが要約しやすいように、1つの見出しで複数テーマを混ぜず、答えを短く抽出できる構成にする',
    '- 各H2の冒頭には、その見出しで扱う答え・結論・判断基準を1〜2文で置ける構成にする',
    '- 手順や選び方を扱う場合は、順番・条件・判断基準が分かる流れにする',
    '- 比較、料金、条件、手順などは、必要に応じて表や箇条書きにしやすい見出し構成にする',
    '- 比較を扱う場合は、比較軸を先に示し、違い・向いているケース・注意点を分ける',
    '- 断定する情報には、前提条件・例外・注意点を同じセクション内で補足できる構成にする',
    '- よくある疑問が想定されるテーマでは、終盤にFAQへ転用しやすい疑問解消の見出しを入れる',
    '- まとめでは単なる再掲ではなく、読者が次に取る行動や確認点を簡潔に整理する',
  ].join('\n');
}

function buildSearchConsoleQueryGuidance(queries?: SearchConsolePromptQuery[]): string {
  const rows = (queries || [])
    .map((row) => ({
      query: String(row.query || '').trim(),
      clicks: row.clicks ?? 0,
      impressions: row.impressions ?? 0,
      ctr: row.ctr,
      position: row.position,
    }))
    .filter((row) => row.query)
    .slice(0, 10);

  if (rows.length === 0) return '';

  const formatPercent = (value?: number) =>
    typeof value === 'number' && Number.isFinite(value) ? `${(value * 100).toFixed(1)}%` : '-';
  const formatPosition = (value?: number) =>
    typeof value === 'number' && Number.isFinite(value) ? value.toFixed(1) : '-';

  const queryLines = rows
    .map((row) => `- ${row.query}（クリック:${row.clicks} / 表示:${row.impressions} / CTR:${formatPercent(row.ctr)} / 平均順位:${formatPosition(row.position)}）`)
    .join('\n');

  return `
【Search Console検索クエリ（検索意図の補助材料）】
${queryLines}

使い方:
- クリック数があるクエリは、既に読者反応がある表現としてタイトル・導入・主要見出しの参考にする
- 表示回数が多くCTRが低いクエリは、読者の疑問に対する結論や見出しの具体性を補う材料にする
- 平均順位が低いクエリは、本文で補足すべき関連疑問として扱う
- クエリをそのまま羅列したり、全てを見出し化したりしない
`.trim();
}

export function buildSchedulerOutlinePrompt(input: OutlinePromptInput): string {
  const competitorInsights = (() => {
    if (input.competitorArticles && input.competitorArticles.length > 0) {
      const articlesText = input.competitorArticles
        .map((a, i) => {
          const headingLines = a.headings.slice(0, 5).map((h) => `  見出し: ${h}`).join('\n');
          const excerptLine = a.excerpt ? `  内容抜粋: ${a.excerpt}` : '';
          return `記事${i + 1}「${a.title}」\n${headingLines}${excerptLine ? '\n' + excerptLine : ''}`;
        })
        .join('\n\n');
      return `\n【上位記事の内容（参照のみ。分析や解説の出力は不要。アウトラインの形式だけを出力すること）】\n${articlesText}\n\n※上記の内容に含まれる具体的な話題・解決策・注意点をセクション設計の根拠にすること。根拠のない汎用的な見出しを作らないこと\n`;
    }
    if (input.competitorHeadings && input.competitorHeadings.length > 0) {
      return `\n【上位記事が扱っているトピック（読者の期待する内容を把握する材料として使うこと）】\n- ${input.competitorHeadings.join('\n- ')}\n※これらのトピックから読者の疑問を推定し、その疑問に答える見出しを作ること。見出しの表現は独立させること\n`;
    }
    return '';
  })();

  const relatedKeywordsSection =
    input.relatedKeywords && input.relatedKeywords.length > 0
      ? `\n【読者の関心キーワード（各キーワードを単独で見出し化せず、最も適切なセクションに統合すること）】\n${input.relatedKeywords.join('、')}\n`
      : '';
  const searchConsoleQuerySection = buildSearchConsoleQueryGuidance(input.searchConsoleQueries);

  const structureRules = buildSchedulerStructureRules(input.targetWordCount);
  const structureTemplate = buildArticleStructureTemplate(input.articleStructureType);
  const aioStructureGuidelines = buildAioStructureGuidelines();
  const countermeasurePattern = input.articleStructureType === 'problem_solution' || !input.articleStructureType
    ? buildCountermeasureOutlinePattern()
    : '';

  return `
あなたは日本語SEOライターです。以下の条件で、オリジナルの記事アウトラインを作成してください。

【メインキーワード】
${input.keyword}

【目標文字数】
${input.targetWordCount}文字

${input.fixedTitle ? `【固定タイトル】\n${input.fixedTitle}\n` : ''}
${input.customInstructions ? `【追加指示】\n${input.customInstructions}\n` : ''}
${competitorInsights}
${relatedKeywordsSection}
${searchConsoleQuerySection}
${structureRules}

${structureTemplate}

${aioStructureGuidelines}

${countermeasurePattern}

【見出し作成ルール】
- 各見出しは、読者にそのセクションで得られる内容・価値が具体的に伝わる表現にする
- 既存記事の見出しを模倣しない。構成・語順・表現すべてオリジナルにする
- キーワードを機械的に繰り返さない（全見出しに同じ語を入れない）
- 主題語はタイトル・導入・必要なH2だけに使い、全見出しの先頭に同じ語を付けない
- 同じ主題語を繰り返す代わりに「内部」「作業環境」「設備」「対策」「導入前」など役割が分かる表現へ置き換える
- 入力キーワードをそのまま見出し化しない。キーワードは主題に対する役割へ変換して配置する
- 見出しは「読者が確認・判断・実行する順番」に並べる
- 対策系の記事では、必ず「原因」「優先順位」「組み合わせ方」「導入前の注意点」を含める
- 関連キーワードを並列に並べず、主題に沿って原因、対策、比較、注意点などへ再分類する
- 「夏」「方法」「種類」「活用」などの広すぎる単語を単独の見出しテーマにしない
- 「〇〇の種類と特徴」「〇〇の選び方と注意点」だけの浅い見出しを避け、何を判断できるのかまで書く
- 「〜のチェックポイント」「〜のポイントを押さえる」などの汎用的な定型表現を避ける
- 一般論だけでなく、原因、対策、比較、選定基準、注意点、導入後の運用まで流れが分かる構成にする
- H3は直前のH2を補足する小見出しとして配置し、独立した大テーマにしない
- 原因とリスク、選択肢の比較、判断基準と注意点のように、本文が長くなりやすいH2はH3で分ける
- タイトルとキーワードだけから作る場合でも、業界・用途・読者の困りごとを推定して具体化する
- 見出しの先頭・末尾に「」や（）などの括弧記号を使わない
- 出力は下記フォーマットのみ。前置き・解説・補足は不要

出力形式（この形式のみ）:

Title: [記事タイトル]

Section (Lead): [導入セクション名]
Description: [このセクションで扱う内容の要点（30字以内）]
Estimated: [推定文字数]

Section (H2): [見出し]
Description: [このセクションで扱う内容の要点（30字以内）]
Estimated: [推定文字数]

Section (H3): [必要な場合のみ]
Description: [このセクションで扱う内容の要点（30字以内）]
Estimated: [推定文字数]

注意:
- Descriptionは本文ではなく、セクション内容の要点メモのみ（30字以内厳守）
- Descriptionは途中で切らず、読点「、」や「や」「と」「した」などで終えないこと
- H3は必ず関連するH2の直後に置くこと
- H3を置く場合、その直前のH2は章の導入・概要にし、詳細はH3へ分けること
- 最後のH2は「まとめ」にしてください。
`.trim();
}

export function resolveToneInstruction(writingTone: string): string {
  if (writingTone === 'casual' || writingTone === 'friendly' || writingTone === 'desu_masu') {
    return '親しみやすい文体。くだけすぎない。';
  }
  return '専門的で丁寧な文体。根拠に基づいて説明する。';
}

export function buildSchedulerSectionPrompt(input: SectionPromptInput): string {
  return `
次のセクション本文を作成してください。

タイトル: ${input.articleTitle}
セクション: ${input.sectionTitle} (${input.sectionLevel === 2 ? 'H2' : 'H3'})
説明: ${input.sectionDescription}
推定文字数: ${input.estimatedWordCount}
文体: ${resolveToneInstruction(input.writingTone)}

${input.customInstructions ? `追加指示:\n${input.customInstructions}\n` : ''}
直前文脈:
${input.previousContent.slice(-700)}

本文のみ出力してください。見出しは不要です。
`.trim();
}
