import type { Handler } from "@netlify/functions";

// 既存ロジックをそのまま使う
import { generateArticleByAIWithFacts } from "../../src/utils/generateArticle";

// api-search を「関数として」呼ぶための処理
async function searchFacts(keyword: string) {
    const baseUrl =
      process.env.DEPLOY_PRIME_URL ||
      process.env.URL ||
      "";
  
    const res = await fetch(
      `${baseUrl}/.netlify/functions/api-search`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ keyword }),
      }
    );
  
    if (!res.ok) {
      throw new Error("search failed");
    }
  
    const data = await res.json();
    return data.facts;
  }
  

export const handler: Handler = async (event) => {
  try {
    if (event.httpMethod !== "POST") {
      return { statusCode: 405, body: "Method Not Allowed" };
    }

    const { ai_config_id, keyword } = JSON.parse(event.body || "{}");

    if (!ai_config_id || !keyword) {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: "missing parameters" }),
      };
    }

    // ① 検索
    const facts = await searchFacts(keyword);

    // ② 記事生成
    const article = await generateArticleByAIWithFacts(
      ai_config_id,
      keyword,
      facts
    );

    // ③ 参照元も一緒に返す
    return {
      statusCode: 200,
      body: JSON.stringify({
        ...article,
        sources: facts.map((f: any) => f.source),
      }),
    };
  } catch (err: any) {
    console.error("preview-with-search error:", err);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: err.message }),
    };
  }
};
