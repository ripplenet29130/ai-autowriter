// netlify/functions/auto-scheduler.ts
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
  const utc = new Date();
  return new Date(utc.getTime() + 9 * 60 * 60 * 1000);
}


function formatDate(date: Date): string {
  return date.toISOString().split("T")[0]; // YYYY-MM-DD
}

function daysBetween(a: Date, b: Date): number {
  return Math.floor((b.getTime() - a.getTime()) / (1000 * 60 * 60 * 24));
}

// ============================
// ChatWork 送信
// ============================
async function sendChatWorkMessage(text: string) {
  const token = process.env.CHATWORK_API_TOKEN;
  const roomId = process.env.CHATWORK_ROOM_ID;

  if (!token || !roomId) {
    console.error("ChatWork 環境変数が設定されていません");
    return;
  }

  const res = await fetch(
    `https://api.chatwork.com/v2/rooms/${roomId}/messages`,
    {
      method: "POST",
      headers: {
        "X-ChatWorkToken": token,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({ body: text }),
    }
  );

  if (!res.ok) {
    console.error("ChatWork送信エラー:", await res.text());
  }
}

// ============================
// WordPress 投稿処理
// ============================
async function postToWordPress(
  wp: any,
  schedule: any,
  article: {
    title: string;
    content: string;
    date: string;
  }
) {
  console.log(`🌐 WordPress投稿開始: ${wp.url}`);
  const endpoint = `${wp.url.replace(/\/$/, "")}/wp-json/wp/v2/posts`;

  const credential = Buffer.from(
    `${wp.username}:${wp.app_password}`
  ).toString("base64");

  async function getCategoryIdByName(name: string) {
    try {
      const res = await fetch(
        `${wp.url}/wp-json/wp/v2/categories?search=${encodeURIComponent(
          name
        )}`,
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
      // 数値ID
      categoryId = Number(wp.default_category);
    } else {
      // カテゴリ名
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
// Frequency 判定ロジック
// （UIの値: 「毎日」「毎週」「隔週」「月一」に対応）
// ============================
function shouldRunByFrequency(schedule: any, today: Date): boolean {
  if (!schedule.start_date) return false;

  const start = new Date(schedule.start_date + "T00:00:00");
  const diffDays = daysBetween(start, today);

  if (diffDays < 0) return false;

  const last = schedule.last_run_at ? new Date(schedule.last_run_at) : null;
  const todayStr = formatDate(today);
  const lastStr = last ? formatDate(last) : null;

  switch (schedule.frequency) {
    case "毎日":
      // その日 1回だけ
      return lastStr !== todayStr;

    case "毎週":
      // 開始日から7の倍数の日だけ
      return diffDays % 7 === 0 && lastStr !== todayStr;

    case "隔週":
      // 開始日から14の倍数の日だけ
      return diffDays % 14 === 0 && lastStr !== todayStr;

    case "月一":
      // 開始日の「日付」と同じ日だけ & 前回実行月とは違う
      if (today.getDate() !== start.getDate()) return false;
      if (!last) return true;
      return today.getMonth() !== last.getMonth();

    default:
      return false;
  }
}

// ============================
// Scheduler メイン処理
// ============================
export const handler: Handler = async () => {
  console.log("🕒 auto-scheduler 起動");

  // ❌ 今の now は削除
  // const now = getJSTDate();
  // const todayStr = formatDate(now);
  // const nowMinutes = now.getHours() * 60 + now.getMinutes();

  // ここで毎回 now を取り直す
  const now = getJSTDate();
  const todayStr = formatDate(now);
  const nowMinutes = now.getHours() * 60 + now.getMinutes();
  // ============================
  // スケジュール取得
  // ============================
  const { data, error } = await supabase
    .from("schedule_settings")
    .select("*")
    .eq("status", true);

  if (error) {
    console.error("❌ schedule_settings 取得エラー:", error);
    return {
      statusCode: 500,
      body: "Failed to load schedules",
    };
  }

  const schedules = (data || []).filter((s) => {
    if (!s.post_time) return false;

    const lastStr = s.last_run_at
      ? formatDate(new Date(s.last_run_at))
      : null;

    // すでに今日 1回実行済みならスキップ
    if (lastStr === todayStr) return false;

    // 投稿時刻（JST）を分に変換
    const [th, tm] = s.post_time.split(":").map(Number);
    const targetMinutes = th * 60 + tm;

    // まだ予定時刻に達していない場合はスキップ
    if (nowMinutes < targetMinutes) return false;

    // サイクル開始・終了日のチェック
    if (s.start_date && todayStr < s.start_date) return false;
    if (s.end_date && todayStr > s.end_date) return false;

    // 頻度条件の判定（毎日/毎週/隔週/月一）
    return shouldRunByFrequency(s, now);
  });

  console.log("🎯 実行対象スケジュール数:", schedules.length);

  // ============================
  // メイン処理
  // ============================
  for (const schedule of schedules) {
    // ============================
    // 排他ロック（同時実行防止）
    // ============================
    const lockNow = new Date();

    const { data: lock } = await supabase
      .from("scheduler_lock")
      .select("*")
      .eq("schedule_id", schedule.id)
      .single();

    // ロックがあり、2分以内なら実行中扱い → スキップ
    if (lock) {
      const diff =
        (lockNow.getTime() - new Date(lock.locked_at).getTime()) / 1000;
      if (diff < 120) {
        console.log("⏳ すでに実行中 → スキップ:", schedule.id);
        continue;
      }
    }

    // ロック獲得
    await supabase
      .from("scheduler_lock")
      .upsert({
        schedule_id: schedule.id,
        locked_at: lockNow.toISOString(),
      });

    try {
      console.log(`🚀 投稿開始: ${schedule.id}`);

      // WP設定取得
      const { data: wpConfig, error: wpError } = await supabase
        .from("wp_configs")
        .select("*")
        .eq("id", schedule.wp_config_id)
        .single();

      if (wpError || !wpConfig) {
        console.error("❌ wp_configs 取得エラー:", wpError);
        continue;
      }

      // 未使用キーワード計算
      const { data: usedWords, error: usedError } = await supabase
        .from("schedule_used_keywords")
        .select("keyword")
        .eq("schedule_id", schedule.id);

      if (usedError) {
        console.error("❌ schedule_used_keywords 取得エラー:", usedError);
        continue;
      }

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

// 記事生成
const { title, content } = await generateArticleByAI(
  schedule.ai_config_id,
  selectedKeyword,
  relatedList
);

// 💥 投稿直前に必ず JST を生成しなおす！
const jstNow = getJSTDate();
const isoDate = jstNow.toISOString().replace("Z", "+09:00");

      // 投稿
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

記事の投稿が完了しましたので、共有させていただきます。

■ 記事タイトル  
${title}

■ キーワード  
${selectedKeyword}

■ 投稿URL  
${postResult.link}

■ 投稿状態  
${schedule.post_status === "publish" ? "公開" : "下書き"}

問題などございましたら、お気軽にお知らせください。 
今後ともよろしくお願いいたします。
`
  );

// 削除項目
// ■ サイト名
// ${wpConfig.name}
// ■ 未使用キーワード残数
// ${remaining} 個
      
      // 使用済みキーワードに登録
      await supabase.from("schedule_used_keywords").insert({
        schedule_id: schedule.id,
        keyword: selectedKeyword,
      });

      // last_run_at 更新（JST文字列を保存：run-scheduler と揃えるならここを合わせる）
      await supabase
        .from("schedule_settings")
        .update({ last_run_at: isoDate })
        .eq("id", schedule.id);

      console.log(`✅ 投稿成功: ${postResult.link}`);
    } catch (err: any) {
      console.error("❌ 投稿エラー:", err?.message || err);
    } finally {
      // 💡 投稿成功・失敗に関わらず必ずロック解除
      await supabase
        .from("scheduler_lock")
        .delete()
        .eq("schedule_id", schedule.id);

      console.log("🔓 ロック解除:", schedule.id);
    }
  }

  return {
    statusCode: 200,
    body: "Scheduler done",
  };
};

// ============================
// Netlify パス設定
// ============================
export const config = {
  path: "/auto-scheduler",
};
