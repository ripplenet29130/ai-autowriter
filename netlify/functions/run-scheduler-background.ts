// netlify/functions/run-scheduler.ts
import type { Handler } from "@netlify/functions";
import { createClient } from "@supabase/supabase-js";
import { generateArticleByAI } from "../../src/utils/generateArticle";
import { notifyPostSuccess } from "../../src/utils/notifyPostSuccess";

// JST helpers
function getJST(): Date {
  const utc = new Date();
  return new Date(utc.getTime() + 9 * 60 * 60 * 1000);
}
function toWordPressDate(jstDate: Date): string {
  return jstDate.toISOString().replace("Z", "+09:00");
}
function toJSTString(jstDate: Date): string {
  return jstDate.toISOString().replace("Z", "+09:00");
}

async function postToWordPress(
  wp: any,
  article: { title: string; content: string; date: string },
  status: "draft" | "publish"
) {
  console.log(`🌐 [run-scheduler] WP投稿開始: ${wp.url}`);

  const baseUrl = String(wp.url || "").replace(/\/$/, "");
  const endpoint = `${baseUrl}/wp-json/wp/v2/posts`;

  const credential = Buffer.from(`${wp.username}:${wp.app_password}`).toString("base64");

  async function getCategoryIdBySlug(slug: string) {
    try {
      const res = await fetch(
        `${baseUrl}/wp-json/wp/v2/categories?slug=${encodeURIComponent(slug)}`,
        { headers: { Authorization: `Basic ${credential}` } }
      );
      if (!res.ok) return 1;
      const categories = await res.json();
      return categories?.length > 0 ? categories[0].id : 1;
    } catch (e) {
      console.error("❌ [run-scheduler] カテゴリ取得エラー:", e);
      return 1;
    }
  }

  let categoryId = 1;
  if (wp.default_category) {
    const v = String(wp.default_category).trim();
    categoryId = !isNaN(Number(v)) ? Number(v) : await getCategoryIdBySlug(v);
  }

  const payload = {
    title: article.title,
    content: article.content,
    categories: [categoryId],
    status,
    date: article.date,
    // 🔍 追跡用（不要なら消してOK）：WP側で「run-scheduler」起点と分かる
    // meta: { generated_by: "run-scheduler" },
  };

  console.log("🧾 [run-scheduler] WP payload:", {
    title: payload.title,
    status: payload.status,
    categories: payload.categories,
    date: payload.date,
  });

  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Basic ${credential}`,
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`投稿失敗 (${response.status}): ${text}`);
  }

  return await response.json();
}

export const handler: Handler = async (event) => {
  const requestId =
    event.headers["x-nf-request-id"] ||
    event.headers["x-request-id"] ||
    event.headers["x-amzn-trace-id"] ||
    "unknown";

  console.log("⚡ [run-scheduler] START", {
    requestId,
    method: event.httpMethod,
    path: event.path,
    time: new Date().toISOString(),
  });

  try {
    // body解析（GET等でbodyが空でも落とさない）
    let body: any = {};
    if (event.body) {
      try {
        body = JSON.parse(event.body);
      } catch {
        console.warn("⚠️ [run-scheduler] body JSON parse failed. raw body:", event.body);
      }
    }

    const scheduleId = body?.schedule_id;
    if (!scheduleId) {
      console.warn("⚠️ [run-scheduler] schedule_id missing", { body });
      return { statusCode: 400, body: "schedule_id が必要です" };
    }

    const supabase = createClient(
      process.env.SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_KEY!
    );

    const { data: schedule, error: schErr } = await supabase
      .from("schedule_settings")
      .select("*")
      .eq("id", scheduleId)
      .single();

    if (schErr || !schedule) {
      console.error("❌ [run-scheduler] schedule_settings 取得失敗", schErr);
      return { statusCode: 404, body: "Schedule not found" };
    }

    const { data: wpConfig, error: wpErr } = await supabase
      .from("wp_configs")
      .select("*")
      .eq("id", schedule.wp_config_id)
      .single();

    if (wpErr || !wpConfig) {
      console.error("❌ [run-scheduler] wp_configs 取得失敗", wpErr);
      return { statusCode: 500, body: "WP設定が見つかりません" };
    }

    const { data: usedWords, error: usedErr } = await supabase
      .from("schedule_used_keywords")
      .select("keyword")
      .eq("schedule_id", schedule.id);

    if (usedErr) {
      console.error("❌ [run-scheduler] used keywords 取得失敗", usedErr);
      return { statusCode: 500, body: "used keywords load failed" };
    }

    const usedSet = new Set((usedWords || []).map((u: any) => u.keyword));
    const relatedList: string[] = Array.isArray(schedule.related_keywords) ? schedule.related_keywords : [];
    const unused = relatedList.filter((kw) => !usedSet.has(kw));

    if (unused.length === 0) {
      console.warn("⚠️ [run-scheduler] unused keywords empty");
      return { statusCode: 400, body: "未使用キーワードがありません" };
    }

    const selectedKeyword = unused[Math.floor(Math.random() * unused.length)];
    console.log("🧠 [run-scheduler] selectedKeyword:", selectedKeyword);

    // 記事生成（relatedListは渡さず、選ばれたキーワードで検索→生成）
    const articleResult = await generateArticleByAI(schedule.ai_config_id, selectedKeyword, []);

    const { title, content, center_keyword } = articleResult;
    console.log("📝 [run-scheduler] generated:", {
      center: center_keyword || selectedKeyword,
      title,
      contentLength: (content || "").length,
    });

    const nowJST = getJST();
    const wpDate = toWordPressDate(nowJST);
    const jstString = toJSTString(nowJST);

    const postStatus: "draft" | "publish" =
      schedule.post_status === "draft" ? "draft" : "publish";

    const postResult = await postToWordPress(
      wpConfig,
      { title, content, date: wpDate },
      postStatus
    );

    await notifyPostSuccess({
      title,
      keyword: center_keyword || selectedKeyword,
      postUrl: postResult.link,
      postStatus,
      roomId: schedule.chatwork_room_id,
    });

    await supabase.from("schedule_used_keywords").insert({
      schedule_id: schedule.id,
      keyword: selectedKeyword,
    });

    await supabase
      .from("schedule_settings")
      .update({ last_run_at: jstString })
      .eq("id", schedule.id);

    console.log("✅ [run-scheduler] END", { requestId, postUrl: postResult.link });

    return {
      statusCode: 200,
      body: JSON.stringify({
        message: "即時実行完了",
        posted: postResult.link,
        requestId,
      }),
    };
  } catch (err: any) {
    console.error("❌ [run-scheduler] FATAL", err?.message || err, err);
    return { statusCode: 500, body: "run-scheduler failed" };
  }
};
