// netlify/functions/scheduler.ts
import type { Handler } from "@netlify/functions";
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.VITE_SUPABASE_URL!,
  process.env.VITE_SUPABASE_ANON_KEY!
);

// --- Geminiで記事生成 ---
async function generateArticle(keyword: string, aiConfig: any) {
  const prompt = `
  あなたはプロのSEOライターです。
  次のキーワードで日本語の記事を800文字程度生成してください。
  キーワード: ${keyword}
  `;

  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${aiConfig.model}:generateContent?key=${aiConfig.api_key}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        generationConfig: {
          temperature: aiConfig.temperature || 0.7,
          maxOutputTokens: aiConfig.max_tokens || 1200,
        },
      }),
    }
  );

  const result = await response.json();
  const text =
    result.candidates?.[0]?.content?.parts?.[0]?.text ||
    "（AI出力なし）";
  return { title: `${keyword} に関する最新情報`, content: text };
}

// --- WordPressへ投稿 ---
async function postToWordPress(wpConfig: any, article: any) {
  const res = await fetch(`${wpConfig.url}/wp-json/wp/v2/posts`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization:
        "Basic " +
        btoa(`${wpConfig.username}:${wpConfig.app_password}`),
    },
    body: JSON.stringify({
      title: article.title,
      content: article.content,
      status: "publish",
      categories: wpConfig.default_category ? [wpConfig.default_category] : undefined,
    }),
  });

  if (!res.ok) throw new Error(`WordPress投稿エラー: ${res.status}`);
  return await res.json();
}

// --- メイン関数（Netlifyが実行する処理）---
export const handler: Handler = async () => {
  console.log("🕒 スケジュール投稿関数 起動");

  const { data: schedules, error } = await supabase
    .from("schedule_settings")
    .select("*, ai_configs(*), wp_configs(*)")
    .eq("status", true)
    .limit(1);

  if (error || !schedules?.length)
    return { statusCode: 500, body: "❌ スケジュールが見つかりません" };

  const schedule = schedules[0];
  const keyword = "テスト投稿"; // 手動テスト用

  try {
    const article = await generateArticle(keyword, schedule.ai_configs);
    const post = await postToWordPress(schedule.wp_configs, article);

    console.log("✅ 投稿成功:", post.link);
    return {
      statusCode: 200,
      body: `✅ 投稿完了: ${post.link}`,
    };
  } catch (err: any) {
    console.error("❌ エラー:", err.message);
    return { statusCode: 500, body: err.message };
  }
};
