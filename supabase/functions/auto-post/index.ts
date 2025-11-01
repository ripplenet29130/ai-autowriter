import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.57.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

interface AIConfig {
  id: string;
  provider: string;
  api_key: string;
  model: string;
  temperature: number;
  max_tokens: number;
  enable_image: boolean;
}

interface WPConfig {
  id: string;
  name: string;
  url: string;
  username: string;
  app_password: string;
  default_category: string;
  is_active: boolean;
}

interface ScheduleSetting {
  id: string;
  ai_config_id: string;
  wp_config_id: string;
  time: string;
  frequency: string;
  status: boolean;
  last_run_at: string | null;
  next_run_at: string | null;
}

async function generateArticle(keyword: string, aiConfig: AIConfig) {
  const prompt = `
あなたはプロのSEOライターです。
次のキーワードで日本語の記事を800文字程度生成してください。
キーワード: ${keyword}
  `;

  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${aiConfig.model}:generateContent?key=${aiConfig.api_key}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        generationConfig: {
          temperature: aiConfig.temperature ?? 0.7,
          maxOutputTokens: aiConfig.max_tokens ?? 1200,
        },
      }),
    }
  );

  const result = await res.json();
  if (result.error) throw new Error(`Geminiエラー: ${result.error.message}`);

  const text =
    result.candidates?.[0]?.content?.parts?.[0]?.text || "（AI出力なし）";

  return {
    title: `${keyword} に関する最新情報`,
    content: text,
  };
}

async function postToWordPress(wpConfig: WPConfig, article: { title: string; content: string }) {
  const payload = {
    title: article.title,
    content: article.content,
    status: "publish",
  };

  const res = await fetch(`${wpConfig.url}/wp-json/wp/v2/posts`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization:
        "Basic " + btoa(`${wpConfig.username}:${wpConfig.app_password}`),
    },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    const errorText = await res.text();
    throw new Error(`WordPress投稿エラー: ${res.status} - ${errorText}`);
  }
  return await res.json();
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, {
      status: 200,
      headers: corsHeaders,
    });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    console.log("🕒 自動投稿関数 起動");

    // 現在時刻を取得（日本時間）
    const now = new Date();
    const jstOffset = 9 * 60;
    const jstTime = new Date(now.getTime() + jstOffset * 60 * 1000);
    const currentTime = jstTime.toTimeString().substring(0, 5); // "HH:MM"
    const currentDay = jstTime.getDay(); // 0-6 (日-土)

    console.log(`📅 現在時刻（JST）: ${currentTime}, 曜日: ${currentDay}`);

    // 有効なスケジュールを取得
    const { data: schedules, error: scheduleError } = await supabase
      .from("schedule_settings")
      .select("*")
      .eq("status", true);

    if (scheduleError) {
      throw new Error(`スケジュール取得エラー: ${scheduleError.message}`);
    }

    if (!schedules || schedules.length === 0) {
      console.log("ℹ️ 有効なスケジュールがありません");
      return new Response(
        JSON.stringify({ message: "有効なスケジュールなし" }),
        {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    const results = [];

    // 各スケジュールをチェック
    for (const schedule of schedules as ScheduleSetting[]) {
      let shouldRun = false;

      // 時刻チェック
      if (schedule.time === currentTime) {
        // 頻度チェック
        if (schedule.frequency === "毎日") {
          shouldRun = true;
        } else if (schedule.frequency === "毎週" && currentDay === 1) {
          // 月曜日
          shouldRun = true;
        } else if (schedule.frequency === "毎月" && jstTime.getDate() === 1) {
          // 月初
          shouldRun = true;
        }
      }

      if (!shouldRun) continue;

      console.log(`▶️ スケジュール実行: ${schedule.id}`);

      // AI/WP設定を取得
      const [aiResult, wpResult] = await Promise.all([
        supabase.from("ai_configs").select("*").eq("id", schedule.ai_config_id).single(),
        supabase.from("wp_configs").select("*").eq("id", schedule.wp_config_id).single(),
      ]);

      if (aiResult.error || wpResult.error) {
        console.error("❌ 設定取得エラー", aiResult.error || wpResult.error);
        results.push({
          schedule_id: schedule.id,
          status: "error",
          message: "設定取得エラー",
        });
        continue;
      }

      const aiConfig = aiResult.data as AIConfig;
      const wpConfig = wpResult.data as WPConfig;

      try {
        // 記事生成
        const keyword = "AGA治療";
        const article = await generateArticle(keyword, aiConfig);

        // WordPress投稿
        const post = await postToWordPress(wpConfig, article);

        console.log(`✅ 投稿成功: ${post.link}`);

        // 投稿履歴を記録
        await supabase.from("post_history").insert({
          schedule_id: schedule.id,
          ai_config_id: schedule.ai_config_id,
          wp_config_id: schedule.wp_config_id,
          title: article.title,
          content: article.content,
          wp_post_id: post.id,
          wp_post_url: post.link,
          status: "success",
        });

        // last_run_atを更新
        await supabase
          .from("schedule_settings")
          .update({ last_run_at: new Date().toISOString() })
          .eq("id", schedule.id);

        results.push({
          schedule_id: schedule.id,
          status: "success",
          post_url: post.link,
        });
      } catch (err: unknown) {
        const errorMessage = err instanceof Error ? err.message : String(err);
        console.error(`❌ 投稿エラー:`, errorMessage);

        // エラー履歴を記録
        await supabase.from("post_history").insert({
          schedule_id: schedule.id,
          ai_config_id: schedule.ai_config_id,
          wp_config_id: schedule.wp_config_id,
          title: "",
          content: "",
          wp_post_id: null,
          wp_post_url: null,
          status: "error",
          error_message: errorMessage,
        });

        results.push({
          schedule_id: schedule.id,
          status: "error",
          message: errorMessage,
        });
      }
    }

    return new Response(
      JSON.stringify({ results, processed_count: results.length }),
      {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  } catch (err: unknown) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    console.error("❌ 関数エラー:", errorMessage);
    return new Response(
      JSON.stringify({ error: errorMessage }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
});
