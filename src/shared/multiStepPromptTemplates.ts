export interface OutlinePromptInput {
  keyword: string;
  targetWordCount: number;
  fixedTitle?: string | null;
  customInstructions?: string;
  competitorHeadings?: string[];
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
      '- Lead 1つ、H2を3つ（最後はまとめ）',
      '- H3は原則使わない',
      '- 見出し同士の重複を避ける',
      '- 見出しは短い単語ではなく、読者に内容と価値が伝わる文章形式にする',
    ].join('\n');
  }

  if (targetWordCount <= 2500) {
    return [
      '構成ルール:',
      '- Lead 1つ、H2を4つ（最後はまとめ）',
      '- 必要ならH3を1〜2つ追加',
      '- 具体例を入れやすい見出しにする',
      '- 見出しは短い単語ではなく、読者に内容と価値が伝わる文章形式にする',
    ].join('\n');
  }

  return [
    '構成ルール:',
    '- Lead 1つ、H2を4〜5つ（最後はまとめ）',
    '- 必要に応じてH3を2〜4つ',
    '- 網羅性と重複回避を両立する',
    '- 見出しは短い単語ではなく、読者に内容と価値が伝わる文章形式にする',
  ].join('\n');
}

export function buildSchedulerOutlinePrompt(input: OutlinePromptInput): string {
  const competitorInsights =
    input.competitorHeadings && input.competitorHeadings.length > 0
      ? `\n【参考見出し（必要なものだけ取り入れる）】\n- ${input.competitorHeadings.join('\n- ')}\n`
      : '';

  const structureRules = buildSchedulerStructureRules(input.targetWordCount);

  return `
次の条件で、日本語SEO記事のアウトラインを作成してください。

【メインキーワード】
${input.keyword}

【目標文字数】
${input.targetWordCount}文字

${input.fixedTitle ? `【固定タイトル】\n${input.fixedTitle}\n` : ''}
${input.customInstructions ? `【追加指示】\n${input.customInstructions}\n` : ''}
${competitorInsights}
${structureRules}

出力形式は必ず次のフォーマットにしてください（この形式以外は不可）。

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
- 出力は上記フォーマットのみ。前置きや解説は不要です。
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

