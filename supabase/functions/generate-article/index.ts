import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.57.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

interface RequestBody {
  ai_config_id: string;
  keyword: string;
  related_keywords?: string[];
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, {
      status: 200,
      headers: corsHeaders,
    });
  }

  try {
    const { ai_config_id, keyword, related_keywords = [] }: RequestBody = await req.json();

    if (!keyword || !ai_config_id) {
      return new Response(
        JSON.stringify({ error: "キーワードとAI設定IDは必須です" }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    console.log(`📝 記事生成開始: ${keyword}`);

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
    const tone = aiConfig.tone || "ビジネス";
    const article_length = aiConfig.article_length || "中（1000〜1500字）";
    const style = aiConfig.style || "SEO重視";

    console.log(`🤖 AI設定: ${aiConfig.provider} - ${model}`);
    console.log(`🎭 トーン: ${tone}, スタイル: ${style}, ボリューム: ${article_length}`);

    const relatedKeywordsText = related_keywords.length > 0
      ? related_keywords.join(", ")
      : keyword;

    const prompt = `あなたはプロのSEOライターです。以下の条件で日本語の記事を作成してください。

条件
記事の中心テーマ（関連キーワード群）: ${relatedKeywordsText}
トーン: ${tone}
スタイル: ${style}
ボリューム目安: ${article_length}

構成とHTMLルール
1. タイトルは <h2> タグを使わず、"title" フィールドに文字列として出力。
2. 本文 ("content") は <h3> から始める。
3. 下層に進む場合は <h4> → <h5> → <h6> と階層順に使用。
4. <h1> は使わない。<h2> はタイトル以外に使わない。
5. 最後に <h3>まとめ</h3><p>…</p> を入れる。

出力形式（JSONのみ）
{
  "title": "タイトル（文字列のみ。タグは不要）",
  "content": "<h3>...</h3><p>...</p><h4>...</h4><p>...</p><h3>まとめ</h3><p>...</p>"
}

注意点
- 関連キーワードを主軸に構成（メインキーワードは自然に含める）。
- 見出し階層は論理的に。
- JSON以外の出力は禁止。`;


    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${api_key}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ role: "user", parts: [{ text: prompt }] }],
          generationConfig: {
            temperature,
            maxOutputTokens: aiConfig.max_tokens || 4000,
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
    console.log(`📝 Gemini出力: ${text.substring(0, 200)}...`);

    let article: { title: string; content: string };
    try {
      const jsonMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/) || text.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const jsonText = jsonMatch[1] || jsonMatch[0];
        article = JSON.parse(jsonText);
      } else {
        article = JSON.parse(text);
      }
    } catch (parseError) {
      console.error(`❌ JSON解析エラー:`, parseError);
      return new Response(
        JSON.stringify({ 
          error: "記事の解析に失敗しました",
          raw_output: text 
        }),
        {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    if (!article.title || !article.content) {
      return new Response(
        JSON.stringify({ error: "タイトルまたは本文が生成されませんでした" }),
        {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    console.log(`✅ 記事生成成功: ${article.title}`);

    return new Response(
      JSON.stringify({
        title: article.title,
        content: article.content,
        keyword,
        ai_config_id,
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
