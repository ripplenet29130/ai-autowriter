// ===============================================
// aiEngine.ts
// すべてのAIロジック（中心テーマ抽出・プロンプト生成・API呼び出し）
// ===============================================

import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  import.meta.env.VITE_SUPABASE_URL!,
  import.meta.env.VITE_SUPABASE_SERVICE_KEY!
);

/* -----------------------------------------------
  プロンプト生成（中心テーマのみ使用）
------------------------------------------------ */
export function buildUnifiedPrompt(center, aiConfig) {
  const tone = aiConfig.tone || "ナチュラル";
  const style = aiConfig.style || "ブログ風";
  const length = aiConfig.article_length || "中程度";
  const language = aiConfig.language || "ja";

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

【記事の中心テーマ（最重要）】
${center}

※この記事は上記テーマ1つだけを深く掘り下げてください。
※他の関連話題には触れなくてもよい。

【文体トーン】
${tone}

【スタイル】
${style}

【ボリューム】
${length}

# HTMLルール
1. 出力は JSON のみ
2. JSON は "title" と "content" の2フィールドのみ
3. title はテキストのみ（HTMLタグ禁止）
4. content は <h3> から開始する
5. <h1>, <h2>, <h5>, <h6> は使用禁止
6. 段落は <p>...</p> を使い、1段落2〜3文にする
7. 改行文字（\\n, \n）、コードブロック（\`\`\`）は禁止
8. 最後に <h3>まとめ</h3><p>...</p> を付ける

# 出力形式（これのみ）
{
  "title": "タイトル",
  "content": "<h3>...</h3><p>...</p>"
}
`;
}

/* -----------------------------------------------
  AIプロバイダ共通呼び出し
------------------------------------------------ */
export async function callAI(aiConfig, prompt) {
  const provider = (aiConfig.provider || "").toLowerCase();
  let text = "";

  // ---------- Gemini ----------
  if (provider.includes("gemini")) {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${aiConfig.model}:generateContent?key=${aiConfig.api_key}`,
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
  }

  // ---------- OpenAI ----------
  else if (provider.includes("openai")) {
    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${aiConfig.api_key}`
      },
      body: JSON.stringify({
        model: aiConfig.model,
        messages: [{ role: "user", content: prompt }],
        temperature: aiConfig.temperature ?? 0.7,
        max_tokens: aiConfig.max_tokens ?? 4000
      })
    });
    const data = await res.json();
    text = data?.choices?.[0]?.message?.content || "";
  }

  // ---------- Claude ----------
  else if (provider.includes("claude")) {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": aiConfig.api_key,
        "anthropic-version": "2023-06-01"
      },
      body: JSON.stringify({
        model: aiConfig.model,
        messages: [{ role: "user", content: prompt }],
        temperature: aiConfig.temperature ?? 0.7,
        max_tokens: aiConfig.max_tokens ?? 4000
      })
    });
    const data = await res.json();
    text = data?.content?.[0]?.text || "";
  }

  return text;
}

/* -----------------------------------------------
  JSON抽出＋成形
------------------------------------------------ */
export function parseArticle(rawText) {
  const match = rawText.match(/\{[\s\S]*\}/);
  if (!match) throw new Error("JSON構造が見つかりませんでした");

  const article = JSON.parse(match[0]);

  article.content = article.content
    .replace(/\\n|\\r|\\t/g, "")
    .replace(/\n+/g, "")
    .trim();

  return article;
}

