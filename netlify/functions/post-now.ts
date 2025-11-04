import { Handler } from "@netlify/functions";
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!
);

export const handler: Handler = async (event) => {
  try {
    const { schedule_id } = JSON.parse(event.body || "{}");

    if (!schedule_id) throw new Error("schedule_id が指定されていません");

    // 🔹 スケジュール情報を取得
    const { data: schedule, error: scheduleError } = await supabase
      .from("schedule_settings")
      .select("*")
      .eq("id", schedule_id)
      .single();

    if (scheduleError || !schedule) {
      throw new Error("スケジュール情報が見つかりません");
    }

    // 🔹 紐づく WordPress設定を取得
    const { data: wpConfig, error: wpError } = await supabase
      .from("wp_configs")
      .select("*")
      .eq("id", schedule.wp_config_id)
      .single();

    if (wpError || !wpConfig) {
      throw new Error("WordPress設定が見つかりません");
    }

    console.log("✅ WordPress設定取得成功:", wpConfig.url);

    // 🔹 Geminiで記事生成
    const aiResponse = await fetch(
      "https://ai-autowriter.netlify.app/.netlify/functions/gemini-proxy",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ keyword: schedule.keyword || "テスト記事" }),
      }
    );

    if (!aiResponse.ok) {
      const text = await aiResponse.text();
      console.error("❌ Gemini API fetch failed:", text);
