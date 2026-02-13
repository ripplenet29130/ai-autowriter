import { AIConfig, GenerationPrompt } from "../types";
import { supabase } from "./supabaseClient";
import { imageGenerationService } from "./imageGenerationService";

/**
 * AI関連サービス
 * Supabaseのai_configsテーブルに保存された設定を元に、
 * Gemini / OpenAI / Claude などを動的に呼び出します。
 */
export class AIService {
  private config: AIConfig | null = null;

  constructor() { }

  // === 最新のAI設定をSupabaseから取得 ===
  public async loadActiveConfig() {
    try {
      if (!supabase) throw new Error("Supabase client is not initialized");

      const { data, error } = await supabase
        .from("ai_configs")
        .select("*")
        .order("is_active", { ascending: false })
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (error) {
        console.error("❌ AI設定の取得に失敗:", error.message);
        throw new Error("AI設定の取得に失敗しました");
      }

      if (!data) {
        throw new Error("有効なAI設定が見つかりません。AI設定ページで登録してください。");
      }

      // ✅ Supabaseのカラムを内部形式に変換
      this.config = {
        id: data.id,
        provider: data.provider,
        apiKey: data.api_key,
        model: this.validateModelName(data.provider, data.model),
        temperature: data.temperature ?? 0.7,
        maxTokens: data.max_tokens ?? 16384,
        imageGenerationEnabled: data.image_enabled ?? false,
        imageProvider: data.image_provider,
      };

      console.log("✅ AI設定をロードしました:", this.config);
    } catch (err) {
      console.error("AI設定ロード時エラー:", err);
      throw err;
    }
  }

  // モデル名のバリデーション（旧モデル名のフォールバック）
  private validateModelName(provider: string, model: string): string {
    if (provider !== 'gemini') return model;

    // 無効なGeminiモデル名を検知して置換
    // gemini-1.5系などは非推奨（2.0以上を推奨）
    const invalidModels = ['gemini-1.0-pro', 'gemini-1.5-pro-latest'];
    if (invalidModels.includes(model)) {
      console.warn(`⚠️ 非推奨のモデル名(${model})を検知しました。gemini-2.0-flashにフォールバックします。`);
      return 'gemini-2.0-flash';
    }

    return model;
  }

  // 設定を取得するためのゲッター
  public getActiveConfig(): AIConfig | null {
    return this.config;
  }

  /**
   * 独自のプロンプトを指定してJSON形式で結果を取得する
   */
  async generateCustomJson(promptText: string): Promise<any> {
    try {
      if (!this.config) await this.loadActiveConfig();

      const jsonPrompt = `
${promptText}

重要: 必ず有効なJSONフォーマットのみを出力してください。Markdownのコードブロック（\`\`\`json ... \`\`\`）は不要です。テキストによる説明も不要です。JSONオブジェクトまたは配列のみを返してください。
`;

      let text = "";
      switch (this.config?.provider) {
        case "openai":
          text = await this.callRawOpenAI(jsonPrompt);
          break;
        case "gemini":
          text = await this.callRawGemini(jsonPrompt);
          break;
        case "claude":
          text = await this.callRawClaude(jsonPrompt);
          break;
        default:
          throw new Error("AI provider not configured for custom JSON");
      }

      // Markdownのコードブロックを除去
      const cleaned = text.replace(/```json\n?|```/g, "").trim();

      try {
        return JSON.parse(cleaned);
      } catch (parseError) {
        console.error("JSON分析エラー:", cleaned);
        // 部分的に壊れている場合に備えて、正規表現で配列/オブジェクトを探す
        const match = cleaned.match(/\[[\s\S]*\]|\{[\s\S]*\}/);
        if (match) {
          return JSON.parse(match[0]);
        }
        throw parseError;
      }
    } catch (error) {
      console.error("Custom JSON生成エラー:", error);
      throw error;
    }
  }

  /**
   * キーワードに基づいて、関連するサジェストキーワードを生成する
   */
  async generateRelatedKeywords(keyword: string): Promise<string[]> {
    try {
      if (!this.config) await this.loadActiveConfig();

      const prompt = `
以下のキーワードに関連する、検索ボリュームが大きく、ユーザーが次に検索しそうなサブキーワードを10個挙げてください。
キーワード: ${keyword}

JSON形式の配列（文字列の配列）で出力してください。
例: ["キーワード1", "キーワード2", ...]
`;
      const result = await this.generateCustomJson(prompt);
      if (Array.isArray(result)) {
        return result.slice(0, 10);
      }
      return [];
    } catch (error) {
      console.error("関連キーワード生成エラー:", error);
      return [];
    }
  }

