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
      return '専門性は保ちつつ、読者からの相談に答えるような自然で読みやすい文体で書くこと。堅い報告書調ではなく、実務者がやさしく説明する温度感にすること。';
    case 'casual':
      return '読みやすく親しみやすい文体で、くだけすぎず自然に説明すること。話し言葉に寄せすぎず、読者がすっと理解できる温度感にすること。';
    default:
      return '自然で読みやすい日本語で書くこと。';
  }
}

function naturalStyleInstructions(): string {
  return [
    '- 説明書調や営業文ではなく、読者の疑問に落ち着いて答える文章にすること',
    '- 「〜いたします」「〜させていただきます」「〜となります」「〜と言えるでしょう」を多用しないこと',
    '- 必要に応じて「〜できます」「〜です」「〜を確認しましょう」「〜を選ぶと安心です」のような自然な表現を使うこと',
    '- 専門用語を使う場合は、読者が判断しやすいように短く補足すること',
    '- 1文を長くしすぎず、目安として60文字前後で一度区切ること',
    '- 抽象的な名詞を続けず、「何をすればよいか」「なぜ必要か」が伝わる具体的な動詞で書くこと',
  ].join('\n');
}

// 執筆の中心になる指示（記事改善プラン 1-2）。形（段落数・文の数）ではなく、読者・目的・具体性で指示する
export function buildReaderFocusedWritingGuidance(options: { mainKeyword?: string; isLead?: boolean } = {}): string {
  const reader = options.mainKeyword ? `「${options.mainKeyword}」で検索した人` : 'この記事を検索して読みに来た人';
  return [
    `- 読者は${reader}。その人がこの部分を読み終えたとき、何が分かり、何を判断・実行できるようになるかを決めてから書くこと`,
    '- 読者の疑問に直接答えること。結論・答えを先に書き、理由や条件をその後に書くこと',
    '- 具体例・数字・手順・判断基準・よくある失敗のうち、この部分に合うものを入れること。抽象的な説明だけで終わらせないこと',
    '- 一般論、当たり前の前置き、「重要です」「注意が必要です」だけで終わる文で字数を埋めないこと',
    '- 根拠が示せない数字・料金・制度の断定はしないこと',
    options.isLead
      ? '- 「（2026年4月時点）」のような時点の注記が必要な場合は、ここで1回だけ書くこと'
      : '- 「（2026年4月時点）」のような時点の注記は書かないこと（必要なら記事の冒頭か末尾で1回だけ書く）',
    '- 段落の数や文の数は決めない。内容に合わせて、読みやすい長さで段落を分けること',
  ].join('\n');
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
    '- 定義、原因、手順、比較、判断基準、注意点のどれを説明しているかが分かる流れにすること',
    '- 比較、料金、条件、手順を説明する場合は、必要に応じて表や箇条書きで整理すること',
    '- 断定する情報には、前提条件、例外、注意点を近くに添えること',
    '- FAQに転用できるよう、読者の疑問に対する直接的な回答文を自然に含めること',
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
        '- 冒頭の最初の段落は、検索ユーザーの疑問に対する結論を80〜150文字程度でまとめること',
        '- 冒頭の結論段落は、AI検索がそのまま引用しても意味が通るよう、主語・対象・条件を明確にすること',
        '- 冒頭の結論段落には、一般論だけでなく専門業者・実務者としての判断基準を少し含めること',
        '- テーマに合う場合は、サイズ、材質、使用後の乾燥、保管方法、価格が変わる要因などの具体要素を自然に入れること',
        '- 「結論ボックス」「結論:」などのラベルや装飾は出力しないこと',
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
文字数の目安: ${input.targetChars}文字前後（目安です。内容を削ったり水増ししたりして合わせないこと）

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
- 書く内容は以下を中心にすること
${buildReaderFocusedWritingGuidance({ mainKeyword: mainKeywords[0], isLead: input.isLead })}
- 文体は以下を守ること
${naturalStyleInstructions()}
- AIO・AI検索向けに、以下を守ること
${aioWritingInstructions()}
${sectionRoleInstruction}

${context ? `直前までの本文:\n${context}\n` : ''}
${input.customInstructions ? `追加指示:\n${input.customInstructions}\n` : ''}

出力は今回のセクション本文のみとしてください。
`.trim();
}
