import type { Handler } from "@netlify/functions";
import { generateArticleByAI } from "../../src/utils/generateArticle";

export const handler: Handler = async (event) => {
  try {
    const body = JSON.parse(event.body || "{}");

    const { ai_config_id, keyword, related_keywords, wp_url } = body;

    if (!ai_config_id || !keyword) {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: "必須パラメータが不足しています" }),
      };
    }

    // 🔥 スケジューラーと同じロジック
    const result = await generateArticleByAI(
      ai_config_id,
      keyword,
      related_keywords || []
    );

    return {
      statusCode: 200,
      body: JSON.stringify({
        ...result,
        post_url: `${wp_url?.replace(/\/$/, "")}/`,
      }),
    };
  } catch (err) {
    console.error("generate-article エラー:", err);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: (err as Error).message }),
    };
  }
};
