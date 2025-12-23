// netlify/functions/preview-article.ts
import type { Handler } from "@netlify/functions";
import { generateArticleByAIWithFacts } from "../../src/utils/generateArticle";

export const handler: Handler = async (event) => {
  try {
    if (event.httpMethod !== "POST") {
      return { statusCode: 405, body: "Method Not Allowed" };
    }

    const { ai_config_id, keyword, facts } = JSON.parse(event.body || "{}");

    if (!ai_config_id || !keyword || !facts) {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: "missing parameters" }),
      };
    }

    if (!Array.isArray(facts)) {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: "facts must be an array" }),
      };
    }

    const article = await generateArticleByAIWithFacts(
      ai_config_id,
      keyword,
      facts
    );

    return {
      statusCode: 200,
      body: JSON.stringify(article),
    };
  } catch (err: any) {
    console.error("preview-article error:", err);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: err.message }),
    };
  }
};
