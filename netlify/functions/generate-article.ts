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


    // ✅ ここを追加！
const relatedKeywordsText =
  Array.isArray(related_keywords) && related_keywords.length > 0
    ? related_keywords.join("、")
    : keyword;

    // ✅ AI設定の値を変数にしておくと安全
const tone = aiConfig.tone || "ナチュラル";
const style = aiConfig.style || "ブログ風";
const article_length = aiConfig.article_length || "中程度";
    
const prompt = `あなたはプロのSEOライターです。以下の条件で日本語の記事を作成してください。

条件
記事の中心テーマ（関連キーワード群）: ${relatedKeywordsText}
トーン: ${tone}
スタイル: ${style}
ボリューム目安: ${article_length}

構成とHTMLルール
1. タイトルは <h2> タグを使わず、"title" フィールドに文字列として出力。
2. 本文 ("content") は <h3> から始める。
3. 下層に進む場合は <h4> → <h5> → <h6> と階層順に使用。
4. <h1> は使わない。<h2> はタイトル以外に使わない。
5. 最後に <h3>まとめ</h3><p>…</p> を入れる。

出力形式（JSONのみ）
{
  "title": "タイトル（文字列のみ。タグは不要）",
  "content": "<h3>...</h3><p>...</p><h4>...</h4><p>...</p><h3>まとめ</h3><p>...</p>"
}

注意点
- 関連キーワードを主軸に構成（メインキーワードは自然に含める）。
- 見出し階層は論理的に。
- JSON以外の出力は禁止。`;

    // 👇 ここを追加！
    console.log("🧠 実際にGeminiへ送信されるプロンプト ↓↓↓");
    console.log(prompt);
    console.log("↑↑↑ ここまでが送信プロンプト");


    let generatedText = "";

    // === AIプロバイダごとに分岐 ===
    switch ((aiConfig.provider || "").toLowerCase()) {
      // --- Gemini対応（"Gemini" または "Google Gemini" どちらでもOK）---
      case "gemini":
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
