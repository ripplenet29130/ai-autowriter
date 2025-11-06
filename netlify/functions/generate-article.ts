import { createClient } from "@supabase/supabase-js";
import type { Handler } from "@netlify/functions";

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!
);

export const handler: Handler = async (event) => {
  try {
    const { ai_config_id, keyword, related_keywords } = JSON.parse(event.body || "{}");

    if (!ai_config_id || !keyword) {
      return { statusCode: 400, body: JSON.stringify({ error: "パラメータが不足しています" }) };
    }

    // ✅ SupabaseからAI設定を取得
    const { data: aiConfig, error: aiError } = await supabase
      .from("ai_configs")
      .select("*")
      .eq("id", ai_config_id)
      .single();

    if (aiError || !aiConfig) {
      throw new Error("AI設定の取得に失敗しました");
    }

    // === 共通プロンプト作成 ===
    const prompt = `
あなたはSEOに強い日本語ライターです。
次の条件に基づいてブログ記事を作成してください。

【キーワード】${keyword}
【関連ワード】${related_keywords.join("、")}
【トーン】${aiConfig.tone || "ナチュラル"}
【スタイル】${aiConfig.style || "ブログ風"}
【ボリューム】${aiConfig.article_length || "中程度"}


`;

    let generatedText = "";

    // === AIプロバイダごとに分岐 ===
    switch ((aiConfig.provider || "").toLowerCase()) {
      // ---------- Google Gemini ----------
      case "google gemini": {
        const geminiKey = aiConfig.api_key || process.env.VITE_GEMINI_API_KEY;
        const model = aiConfig.model || "gemini-2.5-flash";
        const res = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${geminiKey}`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              contents: [{ parts: [{ text: prompt }] }],
              generationConfig: {
                temperature: aiConfig.temperature ?? 0.7,
                maxOutputTokens: aiConfig.max_tokens ?? 4000,
              },
            }),
          }
        );
        const data = await res.json();
        generatedText =
          data?.candidates?.[0]?.content?.parts?.[0]?.text || "Geminiでの生成に失敗しました。";
        break;
      }

      // ---------- OpenAI ----------
      case "openai": {
        const openaiKey = aiConfig.api_key || process.env.OPENAI_API_KEY;
        const model = aiConfig.model || "gpt-4o-mini";
        const res = await fetch("https://api.openai.com/v1/chat/completions", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${openaiKey}`,
          },
          body: JSON.stringify({
            model,
            messages: [{ role: "user", content: prompt }],
            temperature: aiConfig.temperature ?? 0.7,
            max_tokens: aiConfig.max_tokens ?? 4000,
          }),
        });
        const data = await res.json();
        generatedText = data?.choices?.[0]?.message?.content || "OpenAIでの生成に失敗しました。";
        break;
      }

      // ---------- Anthropic Claude ----------
      case "anthropic claude": {
        const claudeKey = aiConfig.api_key || process.env.CLAUDE_API_KEY;
        const model = aiConfig.model || "claude-3-sonnet-20240229";
        const res = await fetch("https://api.anthropic.com/v1/messages", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-api-key": claudeKey,
            "anthropic-version": "2023-06-01",
          },
          body: JSON.stringify({
            model,
            max_tokens: aiConfig.max_tokens ?? 4000,
            temperature: aiConfig.temperature ?? 0.7,
            messages: [{ role: "user", content: prompt }],
          }),
        });
        const data = await res.json();
        generatedText = data?.content?.[0]?.text || "Claudeでの生成に失敗しました。";
        break;
      }

      // ---------- 不明なプロバイダ ----------
      default:
        throw new Error(`未対応のAIプロバイダです: ${aiConfig.provider}`);
    }

    // ✅ タイトル＋本文に分割
    const [firstLine, ...rest] = generatedText.split("\n");
    const title = firstLine.replace(/^#\s*/, "").trim() || `${keyword}に関する記事`;
    const content = rest.join("\n").trim();

    return {
      statusCode: 200,
      body: JSON.stringify({
        title,
        content,
        keyword,
      }),
    };
  } catch (error) {
    console.error("generate-article エラー:", error);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: (error as Error).message }),
    };
  }
};
