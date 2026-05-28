type Tone = 'professional' | 'casual';
type KeywordPreference = 'default' | 'ng' | 'essential';

interface SectionPromptInput {
  articleTitle?: string;
  totalOutline?: string;
  sectionTitle: string;
  sectionLevel?: number;
  childHeadings?: string[];
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
      return '丁寧で信頼感のある実務的な文体で書くこと。';
    case 'casual':
      return '読みやすく親しみやすい文体で書くこと。';
    default:
      return '自然で読みやすい日本語で書くこと。';
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
  if (essential.length > 0) lines.push(`- 必ず自然に含めるキーワード: ${essential.join('、')}`);
  if (ng.length > 0) lines.push(`- 使用禁止キーワード: ${ng.join('、')}`);
  return lines.join('\n');
}

function aioWritingInstructions(): string {
  return [
    '- セクション冒頭で、この見出しに対する答え・要点を1〜2文で先に示すこと',
    '- 定義、原因、手順、比較、判断基準、注意点のどれを説明しているかが読者に分かる流れにすること',
    '- 手順や条件を説明する場合は、順番・前提・判断基準を明確にすること',
    '- 比較を説明する場合は、比較軸、違い、向いているケース、注意点を分けて説明すること',
    '- FAQに転用できるよう、読者の疑問に対する直接的な回答文を自然に含めること',
    '- AI要約で抜き出されても意味が通るよう、代名詞だけに頼らず主語と対象を明確にすること',
  ].join('\n');
}

export function buildHighQualitySectionPrompt(input: SectionPromptInput): string {
  const keywordList = dedupeKeywords(input.keywords);
  const mainKeywords = keywordList.slice(0, 2);
  const subKeywords = keywordList.slice(2, 5);
  const prefText = keywordPreferenceText(input.keywordPreferences);
  const context = String(input.previousContent || '').trim();
  const sectionLevel = input.sectionLevel || 2;
  const childHeadings = (input.childHeadings || [])
    .map((heading) => String(heading || '').trim())
    .filter(Boolean);
  const sectionRoleInstruction = (() => {
    if (input.isLead) {
      return [
        '- リード文として、記事全体の導入になる内容にすること',
        '- リード文では記事タイトルをそのまま繰り返し見出し化しないこと',
      ].join('\n');
    }
    if (sectionLevel === 2 && childHeadings.length > 0) {
      return [
        `- このH2には後続のH3があります: ${childHeadings.join('、')}`,
        '- このH2本文では章全体の導入と要点整理に留め、H3で扱う詳細を先取りしすぎないこと',
        '- H3の見出し名を本文中で不自然に列挙しないこと',
      ].join('\n');
    }
    if (sectionLevel >= 3) {
      return '- このH3本文では、親H2の中の具体論としてテーマを絞って説明すること';
    }
    return '- このH2本文では、見出しテーマに対する要点を過不足なく説明すること';
  })();

  return `
あなたは日本語SEO記事の執筆者です。次の1セクションだけを執筆してください。

記事タイトル: ${input.articleTitle || '未設定'}
全体アウトライン:
${input.totalOutline || '未設定'}

今回のセクション: ${input.sectionTitle} (${sectionLevel === 2 ? 'H2' : 'H3'})
文体: ${toneInstruction(input.tone)}
目標文字数: ${input.targetChars}文字前後

キーワード方針:
- 主キーワード: ${mainKeywords.length > 0 ? mainKeywords.join('、') : 'なし'}
- 補助キーワード: ${subKeywords.length > 0 ? subKeywords.join('、') : 'なし'}
${prefText || ''}

厳守事項:
- 提供されたアウトラインに記載された見出し（H2/H3/H4）はすべて使用対象とみなし、省略・統合・新規追加をしないこと
- 見出し順序はアウトライン通りに維持すること
- 今回は「${input.sectionTitle}」の本文だけを書くこと
- 見出し記号（#, ##, ###）は出力しないこと
- 箇条書きは必要な場合だけ使い、乱用しないこと
- 他セクションの内容を重複させないこと
- 情報が不確かな場合は断定しすぎないこと
- 自然な日本語で、具体性のある本文にすること
- AIO・AI検索向けに、以下を守ること
${aioWritingInstructions()}
${sectionRoleInstruction}

${context ? `直前までの本文:\n${context}\n` : ''}
${input.customInstructions ? `追加指示:\n${input.customInstructions}\n` : ''}

出力は今回のセクション本文のみとしてください。
`.trim();
}
