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
import { getCurrentAccountId } from "./accountScope";

/**
 * AI髢｢騾｣繧ｵ繝ｼ繝薙せ
 * Supabase縺ｮai_configs繝・・繝悶Ν縺ｫ菫晏ｭ倥＆繧後◆險ｭ螳壹ｒ蜈・↓縲・
 * Gemini / OpenAI / Claude 縺ｪ縺ｩ繧貞虚逧・↓蜻ｼ縺ｳ蜃ｺ縺励∪縺吶・
 */
export class AIService {
  private config: AIConfig | null = null;

  constructor() { }

  // === 譛譁ｰ縺ｮAI險ｭ螳壹ｒSupabase縺九ｉ蜿門ｾ・===
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

      // 笨・Supabase縺ｮ繧ｫ繝ｩ繝繧貞・驛ｨ蠖｢蠑上↓螟画鋤
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

  // 繝｢繝・Ν蜷阪・繝舌Μ繝・・繧ｷ繝ｧ繝ｳ・域立繝｢繝・Ν蜷阪・繝輔か繝ｼ繝ｫ繝舌ャ繧ｯ・・
  private validateModelName(provider: string, model: string): string {
    if (provider !== 'gemini') return model;

    // 辟｡蜉ｹ縺ｪGemini繝｢繝・Ν蜷阪ｒ讀懃衍縺励※鄂ｮ謠・
    // gemini-1.5邉ｻ縺ｪ縺ｩ縺ｯ髱樊耳螂ｨ・・.0莉･荳翫ｒ謗ｨ螂ｨ・・
    const invalidModels = ['gemini-1.0-pro', 'gemini-1.5-pro-latest', 'gemini-3.0-pro', 'gemini-3.0-flash'];
    if (invalidModels.includes(model)) {
      console.warn(`Unsupported Gemini model detected (${model}). Fallback to gemini-2.5-flash.`);
      return 'gemini-2.5-flash';
    }

    return model;
  }

  // 險ｭ螳壹ｒ蜿門ｾ励☆繧九◆繧√・繧ｲ繝・ち繝ｼ
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
   * 迢ｬ閾ｪ縺ｮ繝励Ο繝ｳ繝励ヨ繧呈欠螳壹＠縺ｦJSON蠖｢蠑上〒邨先棡繧貞叙蠕励☆繧・
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

      // Markdown縺ｮ繧ｳ繝ｼ繝峨ヶ繝ｭ繝・け繧帝勁蜴ｻ
      const cleaned = text.replace(/```json\n?|```/g, "").trim();

