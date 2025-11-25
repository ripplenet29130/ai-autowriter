// netlify/functions/scheduler.ts
import type { Handler } from "@netlify/functions";
import { createClient } from "@supabase/supabase-js";
import { generateArticleByAI } from "../../src/utils/generateArticle";

// ============================
// Supabase 初期化
// ============================
const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!
);

// ============================
// 共通：JST Helper
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

// ============================
// ChatWork 送信（先に宣言）
// ============================
async function sendChatWorkMessage(text: string) {
  const token = process.env.CHATWORK_API_TOKEN;
  const roomId = process.env.CHATWORK_ROOM_ID;

  const res = await fetch(`https://api.chatwork.com/v2/rooms/${roomId}/messages`, {
    method: "POST",
    headers: {
      "X-ChatWorkToken": token,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({ body: text }),
  });

  if (!res.ok) {
    console.error("ChatWork送信エラー:", await res.text());
  }
}

// ============================
// WordPress 投稿処理
// ============================
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

// ============================
// Frequency 判定ロジック（完全修正版）
// ============================
function shouldRunByFrequency(schedule: any, today: Date): boolean {
  const start = new Date(schedule.start_date);
  const diffDays = daysBetween(start, today);

  if (diffDays < 0) return false;

  const last = schedule.last_run_at ? new Date(schedule.last_run_at) : null;
  const todayStr = formatDate(today);
  const lastStr = last ? formatDate(last) : null;

  switch (schedule.frequency) {
    case "daily":
      return lastStr !== todayStr;

    case "weekly":
      return diffDays % 7 === 0 && lastStr !== todayStr;

    case "biweekly":
      return diffDays % 14 === 0 && lastStr !== todayStr;

    case "monthly":
      if (today.getDate() !== start.getDate()) return false;
      if (!last) return true;
      return today.getMonth() !== last.getMonth();

    default:
      return false;
  }
}

export const handler: Handler = async (event) => {
  const now = getJSTDate();
  const todayStr = formatDate(now);
  const nowMinutes = now.getHours() * 60 + now.getMinutes();

  // ============================
  // スケジュール取得
  // ============================
  const { data } = await supabase
    .from("schedule_settings")
    .select("*")
    .eq("status", true);

  let schedules = (data || []).filter((s) => {
    const lastStr = s.last_run_at ? formatDate(new Date(s.last_run_at)) : null;

    const [th, tm] = s.post_time.split(":").map(Number);
    const targetMinutes = th * 60 + tm;

    // 投稿予定時刻の前後10分以内
    const diff = Math.abs(nowMinutes - targetMinutes);
    if (diff > 10) return false;

    if (lastStr === todayStr) return false;
    if (s.start_date && todayStr < s.start_date) return false;
    if (s.end_date && todayStr > s.end_date) return false;

    return shouldRunByFrequency(s, now);
  });
  
  // ============================
  // メイン処理
  // ============================
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

      // 未使用キーワード
      const { data: usedWords } = await supabase
        .from("schedule_used_keywords")
        .select("keyword")
        .eq("schedule_id", schedule.id);

      const usedSet = new Set((usedWords || []).map((u) => u.keyword));
      const relatedList: string[] = Array.isArray(schedule.related_keywords)
        ? schedule.related_keywords
        : [];

      const unused = relatedList.filter((kw) => !usedSet.has(kw));

      if (unused.length === 0) {
        console.log("🛑 キーワード不足 → 自動停止:", schedule.id);
        await supabase
          .from("schedule_settings")
          .update({ status: false })
          .eq("id", schedule.id);
        continue;
      }

      const selectedKeyword =
        unused[Math.floor(Math.random() * unused.length)];

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
      const remaining = unused.length - 1;

      const warningMessage =
        remaining <= 3
          ? `[warning]残りキーワード数が少なくなっています（残り ${remaining} 個）
キーワード補充またはスケジュール設定の見直しをお願いします。[/warning]\n`
          : "";

     await sendChatWorkMessage(
`いつもお世話になっております。
自動投稿システムにて、記事の投稿が完了しましたのでご連絡いたします。

■ サイト名
${wpConfig.name}

■ 記事タイトル
${title}

■ キーワード
${selectedKeyword}

■ 投稿URL
${postResult.link}

■ 投稿状態
${schedule.post_status === "publish" ? "公開" : "下書き"}

■ 未使用キーワードの残数
${remaining} 個

${warningMessage}

実行日時：${now.toLocaleString("ja-JP")}

引き続きよろしくお願いいたします。`
);

      

      // 使用済みに追加
      await supabase.from("schedule_used_keywords").insert({
        schedule_id: schedule.id,
        keyword: selectedKeyword,
      });

      // last_run 更新
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

// ============================
// Netlify パス設定（必須）
// ============================
export const config = {
  path: "/auto-scheduler",
};
