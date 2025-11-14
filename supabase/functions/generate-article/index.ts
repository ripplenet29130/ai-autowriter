import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.57.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "*",
  "Access-Control-Max-Age": "86400",
};

// フロントから送られるデータを正しく定義
interface RequestBody {
  ai_config_id: string;
  center: string;   // ← 修正
}

Deno.serve(async (req: Request) => {
  // -----------------------------------------
  // 🔥 CORS プリフライト対応
  // -----------------------------------------
  if (req.method === "OPTIONS") {
    return new Response("ok", {
      status: 200,
      headers: { ...corsHeaders },
    });
  }

  try {
    const { ai_config_id, center }: RequestBody = await req.json();

    // -----------------------------------------
    // フロントと揃える（center が必須）
    // -----------------------------------------
    if (!center || !ai_config_id) {
      return new Response(
        JSON.stringify({ error: "center と ai_config_id は必須です" }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    console.log(`✨ 記事生成（中心テーマ）: ${center}`);

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    // AI設定取得
    const { data: aiConfig, error: configError } = await supabase
      .from("ai_configs")
      .select("*")
      .eq("id", ai_config_id)
      .single();

    if (configError || !aiConfig) {
      console.error("AI設定取得エラー:", configError);
      return new Response(JSON.stringify({ error: "AI設定が見つかりません" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // プロンプト作成
    const prompt = buildUnifiedPrompt(center, aiConfig);

    // AI呼び出し
    const rawOutput = await callAI(aiConfig, prompt);

    // JSON解析
    const article = parseArticle(rawOutput);

    return new Response(
      JSON.stringify({
        title: article.title,
        content: article.content,
        center_keyword: center,
      }),
      {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );

  } catch (err) {
    console.error("❌ 関数エラー:", err);
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
