// ===============================================
// aiEngine.ts
// すべてのAIロジック（中心テーマ抽出・プロンプト生成・API呼び出し）
// ===============================================

import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!
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

    // 言語-specific NOTE（自然な翻訳の補足指示）
  const langNote =
    language === "ja"
      ? "自然で読みやすい日本語で書いてください。"
      : language === "en"
      ? "Write in natural, fluent, and readable English for a general audience."
      : language === "zh"
      ? "请使用自然、流畅、易读的简体中文撰写文章。"
      : language === "ko"
      ? "자연스럽고 읽기 쉬운 한국어로 작성해주세요."
      : "自然で読みやすい日本語で書いてください。";
  
  return `
あなたはSEOに強いプロのライターです。
以下の条件で${langLabel}の記事を作成してください。

【記事の中心テーマ（最重要）】
${center}
※この記事は上記テーマ1つだけを深く掘り下げてください。
※他の関連話題には触れなくてよい。

【文体トーン】
${tone}

【スタイル】
${style}

【ボリューム】
${length}

【追加指示（重要）】

■ リード文（導入）
・250〜300字
・2〜3文で構成し、段落内は一文ごとに <br> を入れる
・読者が興味を持つ背景・問題提起・内容の要約を書く

■ つかみ（本文への導入）
・2〜3文で構成
・段落内は一文ごとに <br> を入れる
・続きを読みたくなる期待感を高める内容にする

■ 本文構成
・<h3> から本文を開始する
・各説明パートは 2〜3文で1段落
・段落内の一文ごとに <br> を必ず入れる

【HTMLルール】

 1. 出力は JSON のみ
 2. JSON は "title" と "content" の2フィールドのみ
 3. title はテキストのみ（HTMLタグ禁止）
 4. content は <p>...</p> のあとに <h3> を続ける
 5. <h1>, <h2>, <h5>, <h6> は使用禁止
 6. 段落は必ず <p> で囲み、一文ごとに <br> を入れる
 7. 改行文字（\n, \n）、コードブロック（```）は禁止
 8. 最後に <h3>まとめ</h3><p>...</p> を付ける

【出力形式（これのみ）】

{
"title": "タイトル",
"content": "<p>リード文文1。<br>文2。<br>文3。</p><p>つかみ文1。<br>文2。<br>文3。</p><h3>見出し</h3><p>本文文1。<br>文2。</p><h3>まとめ</h3><p>まとめ文1。<br>文2。</p>"
}`;
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

