import type { Handler } from "@netlify/functions";
import { generateArticleByAIWithFacts } from "../../src/utils/generateArticle";
import { searchFactsByKeyword } from "../../src/utils/searchFacts";

export const handler: Handler = async (event) => {
  try {
    if (event.httpMethod !== "POST") {
      return { statusCode: 405, body: "Method Not Allowed" };
    }

    const { ai_config_id, keyword } = JSON.parse(event.body || "{}");
    console.log("preview-with-search keyword:", keyword);

    if (!ai_config_id || !keyword) {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: "missing parameters" }),
      };
    }

    if (typeof keyword !== "string" || keyword.trim() === "") {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: "keyword must be a non-empty string" }),
      };
    }

    const facts = await searchFactsByKeyword(keyword);

    if (!facts || facts.length === 0) {
        return {
          statusCode: 200,
          body: JSON.stringify({
            error: "検索結果が取得できなかったため、記事を生成しませんでした",
            keyword,
            facts_count: 0,
          }),
        };
      }

    const article = await generateArticleByAIWithFacts(
      ai_config_id,
      keyword,
      facts
    );

    return {
      statusCode: 200,
      body: JSON.stringify({
        ...article,
        sources: facts.map((f) => f.source),
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
