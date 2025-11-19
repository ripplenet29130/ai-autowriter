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
  const endpoint = `${wp.url}/wp-json/wp/v2/posts`;

  // カテゴリID取得
  async function getCategoryIdByName(name: string) {
    try {
      const res = await fetch(`${wp.url}/wp-json/wp/v2/categories?search=${encodeURIComponent(name)}`, {
        headers: {
          Authorization:
            "Basic " + Buffer.from(`${wp.username}:${wp.app_password}`).toString("base64"),
        },
      });

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
      Authorization:
        "Basic " + Buffer.from(`${wp.username}:${wp.app_password}`).toString("base64"),
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
  console.log(`✅ 投稿完了: ${result.link}`);
  return result;
}

// メイン処理
export const handler: Handler = async () => {
  console.log("🕒 スケジューラー起動");

  // JSTの現在時刻
  const now = new Date(new Date().toLocaleString("en-US", { timeZone: "Asia/Tokyo" }));
  const hour = now.getHours().toString().padStart(2, "0");
  const minute = now.getMinutes().toString().padStart(2, "0");
  const currentTime = `${hour}:${minute}`;

  // スケジュール取得
  const { data: schedules } = await supabase
    .from("schedule_settings")
    .select("*")
    .eq("status", true);

  if (!schedules?.length) {
    console.error("❌ スケジュールなし");
    return { statusCode: 404, body: "No schedules" };
  }

  // 今実行すべきスケジュール
  const targets = schedules.filter((s: any) => s.post_time === currentTime);

  console.log("🎯 対象スケジュール数:", targets.length);

  for (const schedule of targets) {
    try {
      console.log(`🚀 投稿開始: ${schedule.id}`);

      // WP設定取得
      const { data: wpConfig } = await supabase
        .from("wp_configs")
        .select("*")
        .eq("id", schedule.wp_config_id)
        .single();

      if (!wpConfig) continue;

      // 使用キーワード選択
      // 🔍 スケジュールの使用済みキーワードを取得
      const { data: usedKeywordsData } = await supabase
        .from("schedule_used_keywords")
        .select("keyword")
        .eq("schedule_id", schedule.id);
      
      const usedKeywords = usedKeywordsData?.map((u) => u.keyword) || [];
      const usedSet = new Set(usedKeywords);
      
      // 🔍 このスケジュールのキーワードリスト（trend_keywords）を取得
      // ※ schedule.related_keywords はすでに配列として持っている前提
      const relatedList = Array.isArray(schedule.related_keywords)
        ? schedule.related_keywords
        : [];
      
      // 🔍 使用済みを除外した未使用キーワード
      const unusedKeywords = relatedList.filter((kw) => !usedSet.has(kw));
      
      // 🟢 次に使うキーワードを決定
      // 1. 未使用がある → 未使用からランダム選択
      // 2. 未使用ゼロ → メインキーワードにフォールバック
      const selectedKeyword =
        unusedKeywords.length > 0
          ? unusedKeywords[Math.floor(Math.random() * unusedKeywords.length)]
          : schedule.keyword;


      // AI記事生成
      const { title, content } = await generateArticleByAI(
        schedule.ai_config_id,
        selectedKeyword,
        relatedList
      );

      // ★ ここで投稿日時を作成する（JSTで）
      const today = now.toISOString().split("T")[0];
      const postDate = `${today}T${schedule.post_time}:00+09:00`;

      // WordPress投稿
      const postResult = await postToWordPress(wpConfig, {
        title,
        content,
        date: postDate,
      });

      // ★ 使用済みキーワードを記録する（投稿成功後）
      await supabase
        .from("schedule_used_keywords")
        .insert({
          schedule_id: schedule.id,
          keyword: selectedKeyword,
        });

      // 実行履歴
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
