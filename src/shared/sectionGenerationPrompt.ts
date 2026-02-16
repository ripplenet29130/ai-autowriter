type Tone = 'professional' | 'casual' | 'technical' | 'friendly';
type KeywordPreference = 'default' | 'ng' | 'essential';

interface SectionPromptInput {
  articleTitle?: string;
  totalOutline?: string;
  sectionTitle: string;
  previousContent?: string;
  keywords?: string[];
  tone: Tone;
  targetChars: number;
  isLead?: boolean;
  customInstructions?: string;
  keywordPreferences?: Record<string, KeywordPreference>;
}

function toneText(tone: Tone): string {
  switch (tone) {
    case 'professional':
      return '専門性が高く信頼感のある文体で書いてください。';
    case 'casual':
      return '親しみやすいカジュアルな文体で書いてください。';
    case 'technical':
      return '技術的に正確で明快な文体で書いてください。';
    case 'friendly':
      return 'フレンドリーで読みやすい文体で書いてください。';
    default:
      return '';
  }
}

function keywordPreferenceText(keywordPreferences?: Record<string, KeywordPreference>): string {
  if (!keywordPreferences) return '';
  const essential = Object.entries(keywordPreferences)
    .filter(([_, pref]) => pref === 'essential')
    .map(([kw]) => kw);
  const ng = Object.entries(keywordPreferences)
    .filter(([_, pref]) => pref === 'ng')
    .map(([kw]) => kw);

  if (essential.length === 0 && ng.length === 0) return '';

  let text = '\n【キーワードの制約】\n';
  if (essential.length > 0) text += `- 必須キーワード（必ず含める）: ${essential.join('、')}\n`;
  if (ng.length > 0) text += `- NGキーワード（使わない）: ${ng.join('、')}\n`;
  return text;
}

export function buildHighQualitySectionPrompt(input: SectionPromptInput): string {
  const keywords = input.keywords?.join('、') || '（指定なし）';
  const prefText = keywordPreferenceText(input.keywordPreferences);

  return `
あなたはSEOに精通したプロのWebライターです。
読者がスマホでもストレスなく読めるよう、${input.isLead ? '導入部分（リード文）' : '特定の章（セクション）'}を執筆してください。

【記事全体のタイトル】
${input.articleTitle || '未指定'}

【記事の全体構成（目次）】
${input.totalOutline || '未指定'}

【今回執筆するセクションの見出し】
${input.sectionTitle}

${input.previousContent ? `【前の章の内容（文脈維持のため）】
${input.previousContent.substring(0, 1000)}` : ''}

【キーワード】
${keywords}
※ 文脈に沿って自然に含めてください。無理な詰め込みは禁止です。

【トーン】
${toneText(input.tone)}

【目標文字数】
${input.targetChars}文字（±10%以内）

【執筆の指示】
- 指定セクションの本文のみ出力（見出し記号やタイトルは不要）
- 途中で文を切らず、必ず完結させる
- 箇条書きや改行を適宜使い、可読性を高める
- 冗長な表現を避け、情報密度を高く保つ
- 文末は「。」で終える
${input.isLead ? '- リード文として、読者の興味を引く書き出しにする' : '- 前後の文脈につながる自然な流れで書く'}
${prefText}
${input.customInstructions ? `\n【カスタム指示（優先）】\n${input.customInstructions}\n` : ''}
`;
}
