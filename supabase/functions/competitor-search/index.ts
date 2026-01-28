import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { corsHeaders } from "../_shared/cors.ts";
import { DOMParser } from "https://deno.land/x/deno_dom/deno-dom-wasm.ts";

console.log("強化版・競合検索関数が起動しました");

interface CompetitorArticle {
  title: string;
  url: string;
  domain: string;
  wordCount: number;
  headings: string[];
  metaDescription: string;
  excerpt: string;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const { keyword, limit = 3, serpApiKey } = await req.json();

    if (!keyword) {
      return new Response(JSON.stringify({ error: "キーワードが必要です" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // APIキーの取得（リクエストから、または環境変数から）
    const apiKey = serpApiKey || Deno.env.get("SERPAPI_KEY");

    if (!apiKey) {
      return new Response(JSON.stringify({ error: "SerpAPIキーが設定されていません。フロントエンドから渡すか、SupabaseのSecretsに設定してください。" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    console.log(`SerpAPIで検索開始: "${keyword}"`);
    const searchUrl = `https://serpapi.com/search.json?engine=google&q=${encodeURIComponent(keyword)}&api_key=${apiKey}&gl=jp&hl=ja&num=${limit}`;

    const searchRes = await fetch(searchUrl);
    if (!searchRes.ok) {
      throw new Error(`SerpAPI error: ${searchRes.status}`);
    }

    const searchData = await searchRes.json();
    const results = searchData.organic_results || [];

    const topArticles: CompetitorArticle[] = [];

    // 並列でスクレイピングを実行
    const scrapePromises = results.slice(0, limit).map(async (item: any) => {
      const url = item.link;
      console.log(`スクレイピング開始: ${url}`);

      try {
        const controller = new AbortController();
        const id = setTimeout(() => controller.abort(), 8000); // 8秒タイムアウト

        const res = await fetch(url, {
          headers: {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36",
          },
          signal: controller.signal
        });
        clearTimeout(id);

        if (!res.ok) throw new Error(`Fetch failed: ${res.status}`);

        const html = await res.text();
        const doc = new DOMParser().parseFromString(html, "text/html");

        if (!doc) throw new Error("DOM解析に失敗しました");

        // 不要なタグの削除
        const scripts = doc.querySelectorAll("script, style, nav, footer, header, noscript");
        scripts.forEach(s => (s as any).remove());

        // 見出しの抽出 (H2, H3)
        const headingElements = doc.querySelectorAll("h2, h3");
        const headings = Array.from(headingElements)
          .map(h => h.textContent.trim())
          .filter(t => t.length > 2 && t.length < 100)
          .slice(0, 15); // 最大15個

        // 本文の抽出（簡易版）
        const paragraphs = doc.querySelectorAll("p, article");
        let excerpt = Array.from(paragraphs)
          .map(p => p.textContent.trim())
          .filter(t => t.length > 20)
          .join(" ")
          .substring(0, 2000); // 最初の2000文字

        return {
          title: item.title,
          url: url,
          domain: new URL(url).hostname,
          wordCount: excerpt.length,
          headings: headings.length > 0 ? headings : [item.title],
          metaDescription: item.snippet || "",
          excerpt: excerpt
        };
      } catch (err) {
        console.error(`スクレイピング失敗: ${url}`, err.message);
        return {
          title: item.title,
          url: url,
          domain: new URL(url).hostname,
          wordCount: 0,
          headings: [item.title],
          metaDescription: item.snippet || "",
          excerpt: item.snippet || "コンテンツの取得に失敗しました。"
        };
      }
    });

    const scrapedResults = await Promise.all(scrapePromises);

    const validArticles = scrapedResults.filter(a => a !== null) as CompetitorArticle[];
    const averageLength = validArticles.length > 0
      ? Math.floor(validArticles.reduce((s, a) => s + a.wordCount, 0) / validArticles.length)
      : 0;

    return new Response(
      JSON.stringify({
        topArticles: validArticles,
        averageLength,
        commonTopics: [] // 必要に応じて抽出
      }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );

  } catch (error: any) {
    console.error("エラー:", error);
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
