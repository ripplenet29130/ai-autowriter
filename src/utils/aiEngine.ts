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
  if (length.includes("2000")) {
    return `【文字数制限（厳守）】
・本文は必ず2000〜2300文字以内に収めてください
・文字数はHTMLタグを含めてカウントします
・2000文字未満または2300文字を超えた場合は修正対象となります
・見出し数を調整して文字数をコントロールしてください
・冗長な表現は避け、核心を明確に記述してください`;
  }
  if (length.includes("1000")) {
    return `【文字数制限（厳守）】
・本文は必ず1000〜1500文字以内に収めてください
・文字数はHTMLタグを含めてカウントします
・1000文字未満または1500文字を超えた場合は修正対象となります
・見出し数を調整して文字数をコントロールしてください
・冗長な表現は避け、核心を明確に記述してください`;
  }
  if (length.includes("500")) {
    return `【文字数制限（厳守）】
・本文は必ず500〜800文字以内に収めてください
・文字数はHTMLタグを含めてカウントします
・500文字未満または800文字を超えた場合は修正対象となります
・見出し数を調整して文字数をコントロールしてください
・冗長な表現は避け、核心を明確に記述してください`;
  }
  return `【文字数制限（厳守）】
・本文は必ず1000〜2000文字以内に収めてください
・文字数はHTMLタグを含めてカウントします
・1000文字未満または2000文字を超えた場合は修正対象となります
・見出し数を調整して文字数をコントロールしてください
・冗長な表現は避け、核心を明確に記述してください`;
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

  // 短縮版プロンプト（タイムアウト対策 + 文字数厳守 + Markdown禁止）
  return `あなたはSEO記事を書くプロライターです。日本語で記事を書いてください。

【テーマ】${center}

【参考情報】${factsText}

【ルール】
${lengthRule}
・事実に基づいて正確に書く
・JSON以外の出力は禁止
・Markdown記法（\`\`\`jsonなど）は使用しない
・JSONを直接出力する
・指定文字数を必ず厳守してください

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
    // Gemini用はタイムアウトをかけない
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${aiConfig.model}:generateContent?key=${aiConfig.api_key}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: {
            temperature: aiConfig.temperature ?? 0.5,
            maxOutputTokens: aiConfig.max_tokens ?? 4000, // 文字数制限を守らせるため適切なトークン数に制限
          },
        }),
      }
    );

    if (!res.ok) {
      const errorText = await res.text().catch(() => "Unknown error");
      throw new Error(`Gemini API Error: ${errorText}`);
    }

    const data = await res.json();
    const text = data?.candidates?.[0]?.content?.parts?.[0]?.text || "";
    if (!text.trim()) throw new Error("Gemini response empty");
    return text;
  }

  // --- OpenAI ---
  if (provider.includes("openai")) {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 20000); // 20秒タイムアウト

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
          max_tokens: aiConfig.max_tokens ?? 4000, // 文字数制限を守らせるため適切なトークン数に制限
        }),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!res.ok) {
        const errorText = await res.text().catch(() => "Unknown error");
        throw new Error(`OpenAI API Error: ${errorText}`);
      }

      const data = await res.json();
      const text = data?.choices?.[0]?.message?.content || "";
      if (!text.trim()) throw new Error("OpenAI response empty");
      return text;
    } catch (error) {
      if (error.name === 'AbortError') {
        throw new Error("AI応答がタイムアウトしました（20秒）");
      }
      throw error;
    }
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

  // Markdownのコードブロックを除去
  let cleanedText = rawText
    .replace(/^```json\s*/i, '')  // ```json を除去
    .replace(/^```\s*/i, '')      // ``` を除去
    .replace(/\s*```\s*$/i, '')   // 末尾の ``` を除去
    .trim();

  console.log("[parseArticle] クリーン後開始部分:", cleanedText.substring(0, 200));

  // より堅牢なJSON抽出
  let start = cleanedText.indexOf("{");
  if (start === -1) {
    throw new Error("JSON開始が見つかりません");
  }

  // JSONの終わりを探す（ネスト対応）
  let braceCount = 0;
  let end = -1;
  for (let i = start; i < cleanedText.length; i++) {
    if (cleanedText[i] === "{") {
      braceCount++;
    } else if (cleanedText[i] === "}") {
      braceCount--;
      if (braceCount === 0) {
        end = i;
        break;
      }
    }
  }

  if (end === -1 || braceCount !== 0) {
    console.log("[parseArticle] JSONが不完全ですが、可能な限り修復を試みます");
    console.log("[parseArticle] 不完全JSON:", cleanedText.substring(start, Math.min(start + 500, cleanedText.length)));

    // 不完全JSONの場合、最後の有効な位置までを使用
    if (braceCount > 0) {
      // 開きカッコが多い場合、最後の閉じカッコを探す
      const lastClosingBrace = cleanedText.lastIndexOf('}');
      if (lastClosingBrace > start) {
        end = lastClosingBrace;
        console.log("[parseArticle] 最終閉じカッコ位置を使用:", end);
      } else {
        throw new Error("JSON構造が修復不可能です");
      }
    }
  }

  const jsonString = cleanedText.slice(start, end + 1);
  console.log("[parseArticle] 抽出JSON長:", jsonString.length);

  let article;
  try {
    article = JSON.parse(jsonString);
  } catch (e) {
    console.error("[parseArticle] JSONパースエラー:", e);
    console.error("[parseArticle] 問題JSON:", jsonString);

    // 複数の修復方法を試行
    const repairAttempts = [
      // 1. カンマ修復
      (str: string) => str
        .replace(/,\s*}/g, "}")  // 末尾のカンマを除去
        .replace(/{\s*,/g, "{")  // 先頭のカンマを除去
        .replace(/,\s*]/g, "]")  // 配列の末尾カンマを除去
        .replace(/\[\s*,/g, "["), // 配列の先頭カンマを除去

      // 2. 不完全なJSONに閉じカッコを追加
      (str: string) => {
        const openBraces = (str.match(/{/g) || []).length;
        const closeBraces = (str.match(/}/g) || []).length;
        if (openBraces > closeBraces) {
          return str + '}'.repeat(openBraces - closeBraces);
        }
        return str;
      },

      // 3. HTMLタグの不完全修復
      (str: string) => str.replace(/<[^>]*$/g, ''), // 不完全なHTMLタグを除去
    ];

    for (let i = 0; i < repairAttempts.length; i++) {
      const repaired = repairAttempts[i](jsonString);
      if (repaired !== jsonString) {
        console.log(`[parseArticle] JSON修復方法${i + 1}を試行`);
        try {
          article = JSON.parse(repaired);
          console.log(`[parseArticle] JSON修復成功（方法${i + 1}）`);
          break;
        } catch (repairError) {
          console.log(`[parseArticle] 修復方法${i + 1}失敗:`, repairError.message);
        }
      }
    }

    if (!article) {
      throw new Error("JSONパースに失敗しました");
    }
  }

  // 最低限の構造チェックと修復
  if (!article) {
    throw new Error("記事データが取得できませんでした");
  }

  if (typeof article.title !== "string" || !article.title.trim()) {
    console.warn("[parseArticle] titleが不正のためデフォルト値を設定");
    article.title = "記事タイトル";
  }

  if (typeof article.content !== "string" || !article.content.trim()) {
    console.warn("[parseArticle] contentが不正のためデフォルト値を設定");
    article.content = "<p>記事の内容を読み込み中です。</p>";
  }

  // title/contentが存在することを確認
  if (!article.title || !article.content) {
    throw new Error("titleまたはcontentが空です");
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
