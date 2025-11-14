// ===============================================
// generateArticle.ts（プレビュー用）
// → aiEngine.ts をそのまま呼び出すだけ
// ===============================================

import { createClient } from "@supabase/supabase-js";

// 共通AIエンジン
import {
  buildUnifiedPrompt,
  callAI,
  parseArticle,
} from "./aiEngine";

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!
);

/**
 * プレビュー用：記事生成
 * @param ai_config_id - AI設定ID
 * @param keyword - メインキーワード
 * @param related_keywords - 関連キーワード配列
 */
export async function generateArticleByAI(
  ai_config_id: string,
  keyword: string,
  related_keywords: string[] = []
) {
  // ------------------------------------------------------
  // ① AI設定を取得
  // ------------------------------------------------------
  const { data: aiConfig, error: aiError } = await supabase
    .from("ai_configs")
    .select("*")
    .eq("id", ai_config_id)
    .single();

  if (aiError || !aiConfig) {
    throw new Error("AI設定の取得に失敗しました");
  }

  // ------------------------------------------------------
  // ② 中心テーマを抽出（related_keywords → fallback keyword）
  // ------------------------------------------------------
  const center =
    Array.isArray(related_keywords) && related_keywords.length > 0
      ? related_keywords[Math.floor(Math.random() * related_keywords.length)]
      : keyword;

  // ------------------------------------------------------
  // ③ プロンプト生成（共通）
  // ------------------------------------------------------
  const prompt = buildUnifiedPrompt(center, aiConfig);

  console.log("=== プレビュー用プロンプト ===");
  console.log(prompt);

  // ------------------------------------------------------
  // ④ AIモデル呼び出し（共通）
  // ------------------------------------------------------
  const raw = await callAI(aiConfig, prompt);

  console.log("=== プレビュー用 AI 生出力 ===");
  console.log(raw);

  // ------------------------------------------------------
  // ⑤ JSON解析（共通）
  // ------------------------------------------------------
  const article = parseArticle(raw);

  return {
    title: article.title,
    content: article.content,
    center_keyword: center,
  };
}
