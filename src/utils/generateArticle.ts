// ===============================================
// generateArticle.ts（プレビュー用）
// → aiEngine.ts をそのまま呼び出すだけ
// ===============================================

import { createClient } from "@supabase/supabase-js";

// 共通AIエンジン
import {
  buildUnifiedPrompt,
  buildUnifiedPromptWithFacts,
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
// 新：factsプレビュー
export async function generateArticleByAIWithFacts(
  ai_config_id: string,
  keyword: string,
  facts: { source: string; content: string }[]
) {
  // ① AI設定取得
  const { data: aiConfig, error: aiError } = await supabase
    .from("ai_configs")
    .select("*")
    .eq("id", ai_config_id)
    .single();

  if (aiError || !aiConfig) {
    throw new Error("AI設定の取得に失敗しました");
  }

  // 🚫【バグの原因】related_keywords から再抽選 → 廃止する
  // const center = related_keywords.length > 0
  //   ? related_keywords[Math.floor(Math.random() * related_keywords.length)]
  //   : keyword;

  // ✅ scheduler から渡された "keyword" をそのまま使う
  const center = keyword;

  // ③ プロンプト生成（facts版）
  const prompt = buildUnifiedPromptWithFacts(center, facts, aiConfig);

  // ④ AI呼び出し
  const raw = await callAI(aiConfig, prompt);

  // ⑤ JSON解析
  const article = parseArticle(raw);

  return {
    title: article.title,
    content: article.content,
    center_keyword: center,
  };
}

export const generateArticleByAI = generateArticleByAIWithFacts;


