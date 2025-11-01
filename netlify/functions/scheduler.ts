// netlify/functions/scheduler.ts
import type { Handler } from "@netlify/functions";
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.SUPABASE_URL!,        // ✅ NetlifyではVITE_なし
  process.env.SUPABASE_SERVICE_KEY! // 投稿実行にはService Key推奨
);

// --- Geminiで記事生成 ---
async function generateArticle(keyword: string, aiConfig: any) {
  const prompt = `
  あなたはプロのSEOライターです。
  次のキーワードで日本語の記事を800文字程度生成してください。
  キーワード: ${keyword}
  `;

  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${aiConfig.model}:generateContent?key=${aiConfig.api_key}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        generationConfig: {
          temperature: aiConfig.temperature ?? 0.7,
          maxOutputTokens: aiConfig.max_tokens ?? 1200,
        },
      }),
    }
  );

  const result = await res.json();
  if (result.error) throw new Error(`Geminiエラー: ${result.error.message}`);

  const text =
    result.candidates?.[0]?.content?.parts?.[0]?.text || "（AI出力なし）";

  return {
    title: `${keyword} に関する最新情報`,
    content: text,
  };
}

// --- WordPressへ投稿 ---
async function postToWordPress(wpConfig: any, article: any) {
  const payload = {
    title: article.title,
    content: article.content,
    status: "publish",
  };

  const res = await fetch(`${wpConfig.url}/wp-json/wp/v2/posts`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization:
        "Basic " + btoa(`${wpConfig.username}:${wpConfig.app_password}`),
    },
    body: JSON.stringify(payload),
  });

  if (!res.ok) throw new Error(`WordPress投稿エラー: ${res.status}`);
  return await res.json();
}

// --- メイン処理 ---
export const handler: Handler = async () => {
  console.log("🕒 スケジュール投稿関数 起動");

  // スケジュール一覧を取得
  const { data: schedules, error } = await supabase
    .from("schedule_settings")
    .select("*")
    .eq("status", true)
    .limit(1);

  if (error || !schedules?.length) {
    console.error("❌ スケジュールが見つかりません");
    return { statusCode: 404, body: "スケジュールなし" };
  }

  const schedule = schedules[0];

  // 紐づくAI/WP設定を個別取得
  const [{ data: aiData }, { data: wpData }] = await Promise.all([
    supabase.from("ai_configs").select("*").eq("id", schedule.ai_config_id).single(),
    supabase.from("wp_configs").select("*").eq("id", schedule.wp_config_id).single(),
  ]);

  const keyword = "テスト投稿";

  try {
    const article = await generateArticle(keyword, aiData);
    const post = await postToWordPress(wpData, article);

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
