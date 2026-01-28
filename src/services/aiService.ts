import { AIConfig, GenerationPrompt } from "../types";
import { supabase } from "./supabaseClient";

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
        model: data.model,
        temperature: data.temperature ?? 0.7,
        maxTokens: data.max_tokens ?? 4000,
        imageGenerationEnabled: data.image_enabled ?? false,
        imageProvider: data.image_provider,
      };

      console.log("✅ AI設定をロードしました:", this.config);
    } catch (err) {
      console.error("AI設定ロード時エラー:", err);
      throw err;
    }
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

      const { title, content } = result;
      const excerpt = this.generateExcerpt(content);
      const keywords = this.extractKeywords(content, prompt.topic);
      const seoScore = this.calculateSEOScore(title, content, keywords);
      const readingTime = this.calculateReadingTime(content);

      return { title, content, excerpt, keywords, seoScore, readingTime };
    } catch (error) {
      console.error("記事生成エラー:", error);
      throw error;
    }
  }

  // 生のテキストを取得するためのヘルパー
  private async callRawGemini(prompt: string): Promise<string> {
    const { apiKey, model, temperature, maxTokens } = this.config!;
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${model || 'gemini-3.0-flash'}:generateContent?key=${apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: { temperature, maxOutputTokens: maxTokens },
        }),
      }
    );
    if (!response.ok) {
      if (response.status === 429) {
        throw new Error("RATE_LIMIT_ERROR: Gemini APIの利用制限に達しました。しばらく待ってから再度お試しください。");
      }
      if (response.status === 400 || response.status === 401) {
        throw new Error("AUTH_ERROR: APIキーが無効であるか、モデル名が正しくありません。設定を確認してください。");
      }
      throw new Error(`Gemini API error: ${response.status}`);
    }
    const data = await response.json();
    return data.candidates?.[0]?.content?.parts?.[0]?.text || "";
  }

  private async callRawClaude(prompt: string): Promise<string> {
    const { apiKey, model, temperature, maxTokens } = this.config!;
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model,
        temperature,
        max_tokens: maxTokens,
        messages: [{ role: "user", content: prompt }],
      }),
    });
    if (!response.ok) {
      if (response.status === 429) {
        throw new Error("RATE_LIMIT_ERROR: Claude APIの利用制限に達しました。しばらく待ってから再度お試しください。");
      }
      if (response.status === 401 || response.status === 403) {
        throw new Error("AUTH_ERROR: APIキーが無効です。設定を確認してください。");
      }
      throw new Error(`Claude API error: ${response.status}`);
    }
    const data = await response.json();
    return data.content?.[0]?.text || "";
  }

  private async callRawOpenAI(prompt: string): Promise<string> {
    const { apiKey, model, temperature, maxTokens } = this.config!;
    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        temperature,
        max_tokens: maxTokens,
        messages: [{ role: "user", content: prompt }],
      }),
    });
    if (!response.ok) {
      if (response.status === 429) {
        throw new Error("RATE_LIMIT_ERROR: OpenAI APIの利用制限に達しました。しばらく待ってから再度お試しください。");
      }
      if (response.status === 401) {
        throw new Error("AUTH_ERROR: APIキーが無効です。設定を確認してください。");
      }
      throw new Error(`OpenAI API error: ${response.status}`);
    }
    const data = await response.json();
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
${lengthText}

【構成】
${sectionText}
${keywordPreferenceText}
${prompt.customInstructions ? `\n【カスタム指示（優先）】\n${prompt.customInstructions}\n` : ''}

【指示】
- 見出しには「##」を使用して構造化してください。
- 内容をわかりやすく、段落を分けて書いてください。
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
