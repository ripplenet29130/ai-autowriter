import { Handler } from "@netlify/functions";
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!
);

export const handler: Handler = async (event) => {
  try {
    const { schedule_id } = JSON.parse(event.body || "{}");

    // スケジュール情報をSupabaseから取得
    const { data: schedule, error } = await supabase
      .from("schedule_settings")
      .select("*")
      .eq("id", schedule_id)
      .single();

    if (error || !schedule) throw new Error("スケジュール情報が見つかりません");

    // Geminiで記事生成
    const aiResponse = await fetch(`/.netlify/functions/gemini-proxy`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ keyword: schedule.keyword }),
});
if (!aiResponse.ok) {
  const text = await aiResponse.text();
  console.error("❌ Gemini API fetch failed:", text);
  throw new Error("Gemini proxy fetch failed");
}

    const article = await aiResponse.json();

    // WordPressへ投稿
    const wpUrl = `${schedule.wp_url}/wp-json/wp/v2/posts`;
    const credential = Buffer.from(
      `${schedule.wp_user}:${schedule.wp_app_password}`
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
        categories: [schedule.category_id],
      }),
    });

    if (!wpRes.ok) throw new Error("WordPress投稿に失敗しました");

    return {
      statusCode: 200,
      body: JSON.stringify({ message: "✅ 投稿完了しました" }),
    };
  } catch (err: any) {
    console.error(err);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: err.message }),
    };
  }
};
