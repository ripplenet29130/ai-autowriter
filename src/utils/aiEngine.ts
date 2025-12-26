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

  // 短縮版プロンプト（タイムアウト対策）
  return `あなたはSEO記事を書くプロライターです。日本語で記事を書いてください。

【テーマ】${center}

【参考情報】${factsText}

【ルール】
${lengthRule}
・事実に基づいて正確に書く
・JSON以外の出力は禁止

以下のJSONのみを出力してください。
{"title": "記事タイトル", "content": "<p>本文</p><h3>見出し</h3><p>内容</p>"}`;
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
            maxOutputTokens: aiConfig.max_tokens ?? 4000, // タイムアウト対策で制限
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
          max_tokens: aiConfig.max_tokens ?? 4000, // タイムアウト対策で制限
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
// 改善版parseArticle（タイムアウト対策有効化）
export function parseArticle(rawText: string) {
  // デバッグ用ログ（本番では削除可能）
  console.log("[parseArticle] 入力長:", rawText.length);
  console.log("[parseArticle] 開始部分:", rawText.substring(0, 200));

  // より堅牢なJSON抽出
  let start = rawText.indexOf("{");
  if (start === -1) {
    throw new Error("JSON開始が見つかりません");
  }

  // JSONの終わりを探す（ネスト対応）
  let braceCount = 0;
  let end = -1;
  for (let i = start; i < rawText.length; i++) {
    if (rawText[i] === "{") {
      braceCount++;
    } else if (rawText[i] === "}") {
      braceCount--;
      if (braceCount === 0) {
        end = i;
        break;
      }
    }
  }

  if (end === -1 || braceCount !== 0) {
    console.error("[parseArticle] 不完全JSON:", rawText.substring(start, Math.min(start + 500, rawText.length)));
    throw new Error("JSON構造が不完全です");
  }

  const jsonString = rawText.slice(start, end + 1);
  console.log("[parseArticle] 抽出JSON長:", jsonString.length);

  let article;
  try {
    article = JSON.parse(jsonString);
  } catch (e) {
    console.error("[parseArticle] JSONパースエラー:", e);
    console.error("[parseArticle] 問題JSON:", jsonString);

    // 簡易的なJSON修復を試みる
    const repaired = jsonString
      .replace(/,\s*}/g, "}")  // 末尾のカンマを除去
      .replace(/{\s*,/g, "{"); // 先頭のカンマを除去

    if (repaired !== jsonString) {
      console.log("[parseArticle] JSON修復を試行");
      try {
        article = JSON.parse(repaired);
        console.log("[parseArticle] JSON修復成功");
      } catch (repairError) {
        throw new Error("JSONパースに失敗しました");
      }
    } else {
      throw new Error("JSONパースに失敗しました");
    }
  }

  if (!article || typeof article.title !== "string" || typeof article.content !== "string") {
    throw new Error("title/content が不正です");
  }

  // HTMLクリーンアップ
  article.content = article.content
    .replace(/\n|\r|\t/g, "")
    .trim();

  console.log("[parseArticle] パース成功:", article.title.substring(0, 50) + "...");
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
