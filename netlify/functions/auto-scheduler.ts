// netlify/functions/auto-scheduler.ts
import type { Handler } from "@netlify/functions";
import { createClient } from "@supabase/supabase-js";
import { generateArticleByAI } from "../../src/utils/generateArticle";
// import { notifyFactReject } from "../../src/utils/notifyFactReject";
import { notifyPostSuccess } from "../../src/utils/notifyPostSuccess";

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
// WordPress 投稿処理
// ============================
async function postToWordPress(
  wp: any,
  article: {
    title: string;
    content: string;
    date: string;
  },
  status: "draft" | "publish"
) {
console.log(`🌐 WordPress投稿開始: ${wp.url}`);
const baseUrl = wp.url.replace(/\/$/, "");
const endpoint = `${baseUrl}/wp-json/wp/v2/posts`;

const credential = Buffer.from(
  `${wp.username}:${wp.app_password}`
).toString("base64");

async function getCategoryIdBySlug(slug: string) {
  try {
    const res = await fetch(
      `${baseUrl}/wp-json/wp/v2/categories?slug=${encodeURIComponent(slug)}`,
      { headers: { Authorization: `Basic ${credential}` } }
    );

    if (!res.ok) return 1;

    const categories = await res.json();
    return categories.length > 0 ? categories[0].id : 1;
  } catch (e) {
    console.error("カテゴリ取得エラー:", e);
    return 1;
  }
}

let categoryId = 1;

if (wp.default_category) {
  const v = String(wp.default_category).trim(); // ← 念のためトリム
  if (!isNaN(Number(v))) {
    categoryId = Number(v);
  } else {
    categoryId = await getCategoryIdBySlug(v);
  }
}

console.log("✅ default_category:", wp.default_category, "=> categoryId:", categoryId);

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
      status,
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
      const articleResult = await generateArticleByAI(
        schedule.ai_config_id,
        selectedKeyword,
        relatedList
      );

      const { title, content, is_rejected, fact_check, center_keyword } = articleResult;

      // ============================
      // 最終投稿ステータス決定（ファクトチェックOFF）
      // ============================
      /*
      const postStatus: "draft" | "publish" =
        is_rejected === true
          ? "draft"
          : schedule.post_status === "draft"
          ? "draft"
          : "publish";
      */
      const postStatus: "draft" | "publish" =
        schedule.post_status === "draft" ? "draft" : "publish";

      // 💥 投稿直前に必ず JST を生成しなおす！
      const jstNow = getJSTDate();
      const isoDate = jstNow.toISOString().replace("Z", "+09:00");

      // 投稿
      const postResult = await postToWordPress(
        wpConfig,
        {
          title,
          content,
          date: isoDate,
        },
        postStatus
      );

      // ファクトチェックOFF - reject通知は不要
      /*
      // ============================
      // reject 通知（reject の場合のみ）
      // ============================
      if (is_rejected === true && fact_check?.reasons) {
        try {
          await notifyFactReject({
            keyword: center_keyword || selectedKeyword,
            title,
            reasons: fact_check.reasons,
            roomId: schedule.chatwork_room_id || "",
          });
        } catch (err) {
          console.error("❌ reject通知エラー:", err);
          // reject通知のエラーは処理を止めない
        }
      }
      */

      // ChatWork 通知（投稿完了通知）
      const remaining = unused.length - 1;

      await notifyPostSuccess({
        title,
        keyword: center_keyword || selectedKeyword,
        postUrl: postResult.link,
        postStatus: postStatus,
        roomId: schedule.chatwork_room_id,
        remaining,
      });


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
