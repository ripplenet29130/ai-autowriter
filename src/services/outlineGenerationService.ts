import { v4 as uuidv4 } from 'uuid';
import {
    ArticleOutline,
    OutlineSection,
    OutlineGenerationRequest,
    TrendAnalysisResult
} from '../types';
import { aiService } from './aiService';

/**
 * アウトライン（見出し構成）生成サービス
 * トレンドデータと競合分析を基にAIで最適な記事構成を生成
 */
export class OutlineGenerationService {
    /**
     * AIを使ってアウトラインを生成
     */
    async generateOutline(request: OutlineGenerationRequest): Promise<ArticleOutline> {
        try {
            console.log('アウトライン生成開始:', request.keywords);

            // AIに送信するプロンプトを構築
            const prompt = this.buildOutlinePrompt(request);

            // AI設定を読み込み（既存のaiServiceを活用）
            await aiService.loadActiveConfig();

            // AIを呼び出してアウトライン生成
            const outlineText = await this.callAIForOutline(prompt);

            // AIの出力をパースしてOutline構造に変換
            const sections = this.parseOutlineText(outlineText, request);

            // タイトルを生成
            const title = this.generateTitle(request);

            // キーワードが空の場合はタイトルから推測するかデフォルト値を使用
            const mainKeyword = request.keywords.length > 0
                ? request.keywords[0]
                : (request.selectedTitle || '記事');

            const outline: ArticleOutline = {
                id: uuidv4(),
                title,
                keyword: mainKeyword,
                sections,
                trendData: request.trendData,
                estimatedWordCount: this.calculateTotalWordCount(sections),
                createdAt: new Date()
            };

            console.log('アウトライン生成完了:', outline);
            return outline;
        } catch (error) {
            console.error('アウトライン生成エラー:', error);
            throw error;
        }
    }

