// netlify/functions/scheduler.ts
import type { Handler } from "@netlify/functions";
import { createClient } from "@supabase/supabase-js";
import { generateArticleByAI } from "../../src/utils/generateArticle";

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

  const today = now.toISOString().split("T")[0]; // "2025-11-07"

  // ===== ① 終了日チェック =====
  if (s.end_date && today > s.end_date) {
    // 終了日を過ぎたら status=false に自動更新
    console.log(`⏹ 終了日を過ぎたスケジュールを無効化: ${s.id}`);
    supabase
      .from("schedule_settings")
      .update({ status: false })
      .eq("id", s.id)
      .then(() => console.log(`✅ ${s.id} を無効化しました`))
      .catch((err) => console.error("⚠️ 無効化エラー:", err.message));
    return false;
  }

  // ===== ② 開始日前は「待機中」表示 =====
  if (s.start_date && today < s.start_date) {
    console.log(`🕓 待機中スケジュール (${s.id}) - ${s.start_date} から開始予定`);
    return false;
  }

  // ===== ③ 頻度別の投稿タイミング判定 =====
  switch (s.frequency) {
    case "毎日":
      return true;

    case "毎週": {
      if (!s.start_date) return false;
      const start = new Date(s.start_date);
      const diffDays = Math.floor(
        (now.getTime() - start.getTime()) / (1000 * 60 * 60 * 24)
      );
      return diffDays % 7 === 0;
    }

    case "隔週": {
      if (!s.start_date) return false;
      const start = new Date(s.start_date);
      const diffDays = Math.floor(
        (now.getTime() - start.getTime()) / (1000 * 60 * 60 * 24)
      );
      return diffDays % 14 === 0;
    }

    case "月一": {
      if (!s.start_date) return false;
      const start = new Date(s.start_date);
      const startDay = start.getDate();
      const todayDay = now.getDate();
      return (
        todayDay === startDay ||
        (todayDay >= 28 && startDay > 28) // 月末日対応
      );
    }

    default:
      return false;
  }
});

console.log("📅 現在日付:", now.toISOString().split("T")[0]);
console.log("🎯 対象スケジュール数:", targets.length);



  import type { Handler } from "@netlify/functions";
import { createClient } from "@supabase/supabase-js";
import { generateArticleByAI } from "../../src/utils/generateArticle"; // ← 追加

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!
);

// …（省略）…

for (const schedule of targets) {
  try {
    console.log(`🚀 投稿開始: ${schedule.id}`);

    const { data: wpConfig } = await supabase
      .from("wp_configs")
      .select("*")
      .eq("id", schedule.wp_config_id)
      .single();

    if (!wpConfig) continue;

    // ✅ AIで記事を生成
    const { title, content } = await generateArticleByAI(
      schedule.ai_config_id,
      schedule.keyword,
      schedule.related_keywords || []
    );

    // ✅ WordPress投稿処理
    const post = await postToWordPress(wpConfig, { title, content });

    await supabase
      .from("schedule_settings")
      .update({ last_run_at: new Date().toISOString() })
      .eq("id", schedule.id);

    console.log(`✅ 投稿完了: ${post.link}`);
  } catch (err) {
    console.error("❌ 投稿エラー:", err);
  }
}


  return {
    statusCode: 200,
    body: "Scheduler run complete",
  };
};
