// ===============================================
// generate-article.ts（本番投稿）
// → aiEngine.ts を呼び出すだけの薄い関数
// ===============================================

import type { Handler } from "@netlify/functions";
import { createClient } from "@supabase/supabase-js";

// 🔥 共通AIエンジン
import {
  buildUnifiedPrompt,
  buildUnifiedPromptWithFacts,
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

    // 🟦 フロント側から送った「center」を受け取る
    const { ai_config_id, center, wp_url, facts } = body;

    if (!facts || !Array.isArray(facts) || facts.length === 0) {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: "facts がありません" }),
      };
    }


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
    // ② プロンプト生成（中心テーマはフロントからの center）
    // ------------------------------------------------------
    const prompt = buildUnifiedPromptWithFacts(center, facts, aiConfig);

    console.log("=== 送信プロンプト ===");
    console.log(prompt);

    // ------------------------------------------------------
    // ③ AIへ送信（引数順の修正）
    // ------------------------------------------------------
    const rawOutput = await callAI(aiConfig, prompt);

    console.log("=== AI 生出力 ===");
    console.log(rawOutput);

    // ------------------------------------------------------
    // ④ JSON を解析
    // ------------------------------------------------------
    const article = parseArticle(rawOutput);

    // ------------------------------------------------------
    // ⑤ WordPress URL 整形
    // ------------------------------------------------------
    const postUrl = `${wp_url?.replace(/\/$/, "")}/`;

    // ------------------------------------------------------
    // ⑥ レスポンス返却
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
