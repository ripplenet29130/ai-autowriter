// netlify/functions/run-scheduler.ts
import type { Handler } from "@netlify/functions";
import { createClient } from "@supabase/supabase-js";
import { generateArticleByAI } from "../../src/utils/generateArticle";

// ============================
// JST Helper
// ============================
function getJSTDate(): Date {
  return new Date(new Date().toLocaleString("en-US", { timeZone: "Asia/Tokyo" }));
}

function formatDate(date: Date): string {
  return date.toISOString().split("T")[0];
}

// ============================
// WordPress 投稿処理（scheduler.ts から複製）
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
// ChatWork送信
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
// 即時実行ハンドラ
// ============================
export const handler: Handler = async (event) => {
  console.log("⚡ run-scheduler 即時実行開始");

  const body = JSON.parse(event.body || "{}");
  const scheduleId = body.schedule_id;

  if (!scheduleId) {
    return { statusCode: 400, body: "schedule_id が必要です" };
  }

  console.log("🎯 即時実行対象:", scheduleId);

  const supabase = createClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_KEY!
  );

  // スケジュール取得
  const { data: schedule } = await supabase
    .from("schedule_settings")
    .select("*")
    .eq("id", scheduleId)
    .single();

  if (!schedule) {
    return { statusCode: 404, body: "Schedule not found" };
  }

  // WP設定
  const { data: wpConfig } = await supabase
    .from("wp_configs")
    .select("*")
    .eq("id", schedule.wp_config_id)
    .single();

  if (!wpConfig) {
    return { statusCode: 500, body: "WP設定が見つかりません" };
  }

  // 使用済みキーワード
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
    return {
      statusCode: 400,
      body: "未使用キーワードがありません",
    };
  }

  const selectedKeyword = unused[Math.floor(Math.random() * unused.length)];

  // 記事生成
  const { title, content } = await generateArticleByAI(
    schedule.ai_config_id,
    selectedKeyword,
    relatedList
  );

  const now = getJSTDate();
  const isoDate = now.toISOString().replace("Z", "+09:00");

  const postResult = await postToWordPress(wpConfig, schedule, {
    title,
    content,
    date: isoDate,
  });

  // ChatWork 通知
  const remaining = unused.length;
  const warningMessage =
    remaining <= 3
      ? `[warning]残りキーワード数が少なくなっています（残り ${remaining} 個）  
キーワード補充またはスケジュール設定の見直しをお願いします。[/warning]\n`
      : "";

  await sendChatWorkMessage(
    `[info][title]即時実行（run-scheduler）が実行されました[/title]
サイト：${wpConfig.name}
記事タイトル：${title}
キーワード：${selectedKeyword}
投稿URL：${postResult.link}

残りの未使用キーワード数：${remaining} 個

${warningMessage}
日時：${now.toLocaleString("ja-JP")}
[/info]`
  );

  // 使用済みに追加
  await supabase.from("schedule_used_keywords").insert({
    schedule_id: schedule.id,
    keyword: selectedKeyword,
  });

  // last_run_at 更新
  await supabase
    .from("schedule_settings")
    .update({ last_run_at: now.toISOString() })
    .eq("id", schedule.id);

  return {
    statusCode: 200,
    body: JSON.stringify({
      message: "即時実行完了",
      posted: postResult.link,
    }),
  };
};