      try {
        return JSON.parse(cleaned);
      } catch (parseError) {
        console.error("JSON parse error:", cleaned);
        // 驛ｨ蛻・噪縺ｫ螢翫ｌ縺ｦ縺・ｋ蝣ｴ蜷医↓蛯吶∴縺ｦ縲∵ｭ｣隕剰｡ｨ迴ｾ縺ｧ驟榊・/繧ｪ繝悶ず繧ｧ繧ｯ繝医ｒ謗｢縺・
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
   * 繧ｭ繝ｼ繝ｯ繝ｼ繝峨↓蝓ｺ縺･縺・※縲・未騾｣縺吶ｋ繧ｵ繧ｸ繧ｧ繧ｹ繝医く繝ｼ繝ｯ繝ｼ繝峨ｒ逕滓・縺吶ｋ
   */
  async generateRelatedKeywords(keyword: string): Promise<string[]> {
    try {
      if (!this.config) await this.loadActiveConfig();

      const prompt = `
莉･荳九・繧ｭ繝ｼ繝ｯ繝ｼ繝峨↓髢｢騾｣縺吶ｋ縲∵､懃ｴ｢繝懊Μ繝･繝ｼ繝縺悟､ｧ縺阪￥縲√Θ繝ｼ繧ｶ繝ｼ縺梧ｬ｡縺ｫ讀懃ｴ｢縺励◎縺・↑繧ｵ繝悶く繝ｼ繝ｯ繝ｼ繝峨ｒ10蛟区嫌縺偵※縺上□縺輔＞縲・
繧ｭ繝ｼ繝ｯ繝ｼ繝・ ${keyword}

JSON蠖｢蠑上・驟榊・・域枚蟄怜・縺ｮ驟榊・・峨〒蜃ｺ蜉帙＠縺ｦ縺上□縺輔＞縲・
萓・ ["繧ｭ繝ｼ繝ｯ繝ｼ繝・", "繧ｭ繝ｼ繝ｯ繝ｼ繝・", ...]
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

  // === 險倅ｺ狗函謌撰ｼ医Γ繧､繝ｳ蜃ｦ逅・ｼ・===
  async generateArticle(prompt: GenerationPrompt) {
    try {
      // 險ｭ螳壹Ο繝ｼ繝会ｼ域悴繝ｭ繝ｼ繝峨↑繧牙ｮ溯｡鯉ｼ・
      if (!this.config) await this.loadActiveConfig();

      // 蠢・磯・岼繝√ぉ繝・け
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

      // 譁・ｭ玲焚繝√ぉ繝・け・井ｸ崎ｶｳ譎ゅ・霑ｽ險倥∬ｶ・℃譎ゅ・隕∫ｴ・ｼ・
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

      // 逕ｻ蜒冗函謌舌′譛牙柑縺ｪ蝣ｴ蜷医∬ｨ倅ｺ九↓逕ｻ蜒上ｒ謖ｿ蜈･
      // 繝励Ο繝ｳ繝励ヨ縺ｧ謖・ｮ壹＆繧後◆譫壽焚繧貞━蜈医√↑縺代ｌ縺ｰ險ｭ螳壼､繧剃ｽｿ逕ｨ
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
          // 繧ｨ繝ｩ繝ｼ蜀・ｮｹ繧定ｨ倅ｺ九・譛ｫ蟆ｾ縺ｫ霑ｽ險假ｼ医ョ繝舌ャ繧ｰ逕ｨ・・
          content += `\n\n> [!WARNING]\n> **画像生成エラーが発生しました**\n> ${error.message || '不明なエラー'}\n> 設定やAPIキーを確認してください。`;
        }
      }

      return { title, content, excerpt, keywords, readingTime };
    } catch (error) {
      console.error("Article generation error:", error);
      throw error;
    }
  }

  // === 譁・ｭ玲焚繧ｫ繧ｦ繝ｳ繝・===
  private countWords(content: string): number {
    // Markdown險伜捷繧帝勁螟悶＠縺ｦ譁・ｭ玲焚繧偵き繧ｦ繝ｳ繝・
    const cleaned = content
      .replace(/^#+\s+/gm, '') // 隕句・縺苓ｨ伜捷
      .replace(/\*\*/g, '')     // 螟ｪ蟄・
      .replace(/\*/g, '')       // 繧､繧ｿ繝ｪ繝・け
      .replace(/^[-*]\s+/gm, '') // 繝ｪ繧ｹ繝郁ｨ伜捷
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
      // 隕∫ｴ・↓螟ｱ謨励＠縺溷ｴ蜷医・縲∵ｮｵ關ｽ蜊倅ｽ阪〒蛻・ｊ隧ｰ繧√ｋ
      return this.truncateByParagraph(originalContent, targetWordCount);
    }
  }

  // === 谿ｵ關ｽ蜊倅ｽ阪〒縺ｮ蛻・ｊ隧ｰ繧・ｼ医ヵ繧ｩ繝ｼ繝ｫ繝舌ャ繧ｯ・・===
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

  // === 荳崎ｶｳ譁・ｭ玲焚縺ｮ霑ｽ險倩｣懷ｮ・===
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

  // === 險倅ｺ区忰蟆ｾ縺ｮ縲後∪縺ｨ繧√阪そ繧ｯ繧ｷ繝ｧ繝ｳ繧貞・髮｢ ===
  private splitFinalSummarySection(content: string): { hasSummary: boolean; body: string; summary: string } {
    const headingRegex = /^##+\s*(縺ｾ縺ｨ繧－邨占ｫ翻縺翫ｏ繧翫↓|譛蠕後↓|邱乗峡)[^\n]*$/gim;
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

  // === 霑ｽ險俶枚縺九ｉ縲後∪縺ｨ繧√咲ｳｻ縺ｮ譁・ｨ繧帝勁蜴ｻ ===
  private sanitizeSupplementText(addition: string): string {
    const paragraphs = addition
      .split(/\n{2,}/)
      .map(p => p.trim())
      .filter(Boolean);

    const filtered = paragraphs.filter(p => {
      const normalized = p.replace(/\s+/g, '');
      if (/^#{1,6}(縺ｾ縺ｨ繧－邨占ｫ翻縺翫ｏ繧翫↓|譛蠕後↓|邱乗峡)/i.test(p)) return false;
      if (/^(縺ｾ縺ｨ繧－邨占ｫ翻縺翫ｏ繧翫↓|譛蠕後↓|邱乗峡)/.test(normalized)) return false;
      if (/^(莉･荳翫・繧医≧縺ｫ|莉･荳翫ｈ繧掛莉･荳翫°繧榎隕√☆繧九↓|縺ｾ縺ｨ繧√ｋ縺ｨ)/.test(normalized)) return false;
      return true;
    });

    return filtered.join('\n\n').trim();
  }

  // === 霑ｽ險倥・逕溘ユ繧ｭ繧ｹ繝域ｭ｣隕丞喧 ===
  private normalizeSupplementRawText(raw: string, isSection: boolean): string {
    let cleaned = raw.replace(/```[\s\S]*?```/g, '').trim();

    if (isSection) {
      cleaned = cleaned.replace(/^#+\s+/gm, '');
    }

    cleaned = cleaned.replace(/^##+\s*(縺ｾ縺ｨ繧－邨占ｫ翻縺翫ｏ繧翫↓|譛蠕後↓|邱乗峡)[^\n]*$/gim, '').trim();
    return cleaned;
  }

  // === 逕ｻ蜒冗函謌舌・謖ｿ蜈･ ===
  /**
   * 險倅ｺ句・縺ｮ隕句・縺励↓逕ｻ蜒上ｒ逕滓・縺励※謖ｿ蜈･
   */
  /**
  * 逕滓・縺輔ｌ縺溽判蜒上ｒ險倅ｺ九↓謖ｿ蜈･・亥・髢九Γ繧ｽ繝・ラ縺ｫ螟画峩・・
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

    // 逕ｻ蜒上ｒ謖ｿ蜈･縺吶ｋ隕句・縺励ｒ驕ｸ謚橸ｼ亥插遲峨↓蛻・淵・・
    const selectedHeadings = this.selectHeadingsForImages(headings, imageCount);
    console.log(`${selectedHeadings.length}箇所の見出しに画像を挿入します`);

    // 蜷・ｦ句・縺励↓逕ｻ蜒上ｒ逕滓・繝ｻ謖ｿ蜈･
    let processedContent = content;
    let offset = 0;

    for (const heading of selectedHeadings) {
      try {
        // 逕ｻ蜒冗函謌舌・繝ｭ繝ｳ繝励ヨ繧剃ｽ懈・
        const imagePrompt = imageGenerationService.createImagePrompt(
          heading.text,
          keywords
        );

        console.log(`Generating image: "${heading.text}"`);
        const generatedImage = await imageGenerationService.generateImage({
          prompt: imagePrompt,
          aspectRatio: '16:9'
        });

        // Base64逕ｻ蜒上ｒMarkdown縺ｫ謖ｿ蜈･
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
        // 繧ｨ繝ｩ繝ｼ縺檎匱逕溘＠縺ｦ繧よｬ｡縺ｮ逕ｻ蜒冗函謌舌ｒ邯夊｡・
      }
    }

    return processedContent;
  }

  /**
   * 逕ｻ蜒上ｒ謖ｿ蜈･縺吶ｋ隕句・縺励ｒ驕ｸ謚橸ｼ亥插遲峨↓蛻・淵・・
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

  // === Proxy蜻ｼ縺ｳ蜃ｺ縺励・繝ｫ繝代・ ===
  private async callProxy(payload: any): Promise<any> {
    const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
    const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

    if (!supabaseUrl || !supabaseAnonKey) {
      throw new Error("Supabase configurations are missing");
    }

    // Supabase Edge Function縺ｮ繧ｨ繝ｳ繝峨・繧､繝ｳ繝・
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

  // === 逶ｴ謗･API蜻ｼ縺ｳ蜃ｺ縺暦ｼ医Ο繝ｼ繧ｫ繝ｫ髢狗匱逕ｨ・・===
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

  // 逕溘・繝・く繧ｹ繝医ｒ蜿門ｾ励☆繧九◆繧√・繝倥Ν繝代・
  private async callRawGemini(prompt: string): Promise<string> {
    const { apiKey, model, temperature, maxTokens } = this.config!;

    // Proxy邨檎罰縺ｧGemini繧貞他縺ｳ蜃ｺ縺・
    const data = await this.callProxy({
      provider: 'gemini',
      apiKey,
      model,
      temperature,
      maxTokens,
      prompt // Gemini逕ｨ縺ｮ繝励Ο繝ｳ繝励ヨ
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
  // === 繝励Ο繝ｳ繝励ヨ逕滓・ ===
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
          return "専門的でフォーマルな文体で書いてください。";
        case "casual":
          return "親しみやすくカジュアルな文体で書いてください。";
        default:
          return "";
      }
    })();

    // 繧ｭ繝ｼ繝ｯ繝ｼ繝蛾∈蛻･迥ｶ諷九・蜃ｦ逅・
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

【目標文字数】
${prompt.targetWordCount ? `約${prompt.targetWordCount}文字（±10%）` : lengthText}

【要件】
${sectionText}
${keywordPreferenceText}
${prompt.customInstructions ? `\n【追加指示】\n${prompt.customInstructions}\n` : ''}

【AI検索引用向け構成】
- 導入では読者の疑問に対する結論を先に示し、記事全体で何が分かるかを明確にする
- 各H2/H3は「定義」「原因」「手順」「比較」「判断基準」「注意点」「FAQ」の役割が分かる見出しにする
- 各主要セクションの冒頭には、その見出しへの答え・要点を1〜2文で置く
- 比較、料金、条件、手順は、必要に応じて表や箇条書きで引用しやすく整理する
- 断定する情報には、前提条件、例外、注意点を近くに添えて誤解されにくくする
- AI検索に抜き出されても意味が通るよう、主語と対象が明確な短い文を適度に含める

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

// aiService 繧､繝ｳ繧ｹ繧ｿ繝ｳ繧ｹ繧偵お繧ｯ繧ｹ繝昴・繝・
export const aiService = new AIService();


