// ===============================================
// generateArticle.ts（プレビュー用）
// → aiEngine.ts をそのまま呼び出すだけ
// ===============================================

import { createClient } from "@supabase/supabase-js";

// 共通AIエンジン
import {
  buildUnifiedPromptWithFacts,
  callAI,
  parseArticle,
} from "./aiEngine";
import { searchFactsByKeyword } from "./searchFacts";
import { factCheckArticle } from "./factCheckArticle";
import { buildRewritePrompt } from "./aiEngine";

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!
);

/**
 * プレビュー用：記事生成（facts使用版）
 * @param ai_config_id - AI設定ID
 * @param keyword - メインキーワード
 * @param facts - 事実情報配列
 */
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

  // // previewでは指定された keyword をそのまま中心テーマにする
  const center = keyword;

  // 対策①：明らかなエラー文を除外
  const cleanedFacts = facts.filter(f =>
    !/warning|error|invalid argument|\/wp-content\//i.test(f.content)
  );

  // ③ プロンプト生成（facts版）
  const prompt = buildUnifiedPromptWithFacts(center, cleanedFacts, aiConfig);

  // ④ AI呼び出し
  const raw = await callAI(aiConfig, prompt);

  // ⑤ JSON解析
  let article = parseArticle(raw);

  // ⑥ ファクトチェック（1回目）
  const checkResult = await factCheckArticle(
    article,
    cleanedFacts,
    (prompt) => callAI(aiConfig, prompt)
  );

  console.log("[factCheck][1st]", checkResult);

  if (checkResult.status === "ok") {
    // ✅ 問題なし → そのまま返す
    return {
      title: article.title,
      content: article.content,
      center_keyword: center,
      fact_check: checkResult,
      is_rejected: false,
    };
  }

  // ===== NG → 1回だけリライト =====
  const rewritePrompt = buildRewritePrompt(article, checkResult.reasons);
  const rewrittenRaw = await callAI(aiConfig, rewritePrompt);
  article = parseArticle(rewrittenRaw);

  // ===== 2回目のファクトチェック =====
  const secondCheckResult = await factCheckArticle(
    article,
    cleanedFacts,
    (p) => callAI(aiConfig, p)
  );

  console.log("[factCheck][2nd]", secondCheckResult);

  // ===== 最終判断 =====
  return {
    title: article.title,
    content: article.content,
    center_keyword: center,
    fact_check: secondCheckResult,
    is_rejected: secondCheckResult.status === "reject",
  };
}

/**
 * スケジューラー用：記事生成（facts使用版）
 * @param ai_config_id - AI設定ID
 * @param keyword - メインキーワード（related_keywordsが空の場合に使用）
 * @param related_keywords - 関連キーワード配列（ここからランダムで1つ選んで検索）
 */
export async function generateArticleByAI(
  ai_config_id: string,
  keyword: string,
  related_keywords: string[] = []
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

  // ✅ related_keywordsからランダムで1つ選ぶ
  const validRelatedKeywords = related_keywords.filter(kw => kw && kw.trim() !== "");
  let selectedKeyword: string;

  if (validRelatedKeywords.length > 0) {
    // related_keywordsからランダムに1つ選ぶ
    selectedKeyword = validRelatedKeywords[Math.floor(Math.random() * validRelatedKeywords.length)];
    console.log(`[generateArticleByAI] related_keywordsから選択: 「${selectedKeyword}」`);
  } else {
    // related_keywordsが空の場合はメインキーワードを使用
    selectedKeyword = keyword;
    console.log(`[generateArticleByAI] related_keywordsが空のためメインキーワードを使用: 「${selectedKeyword}」`);
  }

  const center = selectedKeyword;

  // ② facts取得（選んだキーワードで検索）
  const rawFacts = await searchFactsByKeyword(center);

  // 対策①：明らかなエラー文を除外
  const cleanedFacts = rawFacts.filter(f =>
    !/warning|error|invalid argument|\/wp-content\//i.test(f.content)
  );

  if (!cleanedFacts || cleanedFacts.length === 0) {
    throw new Error(`キーワード「${center}」の検索結果（facts）が取得できませんでした`);
  }

  console.log(`[generateArticleByAI] キーワード「${center}」: ${rawFacts.length}件 → フィルタリング後 ${cleanedFacts.length}件のfactsを取得`);

  // ③ プロンプト生成（facts版）
  const prompt = buildUnifiedPromptWithFacts(center, cleanedFacts, aiConfig);

  // ④ AI呼び出し
  const raw = await callAI(aiConfig, prompt);

  // ⑤ JSON解析
  let article = parseArticle(raw);

  // ⑥ ファクトチェック（1回目）
  const checkResult = await factCheckArticle(
    article,
    cleanedFacts,
    (prompt) => callAI(aiConfig, prompt)
  );

  console.log("[factCheck][1st]", checkResult);

  if (checkResult.status === "ok") {
    // ✅ 問題なし → そのまま返す
    return {
      title: article.title,
      content: article.content,
      center_keyword: center,
      fact_check: checkResult,
      is_rejected: false,
    };
  }

  // ===== NG → 1回だけリライト =====
  const rewritePrompt = buildRewritePrompt(article, checkResult.reasons);
  const rewrittenRaw = await callAI(aiConfig, rewritePrompt);
  article = parseArticle(rewrittenRaw);

  // ===== 2回目のファクトチェック =====
  const secondCheckResult = await factCheckArticle(
    article,
    cleanedFacts,
    (p) => callAI(aiConfig, p)
  );

  console.log("[factCheck][2nd]", secondCheckResult);

  // ===== 最終判断 =====
  return {
    title: article.title,
    content: article.content,
    center_keyword: center,
    fact_check: secondCheckResult,
    is_rejected: secondCheckResult.status === "reject",
  };
}


