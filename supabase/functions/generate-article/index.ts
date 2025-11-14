import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.57.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
  "Access-Control-Max-Age": "86400",
};


interface RequestBody {
  ai_config_id: string;
  keyword: string;
  related_keywords?: string[];
}

function buildUnifiedPrompt(center: string, aiConfig: any) {
  const tone = aiConfig.tone || "ナチュラル";
  const style = aiConfig.style || "ブログ風";
  const length = aiConfig.article_length || "中程度";
  const language = aiConfig.language || "ja";

  const langLabel =
    language === "ja"
      ? "日本語"
      : language === "en"
      ? "英語"
      : language === "zh"
      ? "中国語"
      : language === "ko"
      ? "韓国語"
      : "日本語";

  const langNote =
    language === "ja"
      ? "自然で読みやすい日本語で書いてください。"
      : language === "en"
      ? "Write in natural, fluent, and readable English for a general audience."
      : language === "zh"
      ? "请使用自然、流畅、易读的简体中文撰写文章。"
      : language === "ko"
      ? "자연스럽고 읽기 쉬운 한국어로 작성해주세요."
      : "自然で読みやすい日本語で書いてください。";

  return `
あなたはSEOに強いプロのライターです。
以下の条件で${langLabel}の記事を作成してください。

【記事の中心テーマ（最重要）】
${center}

※この記事は上記テーマ1つだけを深く掘り下げてください。
※他の関連話題には触れなくてもよい。

【文体トーン】
${tone}

【スタイル】
${style}

【ボリューム】
${length}

# HTMLルール
1. 出力は JSON のみ
2. JSON は "title" と "content" の2フィールドのみ
3. title はテキストのみ（HTMLタグ禁止）
4. content は <h3> から開始する
5. <h1>, <h2>, <h5>, <h6> は使用禁止
6. 段落は <p>...</p> を使い、1段落2〜3文にする
7. 改行文字（\\n, \n）、コードブロック（\`\`\`）は禁止
8. 最後に <h3>まとめ</h3><p>...</p> を付ける

# 出力形式（これのみ）
{
  "title": "タイトル",
  "content": "<h3>...</h3><p>...</p>"
}
`;
}

async function callAI(aiConfig: any, prompt: string): Promise<string> {
  const provider = (aiConfig.provider || "").toLowerCase();
  let text = "";

  if (provider.includes("gemini")) {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${aiConfig.model}:generateContent?key=${aiConfig.api_key}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: {
            temperature: aiConfig.temperature ?? 0.7,
            maxOutputTokens: aiConfig.max_tokens ?? 4000
          }
        })
      }
    );
    const data = await res.json();
    text = data?.candidates?.[0]?.content?.parts?.[0]?.text || "";
  } else if (provider.includes("openai")) {
    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${aiConfig.api_key}`
      },
      body: JSON.stringify({
        model: aiConfig.model,
        messages: [{ role: "user", content: prompt }],
        temperature: aiConfig.temperature ?? 0.7,
        max_tokens: aiConfig.max_tokens ?? 4000
      })
    });
    const data = await res.json();
    text = data?.choices?.[0]?.message?.content || "";
  } else if (provider.includes("claude")) {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": aiConfig.api_key,
        "anthropic-version": "2023-06-01"
      },
      body: JSON.stringify({
        model: aiConfig.model,
        messages: [{ role: "user", content: prompt }],
        temperature: aiConfig.temperature ?? 0.7,
        max_tokens: aiConfig.max_tokens ?? 4000
      })
    });
    const data = await res.json();
    text = data?.content?.[0]?.text || "";
  }

  return text;
}

function parseArticle(rawText: string): { title: string; content: string } {
  const match = rawText.match(/\{[\s\S]*\}/);
  if (!match) throw new Error("JSON構造が見つかりませんでした");

  const article = JSON.parse(match[0]);

  article.content = article.content
    .replace(/\\n|\\r|\\t/g, "")
    .replace(/\n+/g, "")
    .trim();

  return article;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
  return new Response("ok", {
    status: 200,
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json",
    },
  });
}

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

    console.log(`🤖 AI設定: ${aiConfig.provider} - ${aiConfig.model}`);

    const center =
      Array.isArray(related_keywords) && related_keywords.length > 0
        ? related_keywords[Math.floor(Math.random() * related_keywords.length)]
        : keyword;

    console.log(`🎯 中心テーマ: ${center}`);

    const prompt = buildUnifiedPrompt(center, aiConfig);

    console.log("🧠 送信プロンプト:");
    console.log(prompt);

    const rawOutput = await callAI(aiConfig, prompt);

    console.log("📝 AI生出力:");
    console.log(rawOutput.substring(0, 500));

    const article = parseArticle(rawOutput);

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
        keyword: center,
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
