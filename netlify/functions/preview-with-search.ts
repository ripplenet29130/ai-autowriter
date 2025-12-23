import type { Handler } from "@netlify/functions";
import { generateArticleByAIWithFacts } from "../../src/utils/generateArticle";
import { searchFactsByKeyword } from "../../src/utils/searchFacts";

export const handler: Handler = async (event) => {
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: "Method Not Allowed" };
  }

  const { ai_config_id, keyword } = JSON.parse(event.body || "{}");

  const facts = await searchFactsByKeyword(keyword);

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
};
