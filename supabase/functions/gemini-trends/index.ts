import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.57.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

interface RequestBody {
  keyword: string;
  ai_config_id: string;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, {
      status: 200,
      headers: corsHeaders,
    });
  }

  try {
    const { keyword, ai_config_id }: RequestBody = await req.json();

    if (!keyword || !ai_config_id) {
      return new Response(
        JSON.stringify({ error: "キーワードとAI設定IDは必須です" }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    console.log(`📊 トレンド分析開始: ${keyword}, AI Config: ${ai_config_id}`);

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const { data: aiConfig, error: configError } = await supabase
      .from("ai_configs")
      .select("*")
      .eq("id", ai_config_id)
      .single();

    if (configError || !aiConfig) {
      console.error(`❌ AI設定取得エラー:`, configError);
      return new Response(
        JSON.stringify({ error: "AI設定が見つかりません" }),
        {
          status: 404,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    if (!aiConfig.api_key) {
      return new Response(
        JSON.stringify({ error: "APIキーが設定されていません" }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    const api_key = aiConfig.api_key;
    const model = aiConfig.model || "gemini-2.0-flash-lite";
    const temperature = aiConfig.temperature || 0.7;

    console.log(`🤖 AI設定: ${aiConfig.provider} - ${model}`);

    const prompt = `あなたはSEOライティングに精通したマーケターです。
指定のキーワードに関連する複合キーワードを10個提案してください。
検索意図が異なるグループごとに整理し、重要度の高い順に並べてください。

キーワード: ${keyword}

出力形式はJSONの配列のみで返してください。説明文は不要です。
例: ["キーワード1","キーワード2","キーワード3"]
`;

    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${api_key}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ role: "user", parts: [{ text: prompt }] }],
          generationConfig: {
            temperature,
            maxOutputTokens: aiConfig.max_tokens || 500,
          },
        }),
      }
    );

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`❌ Gemini APIエラー: ${errorText}`);
      return new Response(
        JSON.stringify({ error: `Gemini APIエラー: ${response.status}` }),
        {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    const result = await response.json();

    if (result.error) {
      console.error(`❌ Geminiエラー: ${result.error.message}`);
      return new Response(
        JSON.stringify({ error: result.error.message }),
        {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    const text = result.candidates?.[0]?.content?.parts?.[0]?.text || "";
    console.log(`📝 Gemini出力: ${text}`);

    let relatedKeywords: string[] = [];
    try {
      const jsonMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/) || text.match(/\[([\s\S]*?)\]/);
      if (jsonMatch) {
        const jsonText = jsonMatch[1] || jsonMatch[0];
        relatedKeywords = JSON.parse(jsonText.includes('[') ? jsonText : `[${jsonText}]`);
      } else {
        relatedKeywords = JSON.parse(text);
      }
    } catch (parseError) {
      console.error(`❌ JSON解析エラー:`, parseError);
      relatedKeywords = text
        .split('\n')
        .map(line => line.replace(/^[\d\-.\*\s]+/, '').trim())
        .filter(line => line.length > 0 && !line.includes('```'))
        .slice(0, 10);
    }

    console.log(`✅ 関連キーワード抽出成功: ${relatedKeywords.length}個`);

    return new Response(
      JSON.stringify({
        keyword,
        related_keywords: relatedKeywords,
        ai_config_id,
        source: "gemini",
      }),
      {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  } catch (err: unknown) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    console.error(`❌ 関数エラー:`, errorMessage);
    return new Response(
      JSON.stringify({ error: errorMessage }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
});