    /**
     * アウトライン生成用のプロンプトを構築
     */
    private buildOutlinePrompt(request: OutlineGenerationRequest): string {
        const { keywords, trendData, targetLength, tone, focusTopics, selectedTitle, keywordPreferences } = request;

        // メインキーワードの決定（キーワードがない場合はタイトルを使用）
        const mainKeyword = keywords.length > 0 ? keywords[0] : (selectedTitle || '指定テーマ');
        // 関連キーワード（キーワードがない場合は空）
        const relatedKeywordsStr = keywords.length > 1 ? keywords.slice(1).join(', ') : 'なし';

        // 文字数の目安（targetWordCountが指定されていればそれを優先）
        const targetWordCount = request.targetWordCount;
        const lengthGuide = targetWordCount
            ? `合計 ${targetWordCount}文字（厳守）`
            : {
                short: '約1,000〜2,000字（見出し: 3-5個）',
                medium: '約2,000〜4,000字（見出し: 5-7個）',
                long: '約4,000〜6,000字（見出し: 7-10個）'
            }[targetLength];

        // トーンの説明
        const toneDescription = {
            professional: '専門的でフォーマル',
            casual: '親しみやすくカジュアル',
            technical: '技術的で正確',
            friendly: 'フレンドリーで読みやすい'
        };

        const prompt = `
# 記事アウトライン生成タスク

以下の情報を基に、SEO最適化された記事のアウトライン（見出し構成）を作成してください。

## キーワード情報
メインキーワード: ${mainKeyword}
関連キーワード: ${relatedKeywordsStr}

${keywordPreferences ? `
## ユーザーによるキーワード指定 (重要)
${Object.entries(keywordPreferences).filter(([_, pref]) => pref === 'essential').map(([kw]) => `- 【必須】絶対に使用する: ${kw}`).join('\n')}
${Object.entries(keywordPreferences).filter(([_, pref]) => pref === 'ng').map(([kw]) => `- 【NG】絶対に使用しない: ${kw}`).join('\n')}

上記の指定を厳守してアウトラインを作成してください。特に【NG】ワードは見出しにも説明にも一切含めないでください。
` : ''}

## トレンドデータ
- 検索ボリューム: ${trendData.searchVolume.toLocaleString()}/月
- SEO難易度: ${trendData.seoData.difficulty}/100
- 競合度: ${trendData.competition}
- 関連キーワード (SEO強化): ${trendData.relatedKeywords.join(', ')}
- 話題のトピック: ${trendData.hotTopics.join(', ')}
- ユーザーの関心: ${trendData.userInterest.risingQueries.join(', ')}

## 競合分析
- 上位記事の平均文字数: ${trendData.competitorAnalysis.averageLength.toLocaleString()}字
- よく扱われるトピック: ${trendData.competitorAnalysis.commonTopics.join(', ')}

## 記事要件
- 目標文字数: ${lengthGuide}
${targetWordCount ? (targetWordCount <= 1500 ? `
**【重要：構成の厳格な指定】**
文字数が少ないため、記事の品質を保つために以下のシンプルな構成を **厳守** してください：
1. **リード文**: 1つ (約200文字)
2. **見出し (H2)**: **ちょうど2つ** (3つ以上は禁止)
3. **合計セクション数**: 3つ (リード + H2×2)

これ以上の見出しを作ると1つあたりの内容が薄くなるため、見出しは「2つ」だけ作成し、残りの文字数を配分してください。
` : `
**【重要】合計文字数を${targetWordCount}文字に厳密に収めてください。各見出しの推定文字数の合計が${targetWordCount}文字になるように配分してください。**
`) : ''}
- トーン: ${toneDescription[tone]}
${focusTopics ? `- 重点トピック: ${focusTopics.join(', ')}` : ''}
${request.selectedTitle ? `
## 決定された記事タイトル (重要)
タイトル: "${request.selectedTitle}"

※ このタイトルに沿った構成のみを作成してください。他のタイトル案やアイデアは一切無視してください。
` : ''}

${request.customInstructions ? `
## カスタム指示 (最優先)
${request.customInstructions}
` : ''}

## 指示

1. **タイトル** (H1相当)
   - 上記の「決定された記事タイトル」をそのまま使用してください。
   - (指定がない場合のみ、SEOを意識したメインタイトルを提案してください)

2. **見出し構成** (H2, H3)
   - ユーザーの検索意図に応える構成にすること
   - 競合記事にない独自の視点を含めること
   - 論理的な流れを意識すること
   - 各見出しにキーワードを適切に配置すること

## 出力フォーマット

以下の形式で出力してください：

\`\`\`
タイトル: [記事のメインタイトル]

見出し0 (Lead): リード文
説明: 読者の興味を惹きつける導入部分。問題提起や記事の結論を簡潔に示す。
推定文字数: [200-400]

見出し1 (H2): [見出しテキスト]
説明: [このセクションで扱う内容の簡潔な説明]
推定文字数: [300-500]

見出し2 (H2): [見出しテキスト]
説明: [このセクションで扱う内容の簡潔な説明]
推定文字数: [400-600]

  見出し2-1 (H3): [サブ見出しテキスト]
  説明: [このサブセクションで扱う内容]
  推定文字数: [200-300]

...（続く）
\`\`\`

重要: 必ずこの形式で出力してください。
`;

        return prompt;
    }

