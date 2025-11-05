import type { Handler } from "@netlify/functions";
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.VITE_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY! // ← Service key 必須
);

export const handler: Handler = async (event) => {
  if (event.httpMethod !== "POST") {
    return {
      statusCode: 405,
      body: JSON.stringify({ error: "Method not allowed" }),
    };
  }

  try {
    const { keyword, ai_config_id } = JSON.parse(event.body || "{}");

    if (!keyword || !ai_config_id) {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: "Missing parameters" }),
      };
    }

    // ✅ SupabaseからAI設定を取得
    const { data: aiConfig, error: configError } = await supabase
      .from("ai_configs")
      .select("*")
      .eq("id", ai_config_id)
      .single();

    if (configError || !aiConfig) {
      console.error("AI設定取得エラー:", configError);
      return {
        statusCode: 404,
        body: JSON.stringify({ error: "AI設定が見つかりません" }),
      };
    }

    const model = aiConfig.model || "gemini-2.0-flash";
    const apiKey = aiConfig.api_key;
    const temperature = aiConfig.temperature ?? 0.7;
    const maxTokens = aiConfig.max_tokens ?? 4000;

    const prompt = `
あなたはSEOとトレンド分析の専門家です。
メインキーワード「${keyword}」に関連する検索意図別の複合キーワードを、
日本語で10個、短く・自然に提案してください。
余計な説明文や番号は不要です。
`;

    // ✅ Gemini API 呼び出し
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: { temperature, maxOutputTokens: maxTokens },
        }),
      }
    );

    const result = await response.json();

    if (!response.ok) {
      console.error("Gemini APIエラー:", result);
      return {
        statusCode: 500,
        body: JSON.stringify({ error: "Gemini API呼び出しに失敗しました" }),
      };
    }

    // ✅ テキストを配列化
    const text = result?.candidates?.[0]?.content?.parts?.[0]?.text || "";
    const related_keywords = text
      .split(/\n|、|,|・|-/)
      .map((s) => s.trim().replace(/^\d+\.\s*/, ""))
      .filter((s) => s.length > 0);

    return {
      statusCode: 200,
      body: JSON.stringify({
        keyword,
        related_keywords,
      }),
    };
  } catch (error) {
    console.error("内部エラー:", error);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: "Internal server error" }),
    };
  }
};
