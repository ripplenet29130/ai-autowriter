// netlify/functions/scheduler.ts
import type { Handler } from "@netlify/functions";
import { createClient } from "@supabase/supabase-js";
import { generateArticleByAI } from "../../src/utils/generateArticle";

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!
);

// ============================
// Utility: JST date helpers
// ============================
function getJSTDate(): Date {
  return new Date(new Date().toLocaleString("en-US", { timeZone: "Asia/Tokyo" }));
}

function formatDate(date: Date): string {
  return date.toISOString().split("T")[0];
}

function daysBetween(a: Date, b: Date): number {
  return Math.floor((b.getTime() - a.getTime()) / (1000 * 60 * 60 * 24));
}

// ===================================================
// WordPress 投稿処理
// ===================================================
async function postToWordPress(wp: any, schedule: any, article: {
  title: string;
  content: string;
  date: string;
}) {
  console.log(`🌐 WordPress投稿開始: ${wp.url}`);
  const endpoint = `${wp.url.replace(/\/$/, "")}/wp-json/wp/v2/posts`;

  const credential = Buffer.from(
    `${wp.username}:${wp.app_password}`
  ).toString("base64");

  async function getCategoryIdByName(name: string) {
    try {
      const res = await fetch(
        `${wp.url}/wp-json/wp/v2/categories?search=${encodeURIComponent(name)}`,
        { headers: { Authorization: `Basic ${credential}` } }
      );
      if (!res.ok) return 1;

      const categories = await res.json();
      return categories.length > 0 ? categories[0].id : 1;
    } catch {
      return 1;
    }
  }

  let categoryId = 1;
  if (wp.default_category) {
    if (!isNaN(Number(wp.default_category))) {
      categoryId = Number(wp.default_category);
    } else {
      categoryId = await getCategoryIdByName(wp.default_category);
    }
  }

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
      status: schedule.post_status === "draft" ? "draft" : "publish",
      date: article.date,
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`投稿失敗 (${response.status}): ${text}`);
  }

  return await response.json();
}

// ===================================================
// Frequency 判定ロジック
// ===================================================
function shouldRunByFrequency(schedule: any, today: Date): boolean {
  const start = new Date(schedule.start_date);
  const diffDays = daysBetween(start, today);

  if (diffDays < 0) return false; // start_date前

  const last = schedule.last_run_at ? new Date(schedule.last_run_at) : null;

  const todayStr = formatDate(today);
  const lastStr = last ? formatDate(last) : null;

  switch (schedule.frequency) {
    case "daily":
      return lastStr !== todayStr;

    case "weekly":
      if (diffDays % 7 !== 0) return false;
      return lastStr !== todayStr;

    case "biweekly":
      if (diffDays % 14 !== 0) return false;
      return lastStr !== todayStr;

    case "monthly":
      if (today.getDate() !== start.getDate()) return false;
      // 月に1回だけ
      if (!last) return true;
      return today.getMonth() !== last.getMonth();

    default:
      return false;
  }
}

