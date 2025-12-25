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
  return `【ハルシネーション防止・事実性ルール】
・事実として断定できない内容は創作しない
・存在しない制度、法律、数値、実績は記載しない
・不確かな内容は「一般的に」「場合によって異なります」と表現する`;
}

/* -----------------------------------------------
  facts の扱いルール
------------------------------------------------ */
function getFactsHandlingRules() {
  return `【検索情報（facts）の扱いルール】
・facts に含まれる情報を参考に一般論として整理する
・facts に含まれない内容は断定しない
・情報が不足する場合は注意喚起として表現する`;
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
  return `【出力形式（厳守）】

以下のJSONのみを出力してください。
JSON以外の文字を含めてはいけません。

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
  プロンプト生成（facts 使用・フィルターなし）
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

【書き方の注意】
・参考情報をもとに一般的な解説を行う
・断定的な表現は避ける
・結論は最初に簡潔に述べる

【出力について】
・最終的に JSON 形式で出力してください
・形式は以下を参考にしてください

{
  "title": "タイトル",
  "content": "<p>導入文。<br>続く文。</p><h3>見出し</h3><p>本文。</p><h3>まとめ</h3><p>まとめ。</p>"
}
`;
}


/* -----------------------------------------------
  AI 呼び出し（Gemini / OpenAI / Claude）
  ※ エラーハンドリング強化版
------------------------------------------------ */
export async function callAI(aiConfig: any, prompt: string) {
  const provider = (aiConfig.provider || "").toLowerCase();
  let text = "";

  // 共通エラーハンドラー
  const handleApiError = async (res: Response, providerName: string) => {
    if (!res.ok) {
      const errorText = await res.text();
      console.error(`🚨 [${providerName}] API Error: ${res.status} ${res.statusText}`);
      console.error(`🚨 Error Body:`, errorText);
      throw new Error(`${providerName} API Error: ${res.status} - ${errorText}`);
    }
  };

  // --- Gemini ---
  if (provider.includes("gemini")) {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${aiConfig.model}:generateContent?key=${aiConfig.api_key}`;
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: {
          temperature: aiConfig.temperature ?? 0.5,
          maxOutputTokens: aiConfig.max_tokens ?? 4000,
          responseMimeType: "application/json" // ★Gemini 1.5系ならJSONモード推奨
        },
      }),
    });

    await handleApiError(res, "Gemini"); // エラーチェック

    const data = await res.json();
    // 安全に取得 & ブロック理由のログ出し
    if (data.promptFeedback?.blockReason) {
      console.error("🚨 Gemini Blocked:", data.promptFeedback);
    }
    text = data?.candidates?.[0]?.content?.parts?.[0]?.text || "";
  }

  // --- OpenAI ---
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
        response_format: { type: "json_object" } // ★JSONモード推奨
      }),
    });

    await handleApiError(res, "OpenAI"); // エラーチェック

    const data = await res.json();
    text = data?.choices?.[0]?.message?.content || "";
  }

  // --- Claude ---
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

    await handleApiError(res, "Claude"); // エラーチェック

    const data = await res.json();
    text = data?.content?.[0]?.text || "";
  }

  // ✅ 空レスポンス防止
  if (!text || !text.trim()) {
    console.error("🚨 AI Raw Response was empty or invalid structure.");
    throw new Error("AIのレスポンスが空でした（APIは成功しましたがテキストが含まれていません）");
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

  if (
    typeof article?.title !== "string" ||
    typeof article?.content !== "string"
  ) {
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