  // === 記事生成（メイン処理） ===
  async generateArticle(prompt: GenerationPrompt) {
    try {
      // 設定ロード（未ロードなら実行）
      if (!this.config) await this.loadActiveConfig();

      // 必須項目チェック
      if (!this.config?.provider) throw new Error("AIプロバイダが設定されていません。");
      if (!this.config?.apiKey) throw new Error("APIキーが設定されていません。");
      if (!this.config?.model) throw new Error("モデルが設定されていません。");

      // 初回生成
      console.log('📝 記事生成開始:', { topic: prompt.topic, length: prompt.length });
      let result;
      switch (this.config.provider) {
        case "openai":
          result = await this.callOpenAI(prompt);
          break;
        case "gemini":
          result = await this.callGemini(prompt);
          break;
        case "claude":
          result = await this.callClaude(prompt);
          break;
        default:
          throw new Error(`未対応のAIプロバイダです: ${this.config.provider}`);
      }

      let { title, content } = result;

      // 文字数チェック（要約は無効化）
      const targetWordCount = prompt.targetWordCount || this.getTargetWordCount(prompt.length);
      const actualWordCount = this.countWords(content);
      const minAllowed = Math.floor(targetWordCount * 0.9);
      const maxAllowed = Math.ceil(targetWordCount * 1.1);

      console.log('📊 文字数チェック:', {
        target: targetWordCount,
        actual: actualWordCount
      });

      if (actualWordCount < minAllowed) {
        console.log('➕ 文字数不足のため追記補完を実行します...', {
          actual: actualWordCount,
          minAllowed
        });

        content = await this.extendToMinimumLength(content, prompt, minAllowed, maxAllowed);

        const supplementedCount = this.countWords(content);
        console.log('✅ 追記補完完了:', {
          before: actualWordCount,
          after: supplementedCount
        });
      }

      // 要約処理は無効化（AIに正確な文字数で生成させる）
      // if (actualWordCount > maxAllowed) {
      //   console.log('✂️ 文字数超過のため要約を実行します...');
      //   content = await this.summarizeToWordCount(
      //     content,
      //     title,
      //     targetWordCount,
      //     prompt.keywords || []
      //   );
      //   const newWordCount = this.countWords(content);
      //   console.log('✅ 要約完了:', { before: actualWordCount, after: newWordCount });
      // }

      const excerpt = this.generateExcerpt(content);
      const keywords = this.extractKeywords(content, prompt.topic);
      const seoScore = this.calculateSEOScore(title, content, keywords);
      const readingTime = this.calculateReadingTime(content);

      // 画像生成が有効な場合、記事に画像を挿入
      // プロンプトで指定された枚数を優先、なければ設定値を使用
      const imageCount = prompt.imagesPerArticle !== undefined
        ? prompt.imagesPerArticle
        : (this.config.imagesPerArticle || 0);

      if (this.config.imageGenerationEnabled &&
        this.config.imageProvider === 'nanobanana' &&
        imageCount > 0) {
        console.log('🖼️ 画像生成を開始します...', {
          count: imageCount,
          provider: this.config.imageProvider
        });

        try {
          content = await this.insertGeneratedImages(
            content,
            title,
            keywords,
            imageCount
          );
          console.log('✅ 画像生成・挿入完了');
        } catch (error: any) {
          console.error('⚠️ 画像生成エラー:', error);
          // エラー内容を記事の末尾に追記（デバッグ用）
          content += `\n\n> [!WARNING]\n> **画像生成エラーが発生しました**\n> ${error.message || '不明なエラー'}\n> 設定やAPIキーを確認してください。`;
        }
      }

      return { title, content, excerpt, keywords, seoScore, readingTime };
    } catch (error) {
      console.error("記事生成エラー:", error);
      throw error;
    }
  }

