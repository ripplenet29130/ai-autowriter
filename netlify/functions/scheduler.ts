// netlify/functions/scheduler.ts
import type { Handler } from "@netlify/functions";
import { createClient } from "@supabase/supabase-js";
import { generateArticleByAI } from "../../src/utils/generateArticle"; // ← ここ重要！

// Supabase接続
const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!
);

// WordPress投稿処理
async function postToWordPress(wp: any, article: { title: string; content: string }) {
  console.log(`🌐 WordPress投稿開始: ${wp.url}`);
  const endpoint = `${wp.url}/wp-json/wp/v2/posts`;

  // ✅ カテゴリ名→ID変換関数
  async function getCategoryIdByName(name: string) {
    try {
      const res = await fetch(`${wp.url}/wp-json/wp/v2/categories?search=${encodeURIComponent(name)}`, {
        headers: {
          Authorization:
            "Basic " + Buffer.from(`${wp.username}:${wp.app_password}`).toString("base64"),
        },
      });

      if (!res.ok) {
        console.warn(`⚠️ カテゴリ取得失敗 (${res.status}): ${name}`);
        return 1; // fallback to 未分類
      }

      const categories = await res.json();
      if (categories.length > 0) {
        console.log(`✅ カテゴリ「${name}」のID: ${categories[0].id}`);
        return categories[0].id;
      } else {
        console.warn(`⚠️ カテゴリ「${name}」が見つかりません`);
        return 1; // fallback
      }
    } catch (e) {
      console.error("❌ カテゴリ取得エラー:", e);
      return 1; // fallback
    }
  }

  // ✅ default_category が数値ならそのまま使う、文字列なら変換
  let categoryId = 1; // fallback to 未分類
  if (wp.default_category) {
    if (typeof wp.default_category === "number") {
      categoryId = wp.default_category;
    } else if (!isNaN(Number(wp.default_category))) {
      categoryId = Number(wp.default_category);
    } else {
      categoryId = await getCategoryIdByName(wp.default_category);
    }
  }

  // ✅ 投稿リクエスト
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
      status: schedule.post_status || "publish",
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

  // スケジュール取得
  const { data: schedules, error } = await supabase
    .from("schedule_settings")
    .select("*")
    .eq("status", true);

  if (error || !schedules?.length) {
    console.error("❌ スケジュールが見つかりません");
    return { statusCode: 404, body: "スケジュールなし" };
  }

  // 投稿対象を抽出
  const targets = schedules.filter((s: any) => {
    if (s.post_time !== currentTime) return false;
    const today = now.toISOString().split("T")[0];

    // 終了日チェック
    if (s.end_date && today > s.end_date) {
      console.log(`⏹ 終了日を過ぎたスケジュールを無効化: ${s.id}`);
      supabase
        .from("schedule_settings")
        .update({ status: false })
        .eq("id", s.id)
        .then(() => console.log(`✅ ${s.id} を無効化しました`))
        .catch((err) => console.error("⚠️ 無効化エラー:", err.message));
      return false;
    }

    // 開始日前はスキップ
    if (s.start_date && today < s.start_date) {
      console.log(`🕓 待機中スケジュール (${s.id}) - ${s.start_date} から開始予定`);
      return false;
    }

    // 頻度別チェック
    switch (s.frequency) {
      case "毎日":
        return true;
      case "毎週": {
        if (!s.start_date) return false;
        const diffDays =
          (now.getTime() - new Date(s.start_date).getTime()) / (1000 * 60 * 60 * 24);
        return Math.floor(diffDays) % 7 === 0;
      }
      case "隔週": {
        if (!s.start_date) return false;
        const diffDays =
          (now.getTime() - new Date(s.start_date).getTime()) / (1000 * 60 * 60 * 24);
        return Math.floor(diffDays) % 14 === 0;
      }
      case "月一": {
        if (!s.start_date) return false;
        const startDay = new Date(s.start_date).getDate();
        const todayDay = now.getDate();
        return todayDay === startDay || (todayDay >= 28 && startDay > 28);
      }
      default:
        return false;
    }
  });

  console.log("📅 現在日付:", now.toISOString().split("T")[0]);
  console.log("🕒 現在時刻(JST):", currentTime);
  console.log("🎯 対象スケジュール数:", targets.length);

  // ===============================
  // ここでAI生成＆WordPress投稿
  // ===============================
  for (const schedule of targets) {
    try {
      console.log(`🚀 投稿開始: ${schedule.id}`);

      // WP設定を取得
      const { data: wpConfig } = await supabase
        .from("wp_configs")
        .select("*")
        .eq("id", schedule.wp_config_id)
        .single();

      if (!wpConfig) continue;

      // ✅ AIで記事を生成（related_keywordsからランダムに1つ選ぶ）
const relatedList = Array.isArray(schedule.related_keywords)
  ? schedule.related_keywords
  : [];

const selectedKeyword =
  relatedList.length > 0
    ? relatedList[Math.floor(Math.random() * relatedList.length)]
    : schedule.keyword; // fallback: keyword

console.log(`🧠 使用キーワード: ${selectedKeyword}`);

const { title, content } = await generateArticleByAI(
  schedule.ai_config_id,
  selectedKeyword, // ← ここを入れ替え
  relatedList
);


      // ✅ WordPressへ投稿
      const postResult = await postToWordPress(wpConfig, { title, content });

      // 実行履歴を更新
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
