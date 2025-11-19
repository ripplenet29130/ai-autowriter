// netlify/functions/scheduler.ts
import type { Handler } from "@netlify/functions";
import { createClient } from "@supabase/supabase-js";
import { generateArticleByAI } from "../../src/utils/generateArticle";

// Supabase接続
const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!
);

// WordPress投稿処理
async function postToWordPress(wp: any, article: {
  title: string;
  content: string;
  date: string;
}) {
  console.log(`🌐 WordPress投稿開始: ${wp.url}`);
  const endpoint = `${wp.url.replace(/\/$/, "")}/wp-json/wp/v2/posts`;

  const credential = Buffer.from(
    `${wp.username}:${wp.app_password}`
  ).toString("base64");

  // カテゴリID取得
  async function getCategoryIdByName(name: string) {
    try {
      const res = await fetch(
        `${wp.url}/wp-json/wp/v2/categories?search=${encodeURIComponent(name)}`,
        {
          headers: { Authorization: `Basic ${credential}` },
        }
      );

      if (!res.ok) return 1;

      const categories = await res.json();
      return categories.length > 0 ? categories[0].id : 1;
    } catch {
      return 1;
    }
  }

  // default_categoryの解決
  let categoryId = 1;
  if (wp.default_category) {
    if (!isNaN(Number(wp.default_category))) {
      categoryId = Number(wp.default_category);
    } else {
      categoryId = await getCategoryIdByName(wp.default_category);
    }
  }

  // WordPress投稿
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Basic ${credential}`,
    },
    body: JSON.stringify({
      title: article.title,
      content: article.content,
      categories: [categoryId],
      status: "publish",
      date: article.date,
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`投稿失敗 (${response.status}): ${text}`);
  }

  const result = await response.json();
  return result;
}

// ====== メイン処理 ======
export const handler: Handler = async (event) => {
  console.log("🕒 スケジューラー起動");

  const now = new Date(new Date().toLocaleString("en-US", { timeZone: "Asia/Tokyo" }));

  // ★ 即時実行モード
  let forcedScheduleId: string | null = null;
  if (event.httpMethod === "POST" && event.body) {
    try {
      const body = JSON.parse(event.body);
      if (body.schedule_id) {
        forcedScheduleId = body.schedule_id;
        console.log("⚡ 即時実行モード:", forcedScheduleId);
      }
    } catch {}
  }

  // スケジュール取得
  let schedules: any[] = [];

  if (forcedScheduleId) {
    // ★ 即時実行用：schedule_id だけ取得
    const { data } = await supabase
      .from("schedule_settings")
      .select("*")
      .eq("id", forcedScheduleId)
      .eq("status", true)
      .single();

    if (!data) {
      return { statusCode: 404, body: "Schedule not found" };
    }

    schedules = [data];

  } else {
    // ★ 通常スケジュール処理（時間で自動）
    const hour = now.getHours().toString().padStart(2, "0");
    const minute = now.getMinutes().toString().padStart(2, "0");
    const currentTime = `${hour}:${minute}`;

    const { data } = await supabase
      .from("schedule_settings")
      .select("*")
      .eq("status", true);

    schedules = (data || []).filter((s) => s.post_time === currentTime);
  }

  console.log("🎯 実行対象数:", schedules.length);

  // ====== スケジュール実行 ======
  for (const schedule of schedules) {
    try {
      console.log(`🚀 投稿開始: ${schedule.id}`);

      // WP設定取得
      const { data: wpConfig } = await supabase
        .from("wp_configs")
        .select("*")
        .eq("id", schedule.wp_config_id)
        .single();

      if (!wpConfig) continue;

      // 使用済みキーワード取得
      const { data: usedWords } = await supabase
        .from("schedule_used_keywords")
        .select("keyword")
        .eq("schedule_id", schedule.id);

      const usedSet = new Set((usedWords || []).map((u) => u.keyword));

      const relatedList: string[] =
        Array.isArray(schedule.related_keywords) ? schedule.related_keywords : [];

      const unused = relatedList.filter((kw) => !usedSet.has(kw));

      const selectedKeyword =
        unused.length > 0
          ? unused[Math.floor(Math.random() * unused.length)]
          : schedule.keyword;

      // AI記事生成
      const { title, content } = await generateArticleByAI(
        schedule.ai_config_id,
        selectedKeyword,
        relatedList
      );

      // 投稿日時（即時）
      const jstDate = new Date(
        new Date().toLocaleString("en-US", { timeZone: "Asia/Tokyo" })
      );
      const iso = jstDate.toISOString().replace("Z", "+09:00");

      const postResult = await postToWordPress(wpConfig, {
        title,
        content,
        date: iso,
      });

      // 使用済みキーワード記録
      await supabase.from("schedule_used_keywords").insert({
        schedule_id: schedule.id,
        keyword: selectedKeyword,
      });

      // 実行日時保存
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
    body: "Scheduler done",
  };
};
