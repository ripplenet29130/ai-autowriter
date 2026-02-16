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
    return `
1. **構成ルール（合計4セクション、目標: ${targetWordCount}文字）**
   - リード文（Lead）: 1つ
   - H2見出し: 3つ（導入→本論→まとめの流れ）
   - H3見出しは使用しない（シンプルな構成）

2. **各セクションの推定文字数**
   - リード文: 150文字
   - H2見出し1: 250文字（メインポイント1）
   - H2見出し2: 250文字（メインポイント2）
   - H2見出し3（まとめ）: 200文字
   合計: 約850文字

3. **指示**
   - 短文でも読み応えのある構成を心がけてください
   - 各H2見出しは独立したトピックとして明確に
`;
  }

  if (targetWordCount <= 2500) {
    return `
1. **構成ルール（合計7セクション、目標: ${targetWordCount}文字）**
   - リード文（Lead）: 1つ
   - H2見出し: 4つ（うち最後の1つはまとめ）
   - H3見出し: 2〜3つ（主要なH2の下に配置）

2. **各セクションの推定文字数**
   - リード文: 250文字
   - H2見出し1: 400文字
     └ H3見出し1-1: 200文字
   - H2見出し2: 400文字
     └ H3見出し2-1: 200文字
   - H2見出し3: 350文字
   - まとめ（H2）: 200文字
   合計: 約2000文字

3. **指示**
   - H2とH3を組み合わせて情報に深みを持たせる
   - 主要トピックは2〜3個に絞り、それぞれを掘り下げる
`;
  }

  return `
1. **構成ルール（合計10セクション、目標: ${targetWordCount}文字）**
   - リード文（Lead）: 1つ
   - H2見出し: 4〜5つ（うち最後の1つはまとめ）
   - H3見出し: 5〜7つ（各H2の下に複数配置）

2. **各セクションの推定文字数**
   - リード文: 300文字
   - H2見出し1: 450文字
     └ H3見出し1-1: 250文字
     └ H3見出し1-2: 250文字
   - H2見出し2: 450文字
     └ H3見出し2-1: 250文字
     └ H3見出し2-2: 250文字
   - H2見出し3: 400文字
     └ H3見出し3-1: 200文字
   - まとめ（H2）: 200文字
   合計: 約3000文字

3. **指示**
   - 各主要トピックに複数のH3見出しで詳細に解説
   - 網羅的でSEOに強い長文記事を目指す
   - ユーザーのあらゆる疑問に答える構成
`;
}

export function buildSchedulerOutlinePrompt(input: OutlinePromptInput): string {
  const competitorInsights =
    input.competitorHeadings && input.competitorHeadings.length > 0
      ? `
## 競合記事の分析結果
競合サイトで頻繁に取り上げられている見出し・トピック:
- ${input.competitorHeadings.join('\n- ')}

※ これらのトピックを参考に、読者のニーズに応える構成を作成してください。
`
      : '';

  const structureRules = buildSchedulerStructureRules(input.targetWordCount);

  return `
# 記事アウトライン生成タスク

以下のキーワードを基に、SEO最適化された日本語ブログ記事のアウトライン（見出し構成）を作成してください。

メインキーワード: ${input.keyword}
${input.fixedTitle ? `記事タイトル（必須・変更不可）: ${input.fixedTitle}` : ''}
記事全体の目標文字数: ${input.targetWordCount}文字
${competitorInsights}
${input.customInstructions ? `## カスタム指示\n${input.customInstructions}\n` : ''}

【構成ルール - ターゲット文字数 ${input.targetWordCount}文字 に合わせてください】
${structureRules}
3. 各セクションの「推定文字数」の合計が、目標文字数（${input.targetWordCount}）とほぼ一致するように調整してください。

## 出力フォーマット
以下の形式で必ず出力してください：

タイトル: [記事全体のタイトル]

見出し0 (Lead): リード文
説明: 読者の興味を惹きつける導入部分。
推定文字数: 200

見出し1 (H2): [見出しテキスト]
説明: [セクション内容の簡潔な説明]
推定文字数: 400

...（ターゲット文字数に応じて、適宜セクションを追加してください）
`;
}

export function resolveToneInstruction(writingTone: string): string {
  if (writingTone === 'casual') {
    return 'カジュアルで親しみやすい「です・ます」調で書いてください。固苦しい表現を避け、ブログ読者に語りかけるようなトーンにしてください。';
  }
  if (writingTone === 'technical') {
    return '技術的な内容を正確に伝えるための専門的な文体で書いてください。用語の正確さを重視し、論理的な構成を保ってください。';
  }
  if (writingTone === 'friendly') {
    return '親しみやすい、読者に語りかけるような「です・ます」調で書いてください。共感を誘う表現を多用してください。';
  }
  return '専門性が高く、信頼感のある硬めの文体で書いてください。論理的かつ客観的な表現を用いてください。';
}

export function buildSchedulerSectionPrompt(input: SectionPromptInput): string {
  const toneInstruction = resolveToneInstruction(input.writingTone);
  const isConcise = input.totalEstimatedWordCount < 1500;
  const styleInstruction = isConcise
    ? '**スタイル: 冗長な表現を一切省き、結論から簡潔に述べる「要約・まとめ」のようなスタイルで書いてください。** 余計な肉付けは避けてください。'
    : '**スタイル: プロのWebライターとして、読者の疑問を解決する丁寧で詳細な解説を心がけてください。** 論理的な展開と、具体例を交えた充実した内容にしてください。';

  return `
あなたはSEOに精通したプロのWebライターです。
ブログ記事の以下のセクションのみを執筆してください。

【記事タイトル】
${input.articleTitle}

【今回執筆するセクション】
${input.sectionTitle} (${input.sectionLevel === 2 ? 'H2見出し' : 'H3見出し'})
内容説明: ${input.sectionDescription}

【文体指示】
${toneInstruction}
${styleInstruction}

${input.customInstructions ? `【カスタム指示】\n${input.customInstructions}\n` : ''}

【文脈（直前の内容）】
${input.previousContent.slice(-1000)}

【指示】
- **重要: 指定された見出しの本文テキストのみを出力してください。**
  - 見出し自体（## や ###）は含めないでください。
- 目標文字数: ${input.estimatedWordCount}文字程度
  - ${input.isLead ? 'これはリード文です。読者の期待を高める書き出しにしてください。' : '前の章からの流れを意識して、自然な日本語で書いてください。'}
- 箇条書きや改行を適宜使い、読みやすくしてください。
- 指定された文字数に見合うよう、内容の密度を調整してください。
`;
}
