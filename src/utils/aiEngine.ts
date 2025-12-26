// ===============================================
// aiEngine.ts（安定版）
// ===============================================

import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!
);

/* -----------------------------------------------
  ハルシネーション防止
------------------------------------------------ */
function hallucinationRules() {
  return `
【事実性ルール】
・不確かな情報は断定しない
・存在しない制度・数値・実績は書かない
・曖昧な場合は「一般的に」「〜とされています」と表現する
`;
}

/* -----------------------------------------------
  HTML / JSON ルール
------------------------------------------------ */
function outputRules() {
  return `
【出力ルール】
・出力は JSON のみ
・キーは title, content の2つだけ
・title はテキストのみ
・content は <p> と <h3> のみ使用
・段落内は1文ごとに <br><br>
・説明文、前置き、コードブロックは禁止
`;
}

/* -----------------------------------------------
  文字数指定
------------------------------------------------ */
function buildLengthInstruction(length: string) {
  if (length.includes("2000")) return "本文は2000〜2300文字で作成してください。";
  if (length.includes("1000")) return "本文は1000〜1500文字で作成してください。";
  if (length.includes("500")) return "本文は500〜800文字で作成してください。";
  return "本文は適切な分量で作成してください。";
}

/* -----------------------------------------------
  プロンプト生成（factsあり）
------------------------------------------------ */
export function buildUnifiedPromptWithFacts(
  center: string,
  facts: { source: string; content: string }[],
  aiConfig: any
) {
  const lengthRule = buildLengthInstruction(aiConfig.article_length || "");
  const factsText = facts.map((f, i) => `${i + 1}. ${f.content}`).join("\n");

  return `
あなたはSEO記事を書くプロライターです。
日本語で記事を書いてください。

【テーマ】
${center}

【参考情報】
${factsText}

${lengthRule}

${hallucinationRules()}

${outputRules()}

以下のJSONのみを出力してください。

{
  "title": "記事タイトル",
  "content": "<p>導入文。<br><br>続く文。</p><h3>見出し</h3><p>本文。</p><h3>まとめ</h3><p>まとめ。</p>"
}
`;
}

/* -----------------------------------------------
  AI 呼び出し（JSONモード不使用）
------------------------------------------------ */
export async function callAI(aiConfig: any, prompt: string) {
  const provider = (aiConfig.provider || "").toLowerCase();

  // --- Gemini ---
  if (provider.includes("gemini")) {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${aiConfig.model}:generateContent?key=${aiConfig.api_key}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: {
            temperature: aiConfig.temperature ?? 0.5,
            maxOutputTokens: aiConfig.max_tokens ?? 6000,
          },
        }),
      }
    );

    if (!res.ok) {
      throw new Error(`Gemini API Error: ${await res.text()}`);
    }

    const data = await res.json();
    const text = data?.candidates?.[0]?.content?.parts?.[0]?.text || "";
    if (!text.trim()) throw new Error("Gemini response empty");
    return text;
  }

  // --- OpenAI ---
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
        temperature: aiConfig.temperature ?? 0.5,
        max_tokens: aiConfig.max_tokens ?? 6000,
      }),
    });

    if (!res.ok) {
      throw new Error(`OpenAI API Error: ${await res.text()}`);
    }

    const data = await res.json();
    const text = data?.choices?.[0]?.message?.content || "";
    if (!text.trim()) throw new Error("OpenAI response empty");
    return text;
  }

  throw new Error("Unknown AI provider");
}

/* -----------------------------------------------
  JSON抽出（最小・安全）
------------------------------------------------ */
export function parseArticle(rawText: string) {
  const start = rawText.indexOf("{");
  const end = rawText.lastIndexOf("}");

  if (start === -1 || end === -1 || end <= start) {
    throw new Error("JSON構造が見つかりませんでした");
  }

  const jsonString = rawText.slice(start, end + 1);
  const article = JSON.parse(jsonString);

  if (typeof article.title !== "string" || typeof article.content !== "string") {
    throw new Error("title/content が不正です");
  }

  article.content = article.content
    .replace(/\n|\r|\t/g, "")
    .trim();

  return article;
}

/* -----------------------------------------------
  リライト用プロンプト
------------------------------------------------ */
export function buildRewritePrompt(
  article: { title: string; content: string },
  reasons: string[]
) {
  return `
以下の記事を修正してください。

【修正理由】
${reasons.map(r => `- ${r}`).join("\n")}

${outputRules()}

{
  "title": "修正後タイトル",
  "content": "<p>修正文。</p><h3>見出し</h3><p>本文。</p><h3>まとめ</h3><p>まとめ。</p>"
}

【元記事】
${article.title}
${article.content}
`;
}
