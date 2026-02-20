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

function toneInstruction(tone: Tone): string {
  switch (tone) {
    case 'professional':
      return '専門的で客観的な文体で、根拠を意識して簡潔に説明してください。';
    case 'casual':
      return '読みやすい会話調で、親しみやすく説明してください。';
    case 'technical':
      return '用語を正確に使い、論理的で技術的な説明を優先してください。';
    case 'friendly':
      return '丁寧でやわらかい語り口で、安心感のある表現にしてください。';
    default:
      return '自然で読みやすい文体で説明してください。';
  }
}

function dedupeKeywords(keywords?: string[]): string[] {
  if (!keywords || keywords.length === 0) return [];
  const seen = new Set<string>();
  const result: string[] = [];

  for (const raw of keywords) {
    const k = String(raw || '').trim();
    if (!k || seen.has(k)) continue;
    seen.add(k);
    result.push(k);
  }
  return result;
}

function keywordPreferenceText(keywordPreferences?: Record<string, KeywordPreference>): string {
  if (!keywordPreferences) return '';

  const essential = Object.entries(keywordPreferences)
    .filter(([, pref]) => pref === 'essential')
    .map(([kw]) => kw);
  const ng = Object.entries(keywordPreferences)
    .filter(([, pref]) => pref === 'ng')
    .map(([kw]) => kw);

  const lines: string[] = [];
  if (essential.length > 0) lines.push(`- 必須キーワード: ${essential.join('、')}`);
  if (ng.length > 0) lines.push(`- 使用禁止キーワード: ${ng.join('、')}`);
  return lines.join('\n');
}

export function buildHighQualitySectionPrompt(input: SectionPromptInput): string {
  const keywordList = dedupeKeywords(input.keywords);
  const mainKeywords = keywordList.slice(0, 2);
  const subKeywords = keywordList.slice(2, 5);
  const prefText = keywordPreferenceText(input.keywordPreferences);
  const context = (input.previousContent || '').slice(-700);

  return `
あなたは日本語SEO記事の編集者です。次の1セクション本文だけを作成してください。

記事タイトル: ${input.articleTitle || '未設定'}
全体構成:
${input.totalOutline || '未設定'}

今回のセクション: ${input.sectionTitle}
文体: ${toneInstruction(input.tone)}
目標文字数: ${input.targetChars}字（許容: ±10%）

キーワード要件:
- 主キーワード（優先度高）: ${mainKeywords.length > 0 ? mainKeywords.join('、') : 'なし'}
- 補助キーワード（必要時のみ）: ${subKeywords.length > 0 ? subKeywords.join('、') : 'なし'}
- キーワードは「自然に入る場合のみ」使用し、無理に全て入れない
- 同一キーワードの連呼を避け、このセクション内では同一語句の重複を最小限にする
- キーワードを「」で囲って強調しない
${prefText ? prefText : ''}

執筆ルール:
- 本文のみ出力する（見出し記号 #, ##, ### は出力しない）
- 箇条書きは必要時のみ使用し、乱用しない
- 重複表現や同義反復を避ける
- SEO語句の列挙調を避け、自然な説明文として読める日本語にする
- 2〜4段落を目安に、段落ごとに意味の区切りを作る
- 読者が次のセクションへ進みやすい流れを意識する
- 医療・金融などの断定が危険な領域では、過度な断定を避ける
${input.isLead ? '- 導入セクションとして、課題提起と記事で得られる価値を明示する' : ''}
${input.isLead ? '- 導入文で記事タイトルの文言をそのまま繰り返さない（タイトル引用禁止）' : ''}
${context ? `直前文脈（重複回避用）:\n${context}` : ''}
${input.customInstructions ? `追加指示:\n${input.customInstructions}` : ''}

本文のみを出力してください。`.trim();
}