  // === 文字数カウント ===
  private countWords(content: string): number {
    // Markdown記号を除外して文字数をカウント
    const cleaned = content
      .replace(/^#+\s+/gm, '') // 見出し記号
      .replace(/\*\*/g, '')     // 太字
      .replace(/\*/g, '')       // イタリック
      .replace(/^[-*]\s+/gm, '') // リスト記号
      .replace(/\n+/g, '\n')    // 連続改行を1つに
      .trim();
    return cleaned.length;
  }

  // === 目標文字数の取得 ===
  private getTargetWordCount(length?: 'short' | 'medium' | 'long'): number {
    switch (length) {
      case 'short':
        return 1000;
      case 'medium':
        return 2000;
      case 'long':
        return 4000;
      default:
        return 2000;
    }
  }

  // === 指定文字数への要約 ===
  private async summarizeToWordCount(
    originalContent: string,
    title: string,
    targetWordCount: number,
    keywords: string[]
  ): Promise<string> {
    const summaryPrompt = `
以下の記事を、正確に${targetWordCount}文字にまとめ直してください。

【元の記事タイトル】
${title}

【元の記事内容】
${originalContent}

【要約の条件】
1. **文字数**: 正確に${targetWordCount}文字（±10%以内厳守）
2. **キーワード維持**: 以下のキーワードを必ず自然な形で含める
   ${keywords.length > 0 ? keywords.join('、') : '（指定なし）'}
3. **構成維持**: 元の見出し構造（##）を可能な限り保持
4. **情報密度**: 冗長な表現を削り、重要な情報のみを残す
5. **自然な文章**: 途中で切れることなく、完結した文章にする

【出力形式】
- Markdown形式で出力
- 見出しには ## を使用
- タイトル行は出力しない（本文のみ）
- 「本文:」などの接頭辞は禁止
`;

    try {
      let summarizedText = '';
      switch (this.config?.provider) {
        case 'openai':
          summarizedText = await this.callRawOpenAI(summaryPrompt);
          break;
        case 'gemini':
          summarizedText = await this.callRawGemini(summaryPrompt);
          break;
        case 'claude':
          summarizedText = await this.callRawClaude(summaryPrompt);
          break;
        default:
          throw new Error('AI provider not configured');
      }

      return summarizedText.trim();
    } catch (error) {
      console.error('要約エラー:', error);
      // 要約に失敗した場合は、段落単位で切り詰める
      return this.truncateByParagraph(originalContent, targetWordCount);
    }
  }

  // === 段落単位での切り詰め（フォールバック） ===
  private truncateByParagraph(content: string, targetWordCount: number): string {
    const paragraphs = content.split('\n\n');
    let result = '';
    let currentCount = 0;

    for (const paragraph of paragraphs) {
      const paragraphLength = this.countWords(paragraph);
      if (currentCount + paragraphLength <= targetWordCount * 1.05) {
        result += paragraph + '\n\n';
        currentCount += paragraphLength;
      } else {
        break;
      }
    }

    return result.trim();
  }

  // === 不足文字数の追記補完 ===
  private async extendToMinimumLength(
    originalContent: string,
    prompt: GenerationPrompt,
    minAllowed: number,
    maxAllowed: number
  ): Promise<string> {
    try {
      let merged = originalContent.trim();
      let currentCount = this.countWords(merged);

      if (currentCount >= minAllowed) return merged;

      const remaining = minAllowed - currentCount;
      const isSection = prompt.generationType === 'section';
      const summarySplit = !isSection ? this.splitFinalSummarySection(merged) : null;
      const baseContent = summarySplit?.hasSummary ? summarySplit.body : merged;
      const supplementPrompt = `
以下の既存本文はそのまま維持し、末尾に自然につながる追記だけを作成してください。

【現在の文字数】
${currentCount}文字

【必須要件】
1. 追記後の合計を最低${minAllowed}文字以上にする
2. 追記後の合計は${maxAllowed}文字を超えない
3. 既存本文は書き換えない
4. 出力は「追記本文のみ」（タイトル、注釈、説明文は禁止）
5. 文末は必ず句点（。）で完結させる
6. 「まとめ」「結論」「おわりに」「最後に」「総括」など締めくくりの見出し・文言は絶対に書かない
7. 要約調・結論調の締め文（例: 「以上のように」「〜といえるでしょう」）で終えない
${isSection ? '8. 見出し（#, ##, ###）は一切出力しない' : '8. 既存のMarkdown構成に自然になじむ内容にする'}
${summarySplit?.hasSummary ? '9. この追記は、既存記事にある最後の「まとめ」見出しより前に入る本文として作成する' : ''}
${prompt.keywords?.length ? `10. 次のキーワードを不自然にならない範囲で含める: ${prompt.keywords.join('、')}` : ''}
${!isSection ? '11. 追記は既存記事と同じくMarkdown見出しタグを使う（大項目は`##`、必要なら小項目は`###`）' : ''}

【不足の目安】
あと約${remaining}文字（不足分を埋める量を目安）

【記事タイトル】
${prompt.articleTitle || prompt.selectedTitle || prompt.topic || ''}

【今回のセクション】
${prompt.sectionTitle || prompt.topic || ''}

【既存本文】
${baseContent}
`;

      let addition = '';
      switch (this.config?.provider) {
        case 'openai':
          addition = await this.callRawOpenAI(supplementPrompt);
          break;
        case 'gemini':
          addition = await this.callRawGemini(supplementPrompt);
          break;
        case 'claude':
          addition = await this.callRawClaude(supplementPrompt);
          break;
        default:
          return merged;
      }

      const cleanAddition = this.normalizeSupplementRawText(addition, isSection);

      const sanitizedAddition = this.sanitizeSupplementText(cleanAddition);
      if (!sanitizedAddition) return merged;

      if (summarySplit?.hasSummary) {
        merged = `${summarySplit.body}\n\n${sanitizedAddition}\n\n${summarySplit.summary}`.trim();
      } else {
        merged = `${merged}\n\n${sanitizedAddition}`.trim();
      }

      if (this.countWords(merged) > maxAllowed) {
        return this.truncateByParagraph(merged, maxAllowed);
      }

      return merged;
    } catch (error) {
      console.error('追記補完エラー:', error);
      return originalContent;
    }
  }

  // === 記事末尾の「まとめ」セクションを分離 ===
  private splitFinalSummarySection(content: string): { hasSummary: boolean; body: string; summary: string } {
    const headingRegex = /^##+\s*(まとめ|結論|おわりに|最後に|総括)[^\n]*$/gim;
    let lastMatch: RegExpExecArray | null = null;
    let match: RegExpExecArray | null;

    while ((match = headingRegex.exec(content)) !== null) {
      lastMatch = match;
    }

    if (!lastMatch) {
      return { hasSummary: false, body: content.trim(), summary: '' };
    }

    const splitIndex = lastMatch.index;
    const body = content.slice(0, splitIndex).trimEnd();
    const summary = content.slice(splitIndex).trimStart();

    return { hasSummary: true, body, summary };
  }

  // === 追記文から「まとめ」系の文言を除去 ===
  private sanitizeSupplementText(addition: string): string {
    const paragraphs = addition
      .split(/\n{2,}/)
      .map(p => p.trim())
      .filter(Boolean);

    const filtered = paragraphs.filter(p => {
      const normalized = p.replace(/\s+/g, '');
      if (/^#{1,6}(まとめ|結論|おわりに|最後に|総括)/i.test(p)) return false;
      if (/^(まとめ|結論|おわりに|最後に|総括)/.test(normalized)) return false;
      if (/^(以上のように|以上より|以上から|要するに|まとめると)/.test(normalized)) return false;
      return true;
    });

    return filtered.join('\n\n').trim();
  }

  // === 追記の生テキスト正規化 ===
  private normalizeSupplementRawText(raw: string, isSection: boolean): string {
    let cleaned = raw.replace(/```[\s\S]*?```/g, '').trim();

    if (isSection) {
      cleaned = cleaned.replace(/^#+\s+/gm, '');
    }

    cleaned = cleaned.replace(/^##+\s*(まとめ|結論|おわりに|最後に|総括)[^\n]*$/gim, '').trim();
    return cleaned;
  }

  // === 画像生成・挿入 ===
  /**
   * 記事内の見出しに画像を生成して挿入
   */
  private async insertGeneratedImages(
    content: string,
    title: string,
    keywords: string[],
    imageCount: number
  ): Promise<string> {
    // 見出し（##）を抽出
    const headingRegex = /^##\s+(.+)$/gm;
    const headings: { text: string; index: number }[] = [];
    let match;

    while ((match = headingRegex.exec(content)) !== null) {
      headings.push({
        text: match[1],
        index: match.index + match[0].length
      });
    }

    if (headings.length === 0) {
      console.log('見出しが見つからないため、画像挿入をスキップします');
      return content;
    }

    // 画像を挿入する見出しを選択（均等に分散）
    const selectedHeadings = this.selectHeadingsForImages(headings, imageCount);
    console.log(`${selectedHeadings.length}個の見出しに画像を挿入します`);

    // 各見出しに画像を生成・挿入
    let processedContent = content;
    let offset = 0;

    for (const heading of selectedHeadings) {
      try {
        // 画像生成プロンプトを作成
        const imagePrompt = imageGenerationService.createImagePrompt(
          heading.text,
          keywords
        );

        console.log(`画像生成中: "${heading.text}"`);
        const generatedImage = await imageGenerationService.generateImage({
          prompt: imagePrompt,
          aspectRatio: '16:9'
        });

        // Base64画像をMarkdownに挿入
        const imageMarkdown = `\n\n![${heading.text}](data:${generatedImage.mimeType};base64,${generatedImage.base64Data})\n\n`;
        const insertPosition = heading.index + offset;

        processedContent =
          processedContent.slice(0, insertPosition) +
          imageMarkdown +
          processedContent.slice(insertPosition);

        offset += imageMarkdown.length;
        console.log(`✅ 画像挿入完了: "${heading.text}"`);
      } catch (error) {
        console.error(`画像生成失敗: "${heading.text}"`, error);
        // エラーが発生しても次の画像生成を続行
      }
    }

    return processedContent;
  }

  /**
   * 画像を挿入する見出しを選択（均等に分散）
   */
  private selectHeadingsForImages(
    headings: { text: string; index: number }[],
    imageCount: number
  ): { text: string; index: number }[] {
    if (headings.length <= imageCount) {
      return headings;
    }

    const selected: { text: string; index: number }[] = [];
    const step = Math.floor(headings.length / imageCount);

    for (let i = 0; i < imageCount; i++) {
      const index = Math.min(i * step, headings.length - 1);
      selected.push(headings[index]);
    }

    return selected;
  }

  // === Proxy呼び出しヘルパー ===
  private async callProxy(payload: any): Promise<any> {
    const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
    const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

    if (!supabaseUrl || !supabaseAnonKey) {
      throw new Error("Supabase configurations are missing");
    }

    // Supabase Edge Functionのエンドポイント
    const endpoint = `${supabaseUrl}/functions/v1/ai-proxy`;

    console.log('🔍 Supabase Edge Function経由でAPI呼び出し', { endpoint, provider: payload.provider });

    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${supabaseAnonKey}`
      },
      body: JSON.stringify(payload)
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      console.error('❌ AI Proxy Error:', { status: response.status, errorData });

      if (response.status === 429) {
        throw new Error("RATE_LIMIT_ERROR: APIの利用制限に達しました。しばらく待ってから再度お試しください。");
      }
      throw new Error(`AI Proxy Error (${response.status}): ${errorData.error || 'Unknown error'}`);
    }

    return await response.json();
  }

