import { createClient } from "@supabase/supabase-js";
import type { Handler } from "@netlify/functions";

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!
);

/* =========================================================
   ① 中心テーマだけで記事を生成するプロンプト生成関数
   ========================================================= */
function buildUnifiedPrompt({
  center,
  tone,
  style,
  length,
  language
}) {
  const langLabel =
    language === "ja"
      ? "日本語"
      : language === "en"
      ? "英語"
      : language === "zh"
      ? "中国語"
      : language === "ko"
      ? "韓国語"
      : "日本語";

  return `
あなたはSEOに強いプロのライターです。
以下の条件で${langLabel}の記事を作成してください。

【記事の中心テーマ】
${center}

※この記事は上記「中心テーマ」1つだけを深掘りする内容にしてください。
※関連語や他の話題には触れなくても良い。
※専門的で正確だが、一般読者にも読みやすい構成にする。

【トーン】
${tone}

【スタイル】
${style}

【ボリューム】
${length}

# HTMLルール
1. 出力形式は JSON のみ
2. JSON には "title" と "content" の2フィールドのみ
3. title はテキストのみ（タグ禁止）
4. content は <h3> から開始
5. セクション区切りは <h3>、補足は <h4>
6. <h1>, <h2>, <h5>, <h6> は禁止
7. 段落は必ず <p>…</p> で書き、1段落は 2〜3 文
8. 改行文字（\\n, \n）、コードブロック（\`\`\`）は禁止
9. 最後に <h3>まとめ</h3><p>...</p> を追加すること

# 出力形式（必ずこれのみ）
{
  "title": "タイトル",
  "content": "<h3>...</h3><p>...</p>"
}

JSON以外の余分なテキストは出力しないこと。
`;
}

/* =========================================================
   ② AI呼び出し（Gemini / OpenAI / Claude）
   ========================================================= */
async function runAIModel(aiConfig, prompt) {
  const provider = (aiConfig.provider || "").toLowerCase();
  let text = "";

  switch (provider) {
    case "gemini":
    case "google gemini": {
      const key = aiConfig.api_key;
      const model = aiConfig.model || "gemini-2.5-flash";

      const res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            contents: [{ parts: [{ text: prompt }] }],
            generationConfig: {
              temperature: aiConfig.temperature ?? 0.7,
              maxOutputTokens: aiConfig.max_tokens ?? 4000
            }
          })
        }
      );
      const data = await res.json();
      text = data?.candidates?.[0]?.content?.parts?.[0]?.text || "";
      break;
    }

    case "openai": {
      const key = aiConfig.api_key;
      const model = aiConfig.model || "gpt-4o-mini";

      const res = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${key}`
        },
        body: JSON.stringify({
          model,
          messages: [{ role: "user", content: prompt }],
          temperature: aiConfig.temperature ?? 0.7,
          max_tokens: aiConfig.max_tokens ?? 4000
        })
      });
      const data = await res.json();
      text = data?.choices?.[0]?.message?.content || "";
      break;
    }

    case "anthropic claude": {
      const key = aiConfig.api_key;
      const model = aiConfig.model || "claude-3-sonnet-20240229";

      const res = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": key,
          "anthropic-version": "2023-06-01"
        },
        body: JSON.stringify({
          model,
          messages: [{ role: "user", content: prompt }],
          max_tokens: aiConfig.max_tokens ?? 4000,
          temperature: aiConfig.temperature ?? 0.7
        })
      });
      const data = await res.json();
      text = data?.content?.[0]?.text || "";
      break;
    }

    default:
      throw new Error(`未対応のAIプロバイダ: ${aiConfig.provider}`);
  }

  return text;
}

/* =========================================================
   ③ メインハンドラー（generate-article）
   ========================================================= */
export const handler: Handler = async (event) => {
  try {
    const { ai_config_id, keyword, related_keywords, wp_url } =
      JSON.parse(event.body || "{}");

    if (!ai_config_id || !keyword) {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: "パラメータが不足しています" })
      };
    }

    // 🔍 AI設定取得
    const { data: aiConfig, error } = await supabase
      .from("ai_configs")
      .select("*")
      .eq("id", ai_config_id)
      .single();

    if (error || !aiConfig) throw new Error("AI設定の取得に失敗しました");

    // 🔥 “中心テーマ”を related_keywords から1つ抽出
    const center =
      Array.isArray(related_keywords) && related_keywords.length > 0
        ? related_keywords[Math.floor(Math.random() * related_keywords.length)]
        : keyword;

    // 🔥 プロンプト生成（中心テーマのみ）
    const prompt = buildUnifiedPrompt({
      center,
      tone: aiConfig.tone,
      style: aiConfig.style,
      length: aiConfig.article_length,
      language: aiConfig.language || "ja"
    });

    console.log("🧠 実行プロンプト：");
    console.log(prompt);

    // 🔥 AI生成
    const raw = await runAIModel(aiConfig, prompt);

    // 🔍 JSON抽出
    const match = raw.match(/\{[\s\S]*\}/);
    if (!match) throw new Error("JSON構造が見つかりませんでした");

    const article = JSON.parse(match[0]);

    // 🔧 不要な改行削除
    article.content = article.content
      .replace(/\\n|\\r|\\t/g, "")
      .replace(/\n+/g, "")
      .replace(/\s{2,}/g, " ")
      .trim();

    return {
      statusCode: 200,
      body: JSON.stringify({
        title: article.title,
        content: article.content,
        keyword: center, // ←中心テーマを返す
        post_url: `${wp_url?.replace(/\/$/, "")}/`
      })
    };
  } catch (e) {
    console.error("❌ generate-article エラー:", e);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: e.message })
    };
  }
};
