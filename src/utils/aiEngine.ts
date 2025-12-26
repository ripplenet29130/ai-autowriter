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
  共通：ハルシネーション防止
------------------------------------------------ */
function getHallucinationPreventionRules() {
  return `【ハルシネーション防止・事実性ルール】
・事実として断定できない内容は創作しない
・存在しない制度、法律、数値、実績は記載しない
・不確かな内容は「一般的に」「場合によって異なります」と表現する`;
}

/* -----------------------------------------------
  HTMLルール
------------------------------------------------ */
function getHTMLRules() {
  return `【HTMLルール】
1. 出力は JSON のみ
2. JSON は "title" と "content" のみ
3. title はテキストのみ
4. content は <p> → <h3> 構成
5. <h1><h2><h5><h6> 使用禁止
6. 段落は <p>、一文ごとに <br><br>（1文ごとに空行を入れる）
7. 改行文字・コードブロック禁止
8. 最後に <h3>まとめ</h3><p>...</p> を付ける`;
}

/* -----------------------------------------------
  出力形式（JSON完全強制）
------------------------------------------------ */
function getOutputFormat() {
  return `【出力形式（厳守）】

以下のJSONのみを出力してください。
JSON以外の文字を含めてはいけません。

{
  "title": "タイトル文字列",
  "content": "<p>導入文。<br>続く文。</p><h3>見出し</h3><p>本文。</p><h3>まとめ</h3><p>まとめ。</p>"
}`;
}

/* -----------------------------------------------
  文字数指定（Supabaseの値をそのまま解釈）
------------------------------------------------ */
function buildLengthInstruction(articleLength: string) {
  if (articleLength.includes("2000")) {
    return "本文は【2000～2300文字】で作成してください。";
  }
  if (articleLength.includes("1000")) {
    return "本文は【1000〜1500文字】で作成してください。";
  }
  if (articleLength.includes("500")) {
    return "本文は【500〜800文字】で作成してください。";
  }
  return "本文は適切な分量で作成してください。";
}

/* -----------------------------------------------
  プロンプト生成（centerのみ）
------------------------------------------------ */
export function buildUnifiedPrompt(center: string, aiConfig: any) {
  const language = aiConfig.language || "ja";
  const tone = aiConfig.tone || "ナチュラル";
  const style = aiConfig.style || "ブログ風";
  const articleLength = aiConfig.article_length || "";

  const lengthInstruction = buildLengthInstruction(articleLength);

  return `
あなたはSEOに強いプロライターです。
${language === "ja" ? "日本語" : language}で記事を作成してください。

${getHallucinationPreventionRules()}

【記事テーマ】
${center}

【文体】
${tone}

【スタイル】
${style}

【文字数条件】
${lengthInstruction}

${getHTMLRules()}

${getOutputFormat()}
`;
}

/* -----------------------------------------------
  プロンプト生成（facts 使用）
------------------------------------------------ */
export function buildUnifiedPromptWithFacts(
  center: string,
  facts: Array<{ source: string; content: string }>,
  aiConfig: any
) {
  const language = aiConfig.language || "ja";
  const articleLength = aiConfig.article_length || "";

  const lengthInstruction = buildLengthInstruction(articleLength);

  const factsText = (facts || [])
    .map((f, i) => `${i + 1}. ${f.content}`)
    .join("\n");

  return `
あなたはSEOに配慮したプロのライターです。
${language === "ja" ? "日本語" : language}で記事を書いてください。

【テーマ】
${center}

【参考情報】
${factsText || "一般的な公開情報を参考にしてください。"}

【文字数条件】
${lengthInstruction}

${getHTMLRules()}

【出力について】
・最終的に JSON 形式で出力してください
・JSON以外の文字は出力しないでください

{
  "title": "タイトル",
  "content": "<p>導入文。</p><h3>見出し</h3><p>本文。</p><h3>まとめ</h3><p>まとめ。</p>"
}
`;
}

/* -----------------------------------------------
  AI 呼び出し（Gemini / OpenAI / Claude）
------------------------------------------------ */
export async function callAI(aiConfig: any, prompt: string) {
  const provider = (aiConfig.provider || "").toLowerCase();
  let text = "";

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
            maxOutputTokens: aiConfig.max_tokens ?? 4000,
            responseMimeType: "application/json",
          },
        }),
      }
    );

    if (!res.ok) {
      const errorText = await res.text();
      throw new Error(`Gemini API Error: ${errorText}`);
    }

    const data = await res.json();
    text = data?.candidates?.[0]?.content?.parts?.[0]?.text || "";
  }

  if (!text || !text.trim()) {
    throw new Error("AIのレスポンスが空でした");
  }

  return text;
}

/* -----------------------------------------------
  JSON抽出・整形
------------------------------------------------ */
export function parseArticle(rawText: string) {
  const match = rawText.match(/\{[\s\S]*\}/);
  if (!match) {
    throw new Error("JSON構造が見つかりませんでした");
  }

  const article = JSON.parse(match[0]);

  if (typeof article.title !== "string" || typeof article.content !== "string") {
    throw new Error("title / content が不正です");
  }

  article.content = article.content.replace(/\\n|\\r|\\t/g, "").trim();
  return article;
}

/* -----------------------------------------------
  事実性エラー時の「書き直し」プロンプト
------------------------------------------------ */
export function buildRewritePrompt(
  article: { title: string; content: string },
  reasons: string[]
) {
  return `
以下の記事には事実性の問題があります。
指摘事項を修正してください。

【指摘内容】
${(reasons || []).map((r) => `- ${r}`).join("\n")}

【修正ルール】
・断定表現は避ける
・構成は大きく変えない
・出力は必ず JSON のみ

【出力形式】
{
  "title": "タイトル文字列",
  "content": "<p>...</p><h3>...</h3><p>...</p><h3>まとめ</h3><p>...</p>"
}

【記事】
タイトル：${article.title}
本文：
${article.content}
`;
}
