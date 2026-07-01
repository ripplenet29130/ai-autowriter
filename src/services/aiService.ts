import { AIConfig, GenerationPrompt } from "../types";
import { supabase } from "./supabaseClient";
import { imageGenerationService } from "./imageGenerationService";
import { useAuthStore } from "../store/useAuthStore";
import {
  DEFAULT_WORD_COUNT_TOLERANCE,
  getWordCountBounds,
  resolveTargetWordCount
} from "../shared/generationPolicy";
import { buildSummaryPrompt, buildSupplementPrompt } from "../shared/generationPrompts";
import { buildHighQualitySectionPrompt } from "../shared/sectionGenerationPrompt";
import { normalizeAiModel, supportsTemperature } from "../shared/aiModelCatalog";
import { getCurrentAccountId } from "./accountScope";

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

      const accountId = getCurrentAccountId();
      let query = supabase
        .from("ai_configs")
        .select("*")
        .order("is_active", { ascending: false })
        .order("created_at", { ascending: false })
        .limit(1);

      if (accountId) {
        query = query.eq("account_id", accountId);
      }

      const { data, error } = await query.maybeSingle();

      if (error) {
        console.error("Failed to fetch AI config:", error.message);
        throw new Error("AI設定の取得に失敗しました");
      }

      if (!data) {
        throw new Error("有効なAI設定が見つかりません。AI設定ページで登録してください。");
      }

      // Supabaseのカラムを内部形式に変換
      this.config = {
        id: data.id,
        provider: data.provider,
        apiKey: data.api_key,
        model: this.validateModelName(data.provider, data.model),
        temperature: data.temperature ?? 0.7,
        maxTokens: data.max_tokens ?? 16384,
        imageGenerationEnabled: data.image_enabled ?? false,
        imageProvider: data.image_provider,
        imagesPerArticle: data.images_per_article ?? 0,
      };

      console.log("AI config loaded:", this.config);
    } catch (err) {
      console.error("AI config load error:", err);
      throw err;
    }
  }

  // 廃止済み・誤形式のモデル名を現行の安全な既定値へ置換
  private validateModelName(provider: string, model: string): string {
    const normalizedModel = normalizeAiModel(provider, model);
    if (normalizedModel !== model) {
      console.warn(`Unsupported or outdated AI model detected (${model}). Fallback to ${normalizedModel}.`);
    }
    return normalizedModel;
  }

  // 設定を取得するためのゲッター
  public getActiveConfig(): AIConfig | null {
    return this.config;
  }

  // UIから選択したAI設定を直接適用
  public useConfig(config: AIConfig) {
    this.config = {
      ...config,
      model: this.validateModelName(config.provider, config.model),
    };
    console.log("AI config overridden by UI selection:", {
      id: this.config.id,
      provider: this.config.provider,
      model: this.config.model,
    });
  }

  /**
   * 独自のプロンプトを指定してJSON形式で結果を取得する
   */
  async generateCustomJson(promptText: string): Promise<any> {
    try {
      if (!this.config) await this.loadActiveConfig();

      const jsonPrompt = `
${promptText}

重要: 有効なJSONのみを返してください。説明文やMarkdownコードブロックは不要です。
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
        console.error("JSON parse error:", cleaned);
        // 部分的に壊れている場合に備えて、正規表現で配列/オブジェクトを探す
        const match = cleaned.match(/\[[\s\S]*\]|\{[\s\S]*\}/);
        if (match) {
          return JSON.parse(match[0]);
        }
        throw parseError;
      }
    } catch (error) {
      console.error("Custom JSON generation error:", error);
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
以下のキーワードに関連する、検索ボリュームが大きく、ユーザーが次に検索しそうなサブキーワードを10個提案してください。
キーワード: ${keyword}

JSON形式の配列（文字列のみの配列）で出力してください。
例: ["キーワード1", "キーワード2", ...]
`;
      const result = await this.generateCustomJson(prompt);
      if (Array.isArray(result)) {
        return result.slice(0, 10);
      }
      return [];
    } catch (error) {
      console.error("Related keyword generation error:", error);
      return [];
    }
  }

  // === 記事生成（メイン処理） ===
  async generateArticle(prompt: GenerationPrompt) {
    try {
      // 設定ロード（未ロードなら実行）
      if (!this.config) await this.loadActiveConfig();

      // 必須項目チェック
      if (!this.config?.provider) throw new Error("AI provider is not configured.");
      if (!this.config?.apiKey) throw new Error("API key is not configured.");
      if (!this.config?.model) throw new Error("Model is not configured.");

      // 蛻晏屓逕滓・
      console.log('Article generation started', { topic: prompt.topic, length: prompt.length });
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
          throw new Error(`Unsupported AI provider: ${this.config.provider}`);
      }

      let { title, content } = result;

      // Respect user-provided title when explicitly set.
      // selectedTitle: title chosen before generation
      // articleTitle: title edited/locked in multi-step flow
      if (prompt.generationType !== 'section') {
        const fixedTitle = (prompt.selectedTitle || prompt.articleTitle || '').trim();
        if (fixedTitle) {
          title = fixedTitle;
        }
      }

      // 文字数チェック（不足時は追記、超過時は要約）
      const targetWordCount = resolveTargetWordCount(prompt.length, prompt.targetWordCount);
      const { minAllowed, maxAllowed } = getWordCountBounds(targetWordCount, DEFAULT_WORD_COUNT_TOLERANCE);
      let currentWordCount = this.countWords(content);

      console.log('Word count check:', {
        target: targetWordCount,
        actual: currentWordCount
      });

      if (currentWordCount < minAllowed) {
        console.log('Under minimum length. Extending content...', {
          actual: currentWordCount,
          minAllowed
        });

        content = await this.extendToMinimumLength(content, prompt, minAllowed, maxAllowed);

        const supplementedCount = this.countWords(content);
        currentWordCount = supplementedCount;
        console.log('Extension completed:', {
          before: this.countWords(result.content),
          after: supplementedCount
        });
      }

      if (currentWordCount > maxAllowed) {
        console.log('Over maximum length. Summarizing content...', {
          actual: currentWordCount,
          maxAllowed
        });
        content = await this.summarizeToWordCount(
          content,
          title,
          targetWordCount,
          prompt.keywords || []
        );
        const newWordCount = this.countWords(content);
        console.log('Summary completed:', { before: currentWordCount, after: newWordCount });
      }

      const excerpt = this.generateExcerpt(content);
      const keywords = this.extractKeywords(content, prompt.topic);
      const readingTime = this.calculateReadingTime(content);

      // 画像生成が有効な場合、記事に画像を挿入
      // プロンプトで指定された枚数を優先し、なければ設定値を使用
      const imageCount = prompt.imagesPerArticle !== undefined
        ? prompt.imagesPerArticle
        : (this.config.imagesPerArticle || 0);

      const imageGenerationAllowed = useAuthStore.getState().account?.feature_flags?.image_generation !== false;

      if (imageGenerationAllowed && this.config.imageGenerationEnabled && imageCount > 0) {
        console.log('Starting image generation...', {
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
          console.log('画像生成・挿入完了');
        } catch (error: any) {
          console.error('Image generation error:', error);
          // エラー内容を記事の末尾に追記（デバッグ用）
          content += `\n\n> [!WARNING]\n> **画像生成エラーが発生しました**\n> ${error.message || '不明なエラー'}\n> 設定やAPIキーを確認してください。`;
        }
      }

      return { title, content, excerpt, keywords, readingTime };
    } catch (error) {
      console.error("Article generation error:", error);
      throw error;
    }
  }

  // === 文字数カウント ===
  private countWords(content: string): number {
    // Markdown記法を除外して文字数をカウント
    const cleaned = content
      .replace(/^#+\s+/gm, '') // 隕句・縺苓ｨ伜捷
      .replace(/\*\*/g, '')     // 太字
      .replace(/\*/g, '')       // イタリック
      .replace(/^[-*]\s+/gm, '') // リスト記法
      .replace(/\n+/g, '\n')    // 騾｣邯壽隼陦後ｒ1縺､縺ｫ
      .trim();
    return cleaned.length;
  }

  // === 逶ｮ讓呎枚蟄玲焚縺ｮ蜿門ｾ・===
  private getTargetWordCount(length?: 'short' | 'medium' | 'long'): number {
    return resolveTargetWordCount(length);
  }

  // === 謖・ｮ壽枚蟄玲焚縺ｸ縺ｮ隕∫ｴ・===
  private async summarizeToWordCount(
    originalContent: string,
    title: string,
    targetWordCount: number,
    keywords: string[]
  ): Promise<string> {
    const summaryPrompt = buildSummaryPrompt({
      originalContent,
      title,
      targetWordCount,
      keywords
    });

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
      console.error('Summary error:', error);
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
      const supplementPrompt = buildSupplementPrompt({
        originalContent: baseContent,
        currentCount,
        minAllowed,
        maxAllowed,
        remaining,
        title: prompt.articleTitle || prompt.selectedTitle || prompt.topic || '',
        sectionTitle: prompt.sectionTitle || prompt.topic || '',
        keywords: prompt.keywords || [],
        isSection,
        hasSummaryAnchor: !!summarySplit?.hasSummary
      });

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
      console.error('Content extension error:', error);
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

  // === 画像生成の挿入 ===
  /**
   * 記事内の見出しに画像を生成して挿入
   */
  /**
  * 生成された画像を記事に挿入（公開メソッドに変更）
  */
  public async insertGeneratedImages(
    content: string,
    title: string,
    keywords: string[],
    imageCount: number
  ): Promise<string> {
    // 隕句・縺暦ｼ・#・峨ｒ謚ｽ蜃ｺ
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

    // 画像を挿入する見出しを選択（序盤などに分散）
    const selectedHeadings = this.selectHeadingsForImages(headings, imageCount);
    console.log(`${selectedHeadings.length}箇所の見出しに画像を挿入します`);

    // 各見出しに画像を生成・挿入
    let processedContent = content;
    let offset = 0;

    for (const heading of selectedHeadings) {
      try {
        // 画像生成のプロンプトを作成
        const imagePrompt = imageGenerationService.createImagePrompt(
          heading.text,
          keywords
        );

        console.log(`Generating image: "${heading.text}"`);
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
        console.log(`Image inserted: "${heading.text}"`);
      } catch (error) {
        console.error(`Image generation failed: "${heading.text}"`, error);
        // エラーが発生しても次の画像生成を継続
      }
    }

    return processedContent;
  }

  /**
   * 画像を挿入する見出しを選択（序盤などに分散）
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

  // === Proxy呼び出しのヘルパー ===
  private async callProxy(payload: any): Promise<any> {
    const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
    const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

    if (!supabaseUrl || !supabaseAnonKey) {
      throw new Error("Supabase configurations are missing");
    }

    // Supabase Edge Functionのエンドポイント
    const endpoint = `${supabaseUrl}/functions/v1/ai-proxy`;

    console.log('Supabase Edge Function経由でAPI呼び出し', { endpoint, provider: payload.provider });

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
      console.error('AI Proxy Error:', { status: response.status, errorData });
      const proxyErrorMessage = typeof errorData?.error === 'string'
        ? errorData.error
        : JSON.stringify(errorData);

      const isGeminiQuotaError =
        /Gemini API error \(429\)/i.test(proxyErrorMessage) ||
        /RESOURCE_EXHAUSTED/i.test(proxyErrorMessage) ||
        /quota exceeded/i.test(proxyErrorMessage);

      if (isGeminiQuotaError) {
        const retryMatch = proxyErrorMessage.match(/Please retry in\s+([\d.]+)s/i);
        const retrySeconds = retryMatch ? Math.ceil(Number(retryMatch[1])) : null;
        const retryMessage = retrySeconds
          ? `約${retrySeconds}秒後に再試行してください。`
          : 'しばらく待ってから再試行してください。';

        throw new Error(`RATE_LIMIT_ERROR: Gemini APIの利用上限に達しました。Google AI Studioのクォータ/請求設定を確認してください。${retryMessage}`);
      }

      if (response.status === 429) {
        throw new Error("RATE_LIMIT_ERROR: API usage limit reached. Please retry later.");
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
        const modelName = this.validateModelName(provider, model);
        const response = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent?key=${apiKey}`,
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
            max_completion_tokens: maxTokens || 16384,
            ...(supportsTemperature('openai', model) ? { temperature: temperature ?? 0.7 } : {}),
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
            max_tokens: maxTokens || 16384,
            ...(supportsTemperature('claude', model) ? { temperature: temperature ?? 0.7 } : {}),
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

    // Proxy邨檎罰縺ｧGemini繧貞他縺ｳ蜃ｺ縺・
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

    // Proxy邨檎罰縺ｧClaude繧貞他縺ｳ蜃ｺ縺・
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

    // Proxy邨檎罰縺ｧOpenAI繧貞他縺ｳ蜃ｺ縺・
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

  public async generateRawText(prompt: string, maxTokens?: number): Promise<string> {
    if (!this.config) await this.loadActiveConfig();

    if (!this.config?.provider) {
      throw new Error("AI provider not configured");
    }

    const originalMaxTokens = this.config.maxTokens;
    if (maxTokens && maxTokens > 0) {
      this.config.maxTokens = maxTokens;
    }

    try {
      switch (this.config.provider) {
        case 'openai':
          return await this.callRawOpenAI(prompt);
        case 'gemini':
          return await this.callRawGemini(prompt);
        case 'claude':
          return await this.callRawClaude(prompt);
        default:
          throw new Error(`Unsupported provider: ${this.config.provider}`);
      }
    } finally {
      this.config.maxTokens = originalMaxTokens;
    }
  }
  // === プロンプト生成 ===
  private buildPrompt(prompt: GenerationPrompt): string {
    const isSection = prompt.generationType === 'section';

    const lengthText = isSection
      ? (prompt.length === "short"
        ? "約400〜600文字"
        : prompt.length === "medium"
          ? "約700〜900文字"
          : "約1000〜1200文字")
      : (prompt.length === "short"
        ? "約1000〜2000文字"
        : prompt.length === "medium"
          ? "約2000〜3000文字"
          : "約3000〜5000文字");

    const toneText = (() => {
      switch (prompt.tone) {
        case "professional":
          return "専門性は保ちつつ、読者からの相談に答えるような自然で読みやすい文体で書いてください。堅い報告書調ではなく、実務者がやさしく説明する温度感にしてください。";
        case "casual":
          return "親しみやすく、くだけすぎない自然な文体で書いてください。話し言葉に寄せすぎず、読者がすっと理解できる温度感にしてください。";
        default:
          return "自然で読みやすい日本語で書いてください。";
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
        keywordPreferenceText = "\n【キーワード優先度】\n";
        if (essential.length > 0) {
          keywordPreferenceText += `- 必須キーワード: ${essential.join("、")}\n`;
        }
        if (ng.length > 0) {
          keywordPreferenceText += `- NGキーワード: ${ng.join("、")}\n`;
        }
      }
    }

    if (isSection) {
      const targetChars = prompt.targetWordCount || (prompt.length === 'short' ? 400 : prompt.length === 'medium' ? 800 : 1200);
      return buildHighQualitySectionPrompt({
        articleTitle: prompt.articleTitle || prompt.selectedTitle || '未設定',
        totalOutline: prompt.totalOutline || '未設定',
        sectionTitle: prompt.sectionTitle || prompt.topic,
        previousContent: prompt.previousContent,
        keywords: prompt.keywords,
        tone: prompt.tone,
        targetChars,
        isLead: prompt.isLead,
        customInstructions: prompt.customInstructions,
        keywordPreferences: prompt.keywordPreferences
      });
    }

    const sections = [];
    if (prompt.includeIntroduction) sections.push("導入");
    if (prompt.includeConclusion) sections.push("まとめ");
    if (prompt.includeSources) sections.push("参考情報");
    const sectionText = sections.length ? `${sections.join("、")}を含めてください。` : "";

    return `
以下の条件で日本語記事を作成してください。

【トピック】
${prompt.topic}

${prompt.selectedTitle ? `【固定タイトル】\n${prompt.selectedTitle}\n` : ''}
【キーワード】
${prompt.keywords?.join("、") || "なし"}

【文体】
${toneText}
- 説明書調や営業文ではなく、読者の疑問に落ち着いて答える文章にする
- 「〜いたします」「〜させていただきます」「〜となります」を多用しない
- 必要に応じて「〜できます」「〜です」「〜を確認しましょう」のような自然な表現を使う
- 1文を長くしすぎず、長い文は自然な位置で分ける
- 抽象的な名詞を続けず、「何をすればよいか」「なぜ必要か」が伝わる具体的な動詞で書く

【目標文字数】
${prompt.targetWordCount ? `約${prompt.targetWordCount}文字（±10%）` : lengthText}

【要件】
${sectionText}
${keywordPreferenceText}
${prompt.customInstructions ? `\n【追加指示】\n${prompt.customInstructions}\n` : ''}

【AI検索引用向け構成】
- 導入と各主要セクションでは、読者の疑問に対する答え・要点を先に示す
- 比較、料金、条件、手順は、必要に応じて表や箇条書きで整理する
- 断定する情報には、前提条件、例外、注意点を近くに添える
- 数字付きの見出しを使う場合は、本文内の列挙数と一致させる

【出力形式】
- Markdownで出力
- 文章は自然で読みやすく
- 見出しや段落を適切に利用
- **（太字マーク）は使用禁止。強調したい場合も ** で囲まないこと
`;
  }

  // === Gemini蜻ｼ縺ｳ蜃ｺ縺・===
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

  // === Claude蜻ｼ縺ｳ蜃ｺ縺・===
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

  // === OpenAI蜻ｼ縺ｳ蜃ｺ縺・===
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

  private calculateReadingTime(content: string): number {
    const words = content.length;
    return Math.ceil(words / 600);
  }
}

// aiService インスタンスをエクスポート
export const aiService = new AIService();


