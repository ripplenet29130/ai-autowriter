export interface SummaryPromptInput {
  originalContent: string;
  title: string;
  targetWordCount: number;
  keywords: string[];
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
}

export function buildSummaryPrompt(input: SummaryPromptInput): string {
  return `
次の本文を、意味を保ったまま ${input.targetWordCount} 字前後に要約してください。
タイトル: ${input.title}
関連キーワード: ${input.keywords.length > 0 ? input.keywords.join('、') : 'なし'}

要件:
- 情報の正確性を保つ
- 結論・重要ポイントを優先して残す
- 本文の見出し構造や書式は維持する
- 不自然な短縮や重複は避ける
- キーワードを機械的に繰り返さない
- 読み手に自然な日本語として違和感なく読める文にする

本文:
${input.originalContent}
`.trim();
}

export function buildSupplementPrompt(input: SupplementPromptInput): string {
  const isSection = input.isSection === true;
  const sectionLine = input.sectionTitle ? `セクション: ${input.sectionTitle}` : '';
  const rangeLine = `目標レンジ: ${input.minAllowed}〜${input.maxAllowed}字`;

  return `
次の本文は文字数が不足しています。既存内容と整合する追記のみを作成してください。
現在文字数: ${input.currentCount}
不足目安: ${input.remaining}字
${rangeLine}
タイトル: ${input.title}
${sectionLine}
関連キーワード: ${input.keywords.length > 0 ? input.keywords.join('、') : 'なし'}

追記ルール:
- 既存内容を繰り返さない
- 新しい情報を自然に補う
- キーワードは必要な場合のみ自然な文脈で使い、無理に挿入しない
- ${isSection ? '本文のみを出力し、見出しは出力しない' : '記事全体の流れを崩さない'}

既存本文:
${input.originalContent}
`.trim();
}
