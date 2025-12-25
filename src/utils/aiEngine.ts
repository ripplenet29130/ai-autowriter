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
  共通：言語設定取得
------------------------------------------------ */
function getLanguageSettings(language: string) {
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

  return { langLabel, langNote };
}

/* -----------------------------------------------
  共通：ハルシネーション防止
------------------------------------------------ */
function getHallucinationPreventionRules() {
  return `【ハルシネーション防止・事実性ルール（最重要）】
・事実として断定できない内容は創作しない
・存在しない制度、法律、数値、実績は記載しない
・不確かな内容は「一般的に」「場合によって異なります」と表現する
・断定的な数値・日付・実績は使用しない`;
}

/* -----------------------------------------------
  facts の扱いルール
------------------------------------------------ */
function getFactsHandlingRules() {
  return `【検索情報（facts）の扱いルール（最重要）】
・facts に含まれる情報のみを根拠として使用する
・facts に含まれない事実は創作しない
・不足している場合は一般論として安全に曖昧化する`;
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
6. 段落は <p>、一文ごとに <br>
7. 改行文字・コードブロック禁止
8. 最後に <h3>まとめ</h3><p>...</p> を付ける`;
}

/* -----------------------------------------------
  出力形式（JSON完全強制）
------------------------------------------------ */
function getOutputFormat() {
  return `【出力形式（厳守・最重要）】

以下のJSONのみを出力してください。
JSON以外の文字が1文字でも含まれてはいけません。
説明文・注意文・空行・記号・コードブロックは禁止です。

{
  "title": "タイトル文字列",
  "content": "<p>リード文1。<br>文2。<br>文3。</p><p>つかみ文1。<br>文2。<br>文3。</p><h3>見出し</h3><p>本文文1。<br>文2。</p><h3>まとめ</h3><p>まとめ文1。<br>文2。</p>"
}`;
}

/* -----------------------------------------------
  プロンプト生成（centerのみ）
------------------------------------------------ */
export function buildUnifiedPrompt(center: string, aiConfig: any) {
  const tone = aiConfig.tone || "ナチュラル";
  const style = aiConfig.style || "ブログ風";
  const length = aiConfig.article_length || "中程度";
  const language = aiConfig.language || "ja";

  const { langLabel } = getLanguageSettings(language);

  return `
あなたはSEOに強いプロライターです。
以下の条件で${langLabel}の記事を作成してください。

${getHallucinationPreventionRules()}

【記事テーマ】
${center}

【文体】
${tone}

【スタイル】
${style}

【ボリューム】
${length}

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
  const tone = aiConfig.tone || "ナチュラル";
  const style = aiConfig.style || "ブログ風";
  const length = aiConfig.article_length || "中程度";
  const language = aiConfig.language || "ja";

  const { langLabel } = getLanguageSettings(language);

  // 🔒 関連性の低い facts を除外（超重要）
  // ここは必要に応じて条件を増やしてください
  const safeFacts = (facts || []).filter((f) => {
    const s = (f?.source || "").toLowerCase();
    return s.includes("nagoya") || s.includes("bus") || s.includes("kotsu") || s.includes("観光");
  });

  const factsText = safeFacts.map((f, i) => `${i + 1}. ${f.content}`).join("\n");

  return `
あなたはSEOおよびAIOに精通した専門ライターです。
以下の条件で${langLabel}の記事を作成してください。

${getFactsHandlingRules()}

${getHallucinationPreventionRules()}

【記事テーマ】
${center}

【事実情報（この情報のみ使用可）】
${factsText}

【文体】
${tone}

【スタイル】
${style}

【ボリューム】
${length}

${getHTMLRules()}

${getOutputFormat()}
`;
}

/* -----------------------------------------------
  AI 呼び出し（Gemini / OpenAI / Claude）
------------------------------------------------ */
export async function callAI(aiConfig: any, prompt: string) {
  const provider = (aiConfig.provider || "").toLowerCase();
  let text = "";

  // Gemini
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
          },
        }),
      }
    );
    const data = await res.json();
    text = data?.candidates?.[0]?.content?.parts?.[0]?.text || "";
  }

  // OpenAI
  else if (provider.includes("openai")) {
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
        max_tokens: aiConfig.max_tokens ?? 4000,
      }),
    });
    const data = await res.json();
    text = data?.choices?.[0]?.message?.content || "";
  }

  // Claude
  else if (provider.includes("claude")) {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": aiConfig.api_key,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: aiConfig.model,
        messages: [{ role: "user", content: prompt }],
        temperature: aiConfig.temperature ?? 0.5,
        max_tokens: aiConfig.max_tokens ?? 4000,
      }),
    });
    const data = await res.json();
    text = data?.content?.[0]?.text || "";
  }

  return text;
}

/* -----------------------------------------------
  JSON抽出・整形
------------------------------------------------ */
export function parseArticle(rawText: string) {
  const match = rawText.match(/\{[\s\S]*\}/);
  if (!match) {
    console.error("🧠 AI RAW OUTPUT:", rawText);
    throw new Error("JSON構造が見つかりませんでした");
  }

  const article = JSON.parse(match[0]);

  if (typeof article?.title !== "string" || typeof article?.content !== "string") {
    console.error("🧠 PARSED JSON:", article);
    throw new Error("JSONは取得できましたが、title/content が不正です");
  }

  article.content = article.content
    .replace(/\\n|\\r|\\t/g, "")
    .replace(/\n+/g, "")
    .trim();

  return article;
}

/* -----------------------------------------------
  事実性エラー時の「書き直し」プロンプト
  ※ generateArticle.ts が import しているため export 必須
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
・facts に基づかない内容は削除または一般化する
・断定表現は避ける
・構成は大きく変えない
・出力は必ず JSON のみ（title/content のみ）

【出力形式（厳守）】
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