    /**
     * AIを呼び出してアウトラインを生成
     */
    private async callAIForOutline(prompt: string): Promise<string> {
        try {
            // AI設定がロードされていなければロードする
            if (!aiService.getActiveConfig()) {
                await aiService.loadActiveConfig();
            }

            const config = aiService.getActiveConfig();

            if (!config || !config.apiKey) {
                throw new Error('AI設定またはAPIキーが見つかりません。設定画面で設定してください。');
            }

            console.log(`AIプロバイダ: ${config.provider} で要求を送信中...`);

            // OpenAIの場合
            if (config.provider === 'openai') {
                const response = await fetch("https://api.openai.com/v1/chat/completions", {
                    method: "POST",
                    headers: {
                        "Content-Type": "application/json",
                        Authorization: `Bearer ${config.apiKey}`,
                    },
                    body: JSON.stringify({
                        model: config.model || "gpt-3.5-turbo",
                        temperature: 0.7,
                        max_tokens: config.maxTokens || 2000,
                        messages: [
                            { role: "system", content: "You are a professional SEO content writer. Output must be in Japanese." },
                            { role: "user", content: prompt },
                        ],
                    }),
                });

                if (!response.ok) {
                    const errorData = await response.json().catch(() => ({}));
                    if (response.status === 429) {
                        throw new Error("RATE_LIMIT_ERROR: OpenAI APIの利用制限に達しました。しばらく待ってから再度お試しください。");
                    }
                    if (response.status === 401) {
                        throw new Error("AUTH_ERROR: APIキーが無効です。設定を確認してください。");
                    }
                    throw new Error(`OpenAI APIエラー: ${response.status} - ${errorData.error?.message || ''}`);
                }

                const data = await response.json();
                return data.choices?.[0]?.message?.content || "";
            }

            // Geminiの場合
            if (config.provider === 'gemini') {
                // Google Generative AI APIを直接呼び出す (v1beta)
                const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${config.model || 'gemini-3.0-flash'}:generateContent?key=${config.apiKey}`;

                const response = await fetch(apiUrl, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        contents: [{
                            parts: [{ text: prompt }]
                        }],
                        generationConfig: {
                            temperature: 0.7,
                            maxOutputTokens: config.maxTokens || 2048,
                        }
                    }),
                });

                if (!response.ok) {
                    const errorData = await response.json().catch(() => ({}));
                    if (response.status === 429) {
                        throw new Error("RATE_LIMIT_ERROR: Gemini APIの利用制限に達しました。しばらく待ってから再度お試しください。");
                    }
                    if (response.status === 400 || response.status === 401) {
                        throw new Error("AUTH_ERROR: APIキーが無効であるか、モデル名が正しくありません。設定を確認してください。");
                    }
                    throw new Error(`Gemini APIエラー: ${response.status} - ${errorData.error?.message || ''}`);
                }

                const data = await response.json();
                return data.candidates?.[0]?.content?.parts?.[0]?.text || '';
            }

            // Claudeの場合
            if (config.provider === 'claude') {
                const response = await fetch("https://api.anthropic.com/v1/messages", {
                    method: "POST",
                    headers: {
                        "Content-Type": "application/json",
                        "x-api-key": config.apiKey,
                        "anthropic-version": "2023-06-01",
                        "anthropic-dangerous-direct-browser-access": "true" // フロントエンドからの直接呼び出し許可（開発用）
                    },
                    body: JSON.stringify({
                        model: config.model || "claude-3-opus-20240229",
                        temperature: 0.7,
                        max_tokens: config.maxTokens || 2000,
                        messages: [{ role: "user", content: prompt }],
                    }),
                });

                if (!response.ok) {
                    const errorData = await response.json().catch(() => ({}));
                    if (response.status === 429) {
                        throw new Error("RATE_LIMIT_ERROR: Claude APIの利用制限に達しました。しばらく待ってから再度お試しください。");
                    }
                    if (response.status === 401 || response.status === 403) {
                        throw new Error("AUTH_ERROR: APIキーが無効です。設定を確認してください。");
                    }
                    throw new Error(`Claude APIエラー: ${response.status} - ${JSON.stringify(errorData)}`);
                }

                const data = await response.json();
                return data.content?.[0]?.text || "";
            }

            throw new Error(`未対応のプロバイダ: ${config.provider}`);
        } catch (error) {
            console.error('AI呼び出しエラー:', error);
            throw error;
        }
    }

    /**
     * AIの出力テキストをパースしてOutlineSection配列に変換
     */
    private parseOutlineText(text: string, request: OutlineGenerationRequest): OutlineSection[] {
        const sections: OutlineSection[] = [];
        const lines = text.split('\n');

        let currentOrder = 0;

        for (let i = 0; i < lines.length; i++) {
            const line = lines[i].trim();

            // 見出しを検出
            const leadMatch = line.match(/^見出し0\s*\(Lead\):\s*(.+)$/);
            const h2Match = line.match(/^見出し\d+\s*\(H2\):\s*(.+)$/);
            const h3Match = line.match(/^\s*見出し[\d-]+\s*\(H3\):\s*(.+)$/);

            if (leadMatch || h2Match || h3Match) {
                const title = leadMatch ? leadMatch[1] : (h2Match ? h2Match[1] : h3Match![1]);
                const level = leadMatch ? 2 : (h2Match ? 2 : 3);
                const isLead = !!leadMatch;

                // 次の行から説明と推定文字数を取得
                let description = '';
                let estimatedWordCount = 300;

                for (let j = i + 1; j < lines.length; j++) {
                    const nextLine = lines[j].trim();

                    if (nextLine.startsWith('説明:')) {
                        description = nextLine.replace('説明:', '').trim();
                    } else if (nextLine.startsWith('推定文字数:')) {
                        const match = nextLine.match(/\d+/);
                        if (match) {
                            estimatedWordCount = parseInt(match[0], 10);
                        }
                    } else if (nextLine.startsWith('見出し')) {
                        break;
                    }
                }

                sections.push({
                    id: uuidv4(),
                    title,
                    level: level as 2 | 3,
                    description,
                    estimatedWordCount,
                    order: currentOrder++,
                    isGenerated: false,
                    isLead
                });
            }
        }

        // パースに失敗した場合はフォールバック
        if (sections.length === 0) {
            return this.createFallbackOutline(request);
        }

        // targetWordCountが指定されている場合、各セクションの文字数を再計算
        if (request.targetWordCount && sections.length > 0) {
            const perSectionTarget = Math.floor(request.targetWordCount / sections.length);
            sections.forEach(section => {
                section.estimatedWordCount = perSectionTarget;
            });
            console.log(`📊 文字数を再配分: 合計${request.targetWordCount}文字 ÷ ${sections.length}セクション = 各${perSectionTarget}文字`);
        }

        return sections;
    }

    /**
     * パースに失敗した場合のフォールバック
     */
    private createFallbackOutline(request: OutlineGenerationRequest): OutlineSection[] {
        const { keywords, targetLength, selectedTitle } = request;
        const mainKeyword = keywords.length > 0 ? keywords[0] : (selectedTitle || '記事');

        const sections: OutlineSection[] = [
            {
                id: uuidv4(),
                title: 'リード文',
                level: 2,
                description: '記事の導入文',
                estimatedWordCount: 300,
                order: -1,
                isGenerated: false,
                isLead: true
            },
            {
                id: uuidv4(),
                title: `${mainKeyword}とは`,
                level: 2,
                description: '基本的な定義と概要',
                estimatedWordCount: 400,
                order: 0,
                isGenerated: false
            },
            {
                id: uuidv4(),
                title: `${mainKeyword}の特徴`,
                level: 2,
                description: '主な特徴やメリット',
                estimatedWordCount: 500,
                order: 1,
                isGenerated: false
            },
            {
                id: uuidv4(),
                title: `${mainKeyword}の活用方法`,
                level: 2,
                description: '実践的な使い方',
                estimatedWordCount: 600,
                order: 2,
                isGenerated: false
            },
            {
                id: uuidv4(),
                title: 'まとめ',
                level: 2,
                description: '記事のまとめと次のステップ',
                estimatedWordCount: 300,
                order: 3,
                isGenerated: false
            }
        ];

        return targetLength === 'long' ? sections : sections.slice(0, 3);
    }

    /**
     * タイトルを生成（AIの出力から抽出 or フォールバック）
     */
    private generateTitle(request: OutlineGenerationRequest): string {
        const { keywords, selectedTitle } = request;

        if (selectedTitle) {
            return selectedTitle;
        }

        const mainKeyword = keywords.length > 0 ? keywords[0] : '記事';
        // 簡易的なタイトル生成（後でAIの出力から抽出可能）
        return `${mainKeyword}完全ガイド：最新情報と実践的な活用法`;
    }

    /**
     * 総文字数を計算
     */
    private calculateTotalWordCount(sections: OutlineSection[]): number {
        return sections.reduce((total, section) => total + section.estimatedWordCount, 0);
    }
}

export const outlineGenerationService = new OutlineGenerationService();
