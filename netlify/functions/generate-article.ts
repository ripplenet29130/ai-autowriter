// ===============================================
// generate-article.ts（本番投稿）
// → aiEngine.ts を呼び出すだけの薄い関数
// ===============================================

import type { Handler } from "@netlify/functions";
import { createClient } from "@supabase/supabase-js";

// 🔥 共通AIエンジンを読み込み
import {
  buildUnifiedPrompt,
  callAI,
  parseArticle,
} from "../../src/utils/aiEngine";

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!
);

export const handler: Handler = async (event) => {
  try {
    const body = JSON.parse(event.body || "{}");
    const { ai_config_id, keyword, related_keywords = [], wp_url } = body;

    if (!ai_config_id) {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: "AI設定IDがありません" }),
      };
    }

    // ------------------------------------------------------
    // ① AI設定取得
    // ------------------------------------------------------
    const { data: aiConfig, error: aiErr } = await supabase
      .from("ai_configs")
      .select("*")
      .eq("id", ai_config_id)
      .single();

    if (aiErr || !aiConfig) {
      throw new Error("AI設定の取得に失敗しました");
    }

    // ------------------------------------------------------
    // ② 中心テーマを抽出（related_keywords から 1つ）
    // ------------------------------------------------------
    const center =
      Array.isArray(related_keywords) && related_keywords.length > 0
        ? related_keywords[Math.floor(Math.random() * related_keywords.length)]
        : keyword; // fallback

    // ------------------------------------------------------
    // ③ プロンプト生成（中心テーマのみ）
    // ------------------------------------------------------
    const prompt = buildUnifiedPrompt(center, aiConfig);

    console.log("=== 送信プロンプト ===");
    console.log(prompt);

    // ------------------------------------------------------
    // ④ AIへ送信
    // ------------------------------------------------------
    const rawOutput = await callAI(aiConfig, prompt);

    console.log("=== AI 生出力 ===");
    console.log(rawOutput);

    // ------------------------------------------------------
    // ⑤ JSON解析
    // ------------------------------------------------------
    const article = parseArticle(rawOutput);

    // ------------------------------------------------------
    // ⑥ WordPress URL整形
    // ------------------------------------------------------
    const postUrl = `${wp_url?.replace(/\/$/, "")}/`;

    // ------------------------------------------------------
    // ⑦ レスポンス返却
    // ------------------------------------------------------
    return {
      statusCode: 200,
      body: JSON.stringify({
        title: article.title,
        content: article.content,
        center_keyword: center,
        post_url: postUrl,
      }),
    };
  } catch (err) {
    console.error("generate-article エラー:", err);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: (err as Error).message }),
    };
  }
};