// ===================================================
// 投稿処理メイン
// ===================================================
export const handler: Handler = async (event) => {
  console.log("🕒 スケジューラー起動");

  const now = getJSTDate();
  const currentTime = `${now.getHours().toString().padStart(2, "0")}:${now
    .getMinutes()
    .toString()
    .padStart(2, "0")}`;
  const todayStr = formatDate(now);

  // ------------------------------
  // 即時実行チェック
  // ------------------------------
  let forcedScheduleId: string | null = null;
  try {
    const bodyText =
      event.body && event.body.length > 0 ? event.body : event.rawBody || null;

    if (bodyText) {
      const body = JSON.parse(bodyText);
      if (body.schedule_id) {
        forcedScheduleId = body.schedule_id;
        console.log("⚡ 即時実行モード:", forcedScheduleId);
      }
    }
  } catch (e) {
    console.log("⚠ 即時実行 body パースエラー:", e);
  }

  let schedules: any[] = [];

  if (forcedScheduleId) {
    const { data } = await supabase
      .from("schedule_settings")
      .select("*")
      .eq("id", forcedScheduleId)
      .single();

    if (!data) {
      return { statusCode: 404, body: "Schedule not found" };
    }

    schedules = [data];

  } else {
    const { data } = await supabase
      .from("schedule_settings")
      .select("*")
      .eq("status", true);

    schedules = (data || []).filter((s) => {
      // ===============================
      // 時刻判定（Netlify遅延対策）
      // ===============================
      const [th, tm] = s.post_time.split(":").map(Number);
      const [ch, cm] = currentTime.split(":").map(Number);
      
      const nowMinutes = ch * 60 + cm;
      const targetMinutes = th * 60 + tm;
      
      // 今日まだ投稿していない ＋ 現在時刻が投稿時刻を過ぎていればOK
      if (!(lastStr !== todayStr && nowMinutes >= targetMinutes)) {
        return false;
      }

      // start_date & end_date
      if (s.start_date && todayStr < s.start_date) return false;
      if (s.end_date && todayStr > s.end_date) return false;

      // frequency 判定
      return shouldRunByFrequency(s, now);
    });
  }

  console.log("🎯 実行対象数:", schedules.length);

  // ===========================
  // 各スケジュール実行
  // ===========================
  for (const schedule of schedules) {
    try {
      console.log(`🚀 投稿開始: ${schedule.id}`);

      // WP設定
      const { data: wpConfig } = await supabase
        .from("wp_configs")
        .select("*")
        .eq("id", schedule.wp_config_id)
        .single();

      if (!wpConfig) continue;

      // 未使用キーワード計算
      const { data: usedWords } = await supabase
        .from("schedule_used_keywords")
        .select("keyword")
        .eq("schedule_id", schedule.id);

      const usedSet = new Set((usedWords || []).map((u) => u.keyword));
      const relatedList: string[] = Array.isArray(schedule.related_keywords)
        ? schedule.related_keywords
        : [];

      const unused = relatedList.filter((kw) => !usedSet.has(kw));

      // ⚠ 未使用キーワードなし → 自動停止
      if (unused.length === 0) {
        console.log("🛑 未使用キーワードなし → 自動停止:", schedule.id);
        await supabase
          .from("schedule_settings")
          .update({ status: false })
          .eq("id", schedule.id);

        continue;
      }

      const selectedKeyword =
        unused[Math.floor(Math.random() * unused.length)];

      // 記事生成
      const { title, content } = await generateArticleByAI(
        schedule.ai_config_id,
        selectedKeyword,
        relatedList
      );

      const isoDate = now.toISOString().replace("Z", "+09:00");

      const postResult = await postToWordPress(wpConfig, schedule, {
        title,
        content,
        date: isoDate,
      });

      // ChatWork 通知
      // 残りキーワード数
      const remaining = unused.length;
      
      // 3つ以下なら警告表示
      const warningMessage =
        remaining <= 3
          ? `[warning]残りキーワード数が少なくなっています（残り ${remaining} 個）  
      キーワード補充またはスケジュール設定の見直しをお願いします。[/warning]\n`
          : "";
      
      // ChatWork 通知
      await sendChatWorkMessage(
        `[info][title]自動投稿が実行されました[/title]
      サイト：${wpConfig.name}
      記事タイトル：${title}
      キーワード：${selectedKeyword}
      投稿URL：${postResult.link}
      
      残りの未使用キーワード数：${remaining} 個
      
      ${warningMessage}
      日時：${now.toLocaleString('ja-JP')}
      [/info]`
      );



      // 使用済み追加
      await supabase.from("schedule_used_keywords").insert({
        schedule_id: schedule.id,
        keyword: selectedKeyword,
      });

      // last_run_at 更新
      await supabase
        .from("schedule_settings")
        .update({ last_run_at: now.toISOString() })
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

async function sendChatWorkMessage(text: string) {
  const token = process.env.CHATWORK_API_TOKEN;
  const roomId = process.env.CHATWORK_ROOM_ID;

  const res = await fetch(`https://api.chatwork.com/v2/rooms/${roomId}/messages`, {
    method: 'POST',
    headers: {
      'X-ChatWorkToken': token,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({ body: text })
  });

  if (!res.ok) {
    console.error("ChatWork送信エラー:", await res.text());
  }
}