  // === 直接API呼び出し（ローカル開発用） ===
  private async callDirectAPI(payload: any): Promise<any> {
    const { provider, apiKey, model, temperature, maxTokens } = payload;

    switch (provider) {
      case 'gemini': {
        const response = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              contents: [{
                parts: [{ text: payload.prompt || payload.messages?.[0]?.content }]
              }],
              generationConfig: {
                temperature: temperature || 0.7,
                maxOutputTokens: maxTokens || 16384,
              }
            })
          }
        );

        if (!response.ok) {
          const error = await response.json();
          throw new Error(`Gemini API Error: ${error.error?.message || 'Unknown error'}`);
        }

        return await response.json();
      }

      case 'openai': {
        const response = await fetch('https://api.openai.com/v1/chat/completions', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${apiKey}`
          },
          body: JSON.stringify({
            model: model,
            messages: payload.messages,
            temperature: temperature || 0.7,
            max_tokens: maxTokens || 16384
          })
        });

        if (!response.ok) {
          const error = await response.json();
          throw new Error(`OpenAI API Error: ${error.error?.message || 'Unknown error'}`);
        }

        return await response.json();
      }

      case 'claude': {
        const response = await fetch('https://api.anthropic.com/v1/messages', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-api-key': apiKey,
            'anthropic-version': '2023-06-01'
          },
          body: JSON.stringify({
            model: model,
            messages: payload.messages,
            temperature: temperature || 0.7,
            max_tokens: maxTokens || 16384
          })
        });

        if (!response.ok) {
          const error = await response.json();
          throw new Error(`Claude API Error: ${error.error?.message || 'Unknown error'}`);
        }

        return await response.json();
      }

      default:
        throw new Error(`Unsupported provider: ${provider}`);
    }
  }

  // 生のテキストを取得するためのヘルパー
  private async callRawGemini(prompt: string): Promise<string> {
    const { apiKey, model, temperature, maxTokens } = this.config!;

    // Proxy経由でGeminiを呼び出し
    const data = await this.callProxy({
      provider: 'gemini',
      apiKey,
      model,
      temperature,
      maxTokens,
      prompt // Gemini用のプロンプト
    });

    return data.candidates?.[0]?.content?.parts?.[0]?.text || "";
  }

  private async callRawClaude(prompt: string): Promise<string> {
    const { apiKey, model, temperature, maxTokens } = this.config!;

    // Proxy経由でClaudeを呼び出し
    const data = await this.callProxy({
      provider: 'claude',
      apiKey,
      model,
      temperature,
      maxTokens,
      messages: [{ role: "user", content: prompt }]
    });

    return data.content?.[0]?.text || "";
  }

  private async callRawOpenAI(prompt: string): Promise<string> {
    const { apiKey, model, temperature, maxTokens } = this.config!;

    // Proxy経由でOpenAIを呼び出し
    const data = await this.callProxy({
      provider: 'openai',
      apiKey,
      model,
      temperature,
      maxTokens,
      messages: [{ role: "user", content: prompt }]
    });

    return data.choices?.[0]?.message?.content || "";
  }

  // === プロンプト生成 ===
  private buildPrompt(prompt: GenerationPrompt): string {
    const isSection = prompt.generationType === 'section';

    const lengthText = isSection
      ? (prompt.length === "short"
        ? "約300〜500文字"
        : prompt.length === "medium"
          ? "約500〜800文字"
          : "約800〜1,200文字")
      : (prompt.length === "short"
        ? "約1,000〜2,000文字"
        : prompt.length === "medium"
          ? "約2,000〜4,000文字"
          : "約4,000〜6,000文字");

    const toneText = (() => {
      switch (prompt.tone) {
        case "professional":
          return "専門的でフォーマルな文体で書いてください。";
        case "casual":
          return "親しみやすくカジュアルな文体で書いてください。";
        case "technical":
          return "技術的で正確な文体で書いてください。";
        case "friendly":
          return "読者に語りかけるようなフレンドリーな文体で書いてください。";
        default:
          return "";
      }
    })();

    // キーワード選別状態の処理
    let keywordPreferenceText = "";
    if (prompt.keywordPreferences) {
      const essential = Object.entries(prompt.keywordPreferences)
        .filter(([_, pref]) => pref === 'essential')
        .map(([kw]) => kw);
      const ng = Object.entries(prompt.keywordPreferences)
        .filter(([_, pref]) => pref === 'ng')
        .map(([kw]) => kw);

      if (essential.length > 0 || ng.length > 0) {
        keywordPreferenceText = "\n【キーワードの制約】\n";
        if (essential.length > 0) {
          keywordPreferenceText += `- 必須キーワード（必ず含める）: ${essential.join("、")}\n`;
        }
        if (ng.length > 0) {
          keywordPreferenceText += `- NGキーワード（絶対に使わない）: ${ng.join("、")}\n`;
        }
      }
    }

    if (isSection) {
      const targetChars = prompt.targetWordCount || (prompt.length === 'short' ? 400 : prompt.length === 'medium' ? 800 : 1200);

      return `
あなた、SEOに精通したプロのWebライターです。
読者がスマホでもストレスなく読めるよう、**高品質かつ読みやすい**ブログ記事の${prompt.isLead ? '導入部分（リード文）' : '特定の章（セクション）'}を執筆してください。

【記事全体のタイトル】
${prompt.articleTitle || prompt.selectedTitle || '未指定'}

【記事の全体構成（目次）】
${prompt.totalOutline || '未指定'}

【今回執筆するセクションの見出し】
${prompt.sectionTitle || prompt.topic}

${prompt.previousContent ? `
【前の章の内容（文脈維持のため）】
${prompt.previousContent.substring(0, 500)}...
` : ''}

【キーワード】
${prompt.keywords?.join("、") || "（指定なし）"}
※ 以下のキーワードは、文脈に沿って**自然な形で**適宜含めてください。無理に全てのキーワードを何度も使う必要はありません。

【トーン】
${toneText}

【目標文字数】
**${targetChars}文字（絶対に超過しないでください。±10%以内を厳守）**

【スタイル・可読性の指示（最重要）】
1. **1段落は最大2〜3文（80文字程度）以内に抑え、こまめに改行を入れてください。**
2. 接続詞を適切に使い、論理的かつリズムの良い文章にしてください。
3. **主語を毎回キーワードにするのではなく、省略や指示語（「これ」「同施設」「同地域」など）を活用して自然な流れを作ってください。**
4. 箇条書きを適宜活用し、視覚的な分かりやすさを追求してください。
5. 専門用語は分かりやすく解説するか、平易な言葉に置き換えてください。
6. 「〜です」「〜ます」調で統一してください。

【執筆の指示】
- **重要: 指定された${prompt.isLead ? 'リード文' : '見出し'}の本文テキストのみを出力してください。**
- **文字数制限（${targetChars}文字）を絶対に守ってください。冗長な表現は削り、情報密度を最大化してください。**
- **【最重要】文章は必ず完結させてください。途中で切れたり、文が中途半端に終わることは絶対に避けてください。**
- **文章の最後は必ず句点（。）で終わらせ、読者に完結した印象を与えてください。**
- **「以上のように〜」「次に〜について解説します」といったセクション毎の前置きや結びの言葉は一切不要です。**
- **キーワードスタッフィング（過剰な詰め込み）は厳禁です。出現率は自然な範囲（概ね3%以内）に留めてください。**
- 文脈に応じて「この」「同施設」といった指示代名詞や類義語を適切に使い、文章のリズムを整えてください。
- 見出し（##、###など）や記事タイトル、導入文（はじめに）、結論（まとめ）などは含めないでください。
${prompt.isLead ? '- **これは記事の冒頭です。読者の興味を惹きつけ、記事を読み進めたくなるような魅力的な書き出しにしてください。**' : ''}
${prompt.isLead ? '- **見出し（## リード文 など）は絶対に出力しないでください。単純なテキストのみを出力してください。**' : '- 前の章からの自然な流れを意識しつつ、同じ情報の繰り返しは避けてください。'}
- 出力は純粋な本文テキストのみとしてください（「本文:」「【本文】」などのラベルや接頭辞、記号は一切禁止）。
${keywordPreferenceText}
${prompt.customInstructions ? `\n【カスタム指示（優先）】\n${prompt.customInstructions}\n` : ''}
`;
    }

    const sections = [];
    if (prompt.includeIntroduction) sections.push("導入部分（冒頭）");
    if (prompt.includeConclusion) sections.push("まとめ（結論）");
    if (prompt.includeSources) sections.push("参考文献や引用元リスト");
    const sectionText = sections.length ? `${sections.join("、")}を含めてください。` : "";

    return `
以下の条件に基づいて、日本語でSEO最適化されたブログ記事を書いてください。

【トピック】
${prompt.topic}

${prompt.selectedTitle ? `
【記事タイトル（重要）】
${prompt.selectedTitle}
※ この記事タイトルの文脈に沿って、上記のトピック（見出し）の内容を執筆してください。他のタイトル案に関することは書かないでください。
` : ''}

【キーワード】
${prompt.keywords?.join("、") || "（指定なし）"}
※ 以下のキーワードは、文脈に沿って**自然な形で**適宜含めてください。無理に全てのキーワードを何度も使う必要はありません。

【トーン】
${toneText}

【文字数】
${prompt.targetWordCount
        ? `**目標: ${prompt.targetWordCount}文字（必ず${Math.floor(prompt.targetWordCount * 0.9)}文字以上、${Math.ceil(prompt.targetWordCount * 1.1)}文字以下で執筆してください）**`
        : lengthText}

**【最重要】文字数制限について:**
- 上記の目標文字数を厳守してください。最低文字数を下回ることは絶対に避けてください。
- 内容が不足している場合は、以下を追加して文字数を確保してください:
  - 具体例や事例の追加
  - ユーザーメリットの詳細説明
  - よくある質問（FAQ）や補足情報
  - 関連する背景情報や歴史的経緯
- 短すぎる記事は品質が低いと判断されます。必ず指定範囲内で執筆してください。

【構成】
${sectionText}
${keywordPreferenceText}
${prompt.customInstructions ? `\n【カスタム指示（優先）】\n${prompt.customInstructions}\n` : ''}

【指示】
- 見出しには「##」を使用して構造化してください。
- 内容をわかりやすく、段落を分けて書いてください。
- **【最重要】記事は必ず完結させてください。途中で切れたり、文が中途半端に終わることは絶対に避けてください。**
- **記事の最後は必ず適切な結論や締めくくりの文章で終わらせ、読者に完結した印象を与えてください。**
- **キーワードを無理に詰め込まず（キーワードスタッフィング禁止）、指示代名詞や言い換えを用いて自然な日本語で執筆してください。**
- 1行目にタイトル（または見出し）のみを出力してください（「タイトル:」などの接頭辞は禁止）。
- 2行目以降に本文のみを出力してください（「本文:」「【本文】」などの接頭辞は禁止）。
`;
  }

  // === Gemini呼び出し ===
  private async callGemini(prompt: GenerationPrompt) {
    const text = await this.callRawGemini(this.buildPrompt(prompt));
    if (prompt.generationType === 'section') {
      return { title: '', content: text.trim() };
    }
    const lines = text.split("\n");
    const title = lines[0] || "";
    const content = lines.slice(1).join("\n");
    return {
      title: title.replace(/^#+\s*/, "").trim(),
      content: content.trim(),
    };
  }

  // === Claude呼び出し ===
  private async callClaude(prompt: GenerationPrompt) {
    const text = await this.callRawClaude(this.buildPrompt(prompt));
    if (prompt.generationType === 'section') {
      return { title: '', content: text.trim() };
    }
    const lines = text.split("\n");
    const title = lines[0] || "";
    const content = lines.slice(1).join("\n");
    return {
      title: title.replace(/^#+\s*/, "").trim(),
      content: content.trim(),
    };
  }

  // === OpenAI呼び出し ===
  private async callOpenAI(prompt: GenerationPrompt) {
    const text = await this.callRawOpenAI(this.buildPrompt(prompt));
    if (prompt.generationType === 'section') {
      return { title: '', content: text.trim() };
    }
    const lines = text.split("\n");
    const title = lines[0] || "";
    const content = lines.slice(1).join("\n");
    return {
      title: title.replace(/^#+\s*/, "").trim(),
      content: content.trim(),
    };
  }

  // === Utility ===
  private generateExcerpt(content: string): string {
    const clean = content.replace(/^#+\s+/gm, "").trim();
    const first = clean.split("\n\n")[0];
    return first.length > 150 ? first.substring(0, 150) + "..." : first;
  }

  private extractKeywords(content: string, topic: string): string[] {
    const words = content.match(/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}A-Za-z0-9]+/gu) || [];
    const freq: Record<string, number> = {};
    words.forEach((w) => (freq[w] = (freq[w] || 0) + 1));
    const sorted = Object.entries(freq)
      .sort((a, b) => b[1] - a[1])
      .map(([w]) => w);
    return [topic, ...sorted.slice(0, 5)];
  }

  private calculateSEOScore(title: string, content: string, keywords: string[]): number {
    let score = 0;
    if (title.length >= 20 && title.length <= 60) score += 20;
    if (content.length > 2000) score += 40;
    if (keywords.some((k) => content.includes(k))) score += 20;
    if ((content.match(/^##/gm) || []).length >= 3) score += 20;
    return Math.min(100, score);
  }

  private calculateReadingTime(content: string): number {
    const words = content.length;
    return Math.ceil(words / 600);
  }
}

// aiService インスタンスをエクスポート
export const aiService = new AIService();
