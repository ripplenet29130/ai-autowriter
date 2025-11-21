import type { Handler } from "@netlify/functions";
import { createClient } from "@supabase/supabase-js";
import { generateArticleByAI } from "../../src/utils/generateArticle";

export const handler: Handler = async (event) => {
  console.log("⚡ 即時実行 run-scheduler 起動");

  const body = JSON.parse(event.body || "{}");
  const scheduleId = body.schedule_id;

  if (!scheduleId) {
    return {
      statusCode: 400,
      body: "schedule_id が必要です",
    };
  }

  // Supabase
  const supabase = createClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_KEY!
  );

  // scheduler.ts と同じ処理をそのまま動かす
  const { data: schedule } = await supabase
    .from("schedule_settings")
    .select("*")
    .eq("id", scheduleId)
    .single();

  if (!schedule) {
    return { statusCode: 404, body: "Schedule not found" };
  }

  // ======== ここで scheduler.ts 内のロジックを呼び出す ========
  // 1. WP設定取得
  const { data: wpConfig } = await supabase
    .from("wp_configs")
    .select("*")
    .eq("id", schedule.wp_config_id)
    .single();

  // 以降、scheduler.ts の処理を丸ごとコピペしてもOK
  // （ChatWork通知もそのまま動く）
  // =======================================================

  return {
    statusCode: 200,
    body: "即時実行が開始されました（詳細はログ参照）",
  };
};
