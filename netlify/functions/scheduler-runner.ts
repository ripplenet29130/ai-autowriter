// netlify/functions/scheduler.ts
import type { Handler } from "@netlify/functions";
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!
);

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
      case "毎日": return true;
      case "週1": return dayOfWeek === 1;
      case "週3": return [1, 3, 5].includes(dayOfWeek);
      case "週5": return [1, 2, 3, 4, 5].includes(dayOfWeek);
      default: return false;
    }
  });

  console.log("🎯 対象スケジュール:", targets.length);

  for (const schedule of targets) {
    try {
      console.log(`🚀 投稿開始: ${schedule.id}`);

      // post-now 関数を呼び出す
      const response = await fetch(
        "https://ai-autowriter.netlify.app/.netlify/functions/post-now",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ schedule_id: schedule.id }),
        }
      );

      if (!response.ok) {
        throw new Error(`投稿関数エラー: ${response.status}`);
      }

      const result = await response.json();
      console.log("✅ 投稿完了:", result.message);

      // 実行日時を保存
      await supabase
        .from("schedule_settings")
        .update({ last_run_at: new Date().toISOString() })
        .eq("id", schedule.id);
    } catch (err: any) {
      console.error("❌ 投稿エラー:", err.message);
    }
  }

  return {
    statusCode: 200,
    body: "Scheduler run complete",
  };
};
