import type { ArticleStructureType } from '../types';

export interface OutlinePromptInput {
  keyword: string;
  targetWordCount: number;
  fixedTitle?: string | null;
  customInstructions?: string;
  competitorHeadings?: string[];
  relatedKeywords?: string[];
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
      '- Lead 1つ、H2を5〜6つ（最後はまとめ）',
      '- 必要に応じてH3を2〜4つ追加',
      '- 原因、具体策、比較、選び方、注意点、導入手順のうち最低4種類を含める',
      '- 対策系の記事では、原因、優先順位、組み合わせ方、導入前の注意点を必ず含める',
      '- 関連キーワードを横並びにせず、主題に対する役割として整理する',
      '- 抽象的な見出しだけで終わらせず、読者が実行できる粒度に分解する',
      '- 具体例、判断基準、失敗しやすい点を入れやすい見出しにする',
      '- 見出しは短い単語ではなく、読者に内容と価値が伝わる文章形式にする',
    ].join('\n');
  }

  return [
    '構成ルール:',
    '- Lead 1つ、H2を6〜7つ（最後はまとめ）',
    '- 必要に応じてH3を3〜6つ',
    '- 網羅性と重複回避を両立する',
    '- 原因、具体策、比較、選び方、注意点、導入手順、費用感のうち最低5種類を含める',
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

export function buildSchedulerOutlinePrompt(input: OutlinePromptInput): string {
  const competitorInsights =
    input.competitorHeadings && input.competitorHeadings.length > 0
      ? `\n【上位記事がカバーしているトピック（読者が期待している内容として参考にすること。見出しの表現はオリジナルにすること）】\n- ${input.competitorHeadings.join('\n- ')}\n`
      : '';

  const relatedKeywordsSection =
    input.relatedKeywords && input.relatedKeywords.length > 0
      ? `\n【読者の関心キーワード（これらのトピックを構成の中に統合すること）】\n${input.relatedKeywords.join('、')}\n`
      : '';

  const structureRules = buildSchedulerStructureRules(input.targetWordCount);
  const structureTemplate = buildArticleStructureTemplate(input.articleStructureType);
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
${structureRules}

${structureTemplate}

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
- タイトルとキーワードだけから作る場合でも、業界・用途・読者の困りごとを推定して具体化する
- 見出しの先頭・末尾に「」や（）などの括弧記号を使わない
- 出力は下記フォーマットのみ。前置き・解説・補足は不要

出力形式（この形式のみ）:

Title: [記事タイトル]

Section (Lead): [導入セクション名]
Description: [セクションの説明]
Estimated: [推定文字数]

Section (H2): [見出し]
Description: [セクションの説明]
Estimated: [推定文字数]

Section (H3): [必要な場合のみ]
Description: [セクションの説明]
Estimated: [推定文字数]

注意:
- 最後のH2は「まとめ」にしてください。
`.trim();
}

export function resolveToneInstruction(writingTone: string): string {
  if (writingTone === 'casual') {
    return '親しみやすい文体。くだけすぎない。';
  }
  if (writingTone === 'technical') {
    return '専門用語を正確に使い、論理的に説明する。';
  }
  if (writingTone === 'friendly') {
    return '読者に寄り添い、わかりやすく解説する。';
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

