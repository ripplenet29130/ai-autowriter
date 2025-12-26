// netlify/functions/run-scheduler.ts
import type { Handler } from "@netlify/functions";
import { createClient } from "@supabase/supabase-js";
import { generateArticleByAI } from "../../src/utils/generateArticle";
// import { notifyFactReject } from "../../src/utils/notifyFactReject";
import { notifyPostSuccess } from "../../src/utils/notifyPostSuccess";

// ============================
// JST Helper（JST 文字列を返す）
// ============================

// JST を Date 型として返す
function getJST(): Date {
  const utc = new Date();
  return new Date(utc.getTime() + 9 * 60 * 60 * 1000);
}

// JST Date → WordPress 用 +09:00 形式
function toWordPressDate(jstDate: Date): string {
  return jstDate.toISOString().replace("Z", "+09:00");
}

// JST Date → Supabase 保存用
function toJSTString(jstDate: Date): string {
  // 例: "2025-11-26T14:00:08+09:00"
  return jstDate.toISOString().replace("Z", "+09:00");
}

// ============================
// WordPress 投稿処理
// ============================
async function postToWordPress(
  wp: any,
  article: { title: string; content: string; date: string },
  status: "draft" | "publish"
) {
  console.log(`🌐 WordPress投稿開始: ${wp.url}`);
  const endpoint = `${wp.url.replace(/\/$/, "")}/wp-json/wp/v2/posts`;

  const credential = Buffer.from(
    `${wp.username}:${wp.app_password}`
  ).toString("base64");

  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Basic ${credential}`,
    },
    body: JSON.stringify({
      title: article.title,
      content: article.content,
      status,
      date: article.date, // JST(+09:00)
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`投稿失敗 (${response.status}): ${text}`);
  }

  return await response.json();
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

  if (!schedule) return { statusCode: 404, body: "Schedule not found" };

  // WP設定取得
  const { data: wpConfig } = await supabase
    .from("wp_configs")
    .select("*")
    .eq("id", schedule.wp_config_id)
    .single();

  if (!wpConfig)
    return { statusCode: 500, body: "WP設定が見つかりません" };

  // 使用済みキーワード取得
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
    return { statusCode: 400, body: "未使用キーワードがありません" };
  }

  const selectedKeyword =
    unused[Math.floor(Math.random() * unused.length)];

  // ============================
  // 記事生成
  // ============================
  const articleResult = await generateArticleByAI(
    schedule.ai_config_id,
    selectedKeyword,
    relatedList
  );

  const { title, content, is_rejected, fact_check, center_keyword } = articleResult;

  // ============================
  // JST の正しい作成
  // ============================
  const nowJST = getJST();

  // WordPress投稿用
  const wpDate = toWordPressDate(nowJST);

  // Supabase保存用
  const jstString = toJSTString(nowJST);

  // ============================
  // WordPressに投稿
  // ============================
  const postStatus: "draft" | "publish" =
    schedule.post_status === "draft" ? "draft" : "publish";

  const postResult = await postToWordPress(
    wpConfig,
    {
      title,
      content,
      date: wpDate,
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

  // ============================
  // ChatWork通知（投稿完了通知）
  // ============================
  await notifyPostSuccess({
    title,
    keyword: center_keyword || selectedKeyword,
    postUrl: postResult.link,
    postStatus: postStatus,
    roomId: schedule.chatwork_room_id,
  });

// 削除項目
// ■ サイト名
// ${wpConfig.name}
// ■ 未使用キーワード残数
// ${remaining} 個


  // 使用済みに登録
  await supabase.from("schedule_used_keywords").insert({
    schedule_id: schedule.id,
    keyword: selectedKeyword,
  });

  // ============================
  // last_run_at を JST のまま保存
  // ============================
  await supabase
    .from("schedule_settings")
    .update({ last_run_at: jstString })
    .eq("id", schedule.id);

  return {
    statusCode: 200,
    body: JSON.stringify({
      message: "即時実行完了",
      posted: postResult.link,
    }),
  };
};
