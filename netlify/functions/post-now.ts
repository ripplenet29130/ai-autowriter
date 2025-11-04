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

    // 🔹 スケジュール取得
    const { data: schedule } = await supabase
      .from("schedule_settings")
      .select("*")
      .eq("id", schedule_id)
      .single();

    // 🔹 WordPress設定取得
    const { data: wpConfig } = await supabase
      .from("wp_configs")
      .select("*")
      .eq("id", schedule.wp_config_id)
      .single();

    // 🔹 Geminiで記事生成
    const aiResponse = await fetch(
      "https://ai-autowriter.netlify.app/.netlify/functions/gemini-proxy",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ keyword: schedule.keyword || "テスト記事" }),
      }
    );

    const article = await aiResponse.json();

    // 🔹 WordPress API接続情報
    const wpUrl = `${wpConfig.url.replace(/\/$/, "")}`;
    const credential = Buffer.from(
      `${wpConfig.username}:${wpConfig.app_password}`
    ).toString("base64");

    // 🔹 カテゴリ slug → ID 変換
    let categoryId = 1;
    if (wpConfig.default_category) {
      const catRes = await fetch(
        `${wpUrl}/wp-json/wp/v2/categories?slug=${wpConfig.default_category}`,
        {
          headers: { Authorization: `Basic ${credential}` },
        }
      );
      const cats = await catRes.json();
      if (Array.isArray(cats) && cats.length > 0) {
        categoryId = cats[0].id;
      }
    }

    // 🔹 投稿処理
    const wpRes = await fetch(`${wpUrl}/wp-json/wp/v2/posts`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Basic ${credential}`,
      },
      body: JSON.stringify({
        title: article.title,
        content: article.content,
        status: "publish",
        categories: [categoryId],
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
