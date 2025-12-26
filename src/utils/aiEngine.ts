// ===============================================
// aiEngine.ts（文字数安定・最終版）
// ===============================================

import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!
);

/* -----------------------------------------------
  文字数ルール（厳守）
------------------------------------------------ */
function buildLengthRule(length: string) {
  if (length.includes("2000")) {
    return `
【文字数条件（厳守）】
・本文は必ず【2000〜2300文字】に収めてください
・この範囲を外れた場合は失敗です
・冗長な説明は削除し、文字数を調整してください

【構成ルール】
・h3見出しは必ず4つ
・各見出しは400〜450文字程度
`;
  }

  if (length.includes("1000")) {
    return `
【文字数条件（厳守）】
・本文は必ず【1000〜1500文字】に収めてください
・この範囲を外れた場合は失敗です

【構成ルール】
・h3見出しは必ず3つ
・各見出しは250〜300文字程度
`;
  }

  if (length.includes("500")) {
    return `
【文字数条件（厳守）】
・本文は必ず【500〜800文字】に収めてください
・この範囲を外れた場合は失敗です

【構成ルール】
・h3見出しは必ず2つ
・各見出しは150〜200文字程度
`;
  }

  return `
【文字数条件（厳守）】
・本文は必ず【1200〜1800文字】に収めてください
・この範囲を外れた場合は失敗です
`;
}

/* -----------------------------------------------
  プロンプト生成（factsあり）
------------------------------------------------ */
export function buildUnifiedPromptWithFacts(
  center: string,
  facts: { source: string; content: string }[],
  aiConfig: any
) {
  const lengthRule = buildLengthRule(aiConfig.article_length || "");
  const factsText = facts.map((f, i) => `${i + 1}. ${f.content}`).join("\n");

  return `
あなたはSEOに強いプロの日本語ライターです。

【テーマ】
${center}

【参考情報】
${factsText}

${lengthRule}

【出力ルール（厳守）】
・出力は JSON のみ
・キーは title, content の2つだけ
・title はテキストのみ
・content は <p> と <h3> のみ使用
・段落内は1文ごとに <br><br>
・Markdown、説明文、前置きは禁止

【最終チェック】
・出力前に必ず本文の文字数を確認してください
・指定範囲に収まらない場合は削除または補足して調整してください

以下の JSON のみを出力してください。
{
  "title": "記事タイトル",
  "content": "<p>導入文</p><h3>見出し</h3><p>本文</p><h3>まとめ</h3><p>まとめ</p>"
}
`;
}

/* -----------------------------------------------
  AI 呼び出し
------------------------------------------------ */
export async function callAI(aiConfig: any, prompt: string) {
  const provider = (aiConfig.provider || "").toLowerCase();

  // ===== Gemini =====
  if (provider.includes("gemini")) {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${aiConfig.model}:generateContent?key=${aiConfig.api_key}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: {
            temperature: aiConfig.temperature ?? 0.4,
            maxOutputTokens: aiConfig.max_tokens ?? 3500,
          },
        }),
      }
    );

    if (!res.ok) {
      const t = await res.text();
      throw new Error(`Gemini API Error: ${t}`);
    }

    const data = await res.json();
    const text = data?.candidates?.[0]?.content?.parts?.[0]?.text || "";
    if (!text.trim()) throw new Error("Gemini response empty");
    return text;
  }

  // ===== OpenAI =====
  if (provider.includes("openai")) {
    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${aiConfig.api_key}`,
      },
      body: JSON.stringify({
        model: aiConfig.model,
        messages: [{ role: "user", content: prompt }],
        temperature: aiConfig.temperature ?? 0.4,
        max_tokens: aiConfig.max_tokens ?? 3500,
      }),
    });

    if (!res.ok) {
      const t = await res.text();
      throw new Error(`OpenAI API Error: ${t}`);
    }

    const data = await res.json();
    const text = data?.choices?.[0]?.message?.content || "";
    if (!text.trim()) throw new Error("OpenAI response empty");
    return text;
  }

  throw new Error("Unknown AI provider");
}

/* -----------------------------------------------
  JSONパース（最小・安定）
------------------------------------------------ */
export function parseArticle(rawText: string) {
  // ```json 対策
  const cleaned = rawText
    .replace(/^```json/i, "")
    .replace(/^```/i, "")
    .replace(/```$/i, "")
    .trim();

  const start = cleaned.indexOf("{");
  if (start === -1) throw new Error("JSON開始が見つかりません");

  let brace = 0;
  let end = -1;

  for (let i = start; i < cleaned.length; i++) {
    if (cleaned[i] === "{") brace++;
    if (cleaned[i] === "}") {
      brace--;
      if (brace === 0) {
        end = i;
        break;
      }
    }
  }

  if (end === -1) throw new Error("JSON終了が見つかりません");

  const json = cleaned.slice(start, end + 1);
  const article = JSON.parse(json);

  if (!article.title || !article.content) {
    throw new Error("title/content 不正");
  }

  article.content = article.content.replace(/\n|\r|\t/g, "").trim();
  return article;
}

/* -----------------------------------------------
  リライト用
------------------------------------------------ */
export function buildRewritePrompt(
  article: { title: string; content: string },
  reasons: string[]
) {
  return `
以下の記事を修正してください。

【修正理由】
${reasons.map(r => `- ${r}`).join("\n")}

【出力条件】
・JSONのみ
・title, contentのみ
・文字数条件は元記事と同じ

{
  "title": "修正後タイトル",
  "content": "<p>修正文</p><h3>見出し</h3><p>本文</p><h3>まとめ</h3><p>まとめ</p>"
}

【元記事】
${article.title}
${article.content}
`;
}
