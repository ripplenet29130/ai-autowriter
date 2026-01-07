import type { Handler } from "@netlify/functions";
import { generateArticleByAI } from "../../src/utils/generateArticle";

export const handler: Handler = async (event) => {
  try {
    const body = JSON.parse(event.body || "{}");

    // 🔍 デバッグ（入れたままでOK）
    console.log("generate-article body:", body);

    // ✅ 必ずここで定義する
    const {
      ai_config_id,
      keyword,
      related_keywords,
      wp_url,
    } = body;

    // ✅ keyword が無い場合は related_keywords から補完
    const centerKeyword =
      keyword || related_keywords?.[0];

    if (!ai_config_id || !centerKeyword) {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: "必須パラメータが不足しています" }),
      };
    }

    const result = await generateArticleByAI(
      ai_config_id,
      centerKeyword,
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
