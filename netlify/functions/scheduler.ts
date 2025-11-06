// netlify/functions/scheduler.ts
import type { Handler } from "@netlify/functions";
import { createClient } from "@supabase/supabase-js";

// Supabase接続
const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!
);

// Gemini / GPT など記事生成用の関数（簡易版）
async function generateArticle(ai: any): Promise<{ title: string; content: string }> {
  console.log(`🧠 AI(${ai.provider}) による記事生成開始`);
  // 実際には API呼び出しを行うが、ここではダミー処理にしておく
  const title = `【自動生成】${new Date().toLocaleString("ja-JP", { timeZone: "Asia/Tokyo" })}`;
  const content = `この記事は ${ai.model} によって自動生成されました。\n\nサンプル本文です。`;
  return { title, content };
}

// WordPress投稿処理
async function postToWordPress(wp: any, article: { title: string; content: string }) {
  console.log(`🌐 WordPress投稿開始: ${wp.url}`);
  const endpoint = `${wp.url}/wp-json/wp/v2/posts`;

  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization:
        "Basic " +
        Buffer.from(`${wp.username}:${wp.app_password}`).toString("base64"),
    },
    body: JSON.stringify({
      title: article.title,
      content: article.content,
      status: "publish",
      categories: wp.default_category ? [wp.default_category] : undefined,
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`投稿失敗 (${response.status}): ${text}`);
  }

  const result = await response.json();
  console.log(`✅ 投稿完了: ${result.link}`);
  return result;
}

// メイン処理
export const handler: Handler = async () => {
  console.log("🕒 スケジューラー起動");

  // 現在時刻をJSTで取得
  const now = new Date(new Date().toLocaleString("en-US", { timeZone: "Asia/Tokyo" }));
  const hour = now.getHours().toString().padStart(2, "0");
  const minute = now.getMinutes().toString().padStart(2, "0");
  const currentTime = `${hour}:${minute}`;
  const dayOfWeek = now.getDay(); // 0:日曜, 1:月曜, ...

  // スケジュール取得
  const { data: schedules, error } = await supabase
    .from("schedule_settings")
    .select("*")
    .eq("status", true);

  if (error || !schedules?.length) {
    console.error("❌ スケジュールが見つかりません");
    return { statusCode: 404, body: "スケジュールなし" };
  }

  // 投稿対象を絞り込み
  const targets = schedules.filter((s: any) => {
    if (s.time !== currentTime) return false;

    switch (s.frequency) {
      case "毎日":
        return true;
      case "週1":
        return dayOfWeek === 1;
      case "週3":
        return [1, 3, 5].includes(dayOfWeek);
      case "週5":
        return [1, 2, 3, 4, 5].includes(dayOfWeek);
      default:
        return false;
    }
  });

  console.log("🎯 対象スケジュール:", targets.length);

  // 対象スケジュールごとに記事生成＆投稿
  for (const schedule of targets) {
    try {
      console.log(`🚀 投稿開始: ${schedule.id}`);

      // AI設定＆WP設定の読み込み
      const { data: aiConfig } = await supabase
        .from("ai_configs")
        .select("*")
        .eq("id", schedule.ai_config_id)
        .single();

      const { data: wpConfig } = await supabase
        .from("wp_configs")
        .select("*")
        .eq("id", schedule.wp_config_id)
        .single();

      if (!aiConfig || !wpConfig) {
        console.log("⚠️ AIまたはWP設定が見つかりません:", schedule.id);
        continue;
      }

      // AIで記事生成
      const article = await generateArticle(aiConfig);

      // WordPressに投稿
      const postResult = await postToWordPress(wpConfig, article);

      // 実行日時を保存
      await supabase
        .from("schedule_settings")
        .update({ last_run_at: new Date().toISOString() })
        .eq("id", schedule.id);

      console.log(`✅ 投稿成功: ${postResult.link}`);
    } catch (err: any) {
      console.error("❌ 投稿エラー:", err.message);
    }
  }

  return {
    statusCode: 200,
    body: "Scheduler run complete",
  };
};
