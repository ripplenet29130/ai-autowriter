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
      throw new Error("Gemini proxy fetch failed");
    }

    const article = await aiResponse.json();

    if (!article.content) {
      throw new Error("Geminiから記事が返されませんでした");
    }

    console.log("✅ 記事生成成功:", article.title);

    // 🔹 WordPressへ投稿
    const wpUrl = `${wpConfig.url.replace(/\/$/, "")}/wp-json/wp/v2/posts`;

    const credential = Buffer.from(
      `${wpConfig.username}:${wpConfig.app_password}`
    ).toString("base64");

    const wpRes = await fetch(wpUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Basic ${credential}`,
      },
      body: JSON.stringify({
        title: article.title,
        content: article.content,
        status: "publish",
        categories: [wpConfig.default_category || 1],
      }),
    });

    if (!wpRes.ok) {
      const text = await wpRes.text();
      console.error("❌ WordPress投稿エラー:", text);
      throw new Error("WordPress投稿に失敗しました");
    }

    console.log("✅ WordPress投稿成功");

    return {
      statusCode: 200,
      body: JSON.stringify({ message: "✅ 投稿完了しました" }),
    };
  } catch (err: any) {
    console.error("❌ エラー:", err);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: err.message }),
    };
  }
};
