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
以下の記事を、正確に${input.targetWordCount}文字にまとめ直してください。

【元の記事タイトル】
${input.title}

【元の記事内容】
${input.originalContent}

【要約の条件】
1. **文字数**: 正確に${input.targetWordCount}文字（±10%以内厳守）
2. **キーワード維持**: 以下のキーワードを必ず自然な形で含める
   ${input.keywords.length > 0 ? input.keywords.join('、') : '（指定なし）'}
3. **構成維持**: 元の見出し構造（##）を可能な限り保持
4. **情報密度**: 冗長な表現を削り、重要な情報のみを残す
5. **自然な文章**: 途中で切れることなく、完結した文章にする

【出力形式】
- Markdown形式で出力
- 見出しには ## を使用
- タイトル行は出力しない（本文のみ）
- 「本文:」などの接頭辞は禁止
`;
}

export function buildSupplementPrompt(input: SupplementPromptInput): string {
  const isSection = input.isSection === true;
  const hasSummaryAnchor = input.hasSummaryAnchor === true;

  return `
以下の既存本文はそのまま維持し、末尾に自然につながる追記だけを作成してください。

【現在の文字数】
${input.currentCount}文字

【必須要件】
1. 追記後の合計を最低${input.minAllowed}文字以上にする
2. 追記後の合計は${input.maxAllowed}文字を超えない
3. 既存本文は書き換えない
4. 出力は「追記本文のみ」（タイトル、注釈、説明文は禁止）
5. 文末は必ず句点（。）で完結させる
6. 「まとめ」「結論」「おわりに」「最後に」「総括」など締めくくりの見出し・文言は絶対に書かない
7. 要約調・結論調の締め文（例: 「以上のように」「〜といえるでしょう」）で終えない
${isSection ? '8. 見出し（#, ##, ###）は一切出力しない' : '8. 既存のMarkdown構成に自然になじむ内容にする'}
${hasSummaryAnchor ? '9. この追記は、既存記事にある最後の「まとめ」見出しより前に入る本文として作成する' : ''}
${input.keywords.length ? `10. 次のキーワードを不自然にならない範囲で含める: ${input.keywords.join('、')}` : ''}
${!isSection ? '11. 追記は既存記事と同じくMarkdown見出しタグを使う（大項目は`##`、必要なら小項目は`###`）' : ''}

【不足の目安】
あと約${input.remaining}文字（不足分を埋める量を目安）

【記事タイトル】
${input.title}

【今回のセクション】
${input.sectionTitle || ''}

【既存本文】
${input.originalContent}
`;
}
