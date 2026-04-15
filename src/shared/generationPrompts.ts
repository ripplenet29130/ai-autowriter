export interface SummaryPromptInput {
  originalContent: string;
  title: string;
  targetWordCount: number;
  keywords: string[];
  customInstructions?: string;
}

export interface SupplementPromptInput {
  originalContent: string;
  currentCount: number;
  minAllowed: number;
  maxAllowed: number;
  remaining: number;
  title: string;
  sectionTitle?: string;
  keywords: string[];
  isSection?: boolean;
  hasSummaryAnchor?: boolean;
  customInstructions?: string;
}

export function buildSummaryPrompt(input: SummaryPromptInput): string {
  return `
次の本文を、意味を保ったまま ${input.targetWordCount} 字前後に要約してください。タイトル: ${input.title}
関連キーワード: ${input.keywords.length > 0 ? input.keywords.join('、') : 'なし'}
${input.customInstructions ? `追加指示:\n${input.customInstructions}\n` : ''}

要約条件:
- 重要な情報を優先して残す
- 見出しや本文の流れを壊さず自然につなぐ
- 本文中の事実関係や文脈を変えない
- 不要な前置きや結論の言い換えを足さない
- キーワードを不自然に増やさない
- 読みやすい自然な日本語として整える
- 要約文だけを返す

本文
${input.originalContent}
`.trim();
}

export function buildSupplementPrompt(input: SupplementPromptInput): string {
  const isSection = input.isSection === true;
  const sectionLine = input.sectionTitle ? `セクション: ${input.sectionTitle}` : '';
  const rangeLine = `許容レンジ: ${input.minAllowed}〜${input.maxAllowed}字`;

  return `
次の本文は文字数が不足しています。元の方針と整合する補足だけを追加してください。現在文字数: ${input.currentCount}
不足目安: ${input.remaining}字
${rangeLine}
タイトル: ${input.title}
${sectionLine}
関連キーワード: ${input.keywords.length > 0 ? input.keywords.join('、') : 'なし'}
${input.customInstructions ? `追加指示:\n${input.customInstructions}\n` : ''}

補足ルール:
- 既存の内容と矛盾させない
- 新しい重要情報を自然に補う
- キーワードの詰め込みをしない
- ${isSection ? '本文だけを返し、見出しは出力しない' : '記事全体の流れを壊さない'}
- 追加文だけを返す

既存本文
${input.originalContent}
`.trim();
}
