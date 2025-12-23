import type { Handler } from "@netlify/functions";
import { searchFactsByKeyword } from "../../src/utils/searchFacts";

export const handler: Handler = async (event) => {
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: "Method Not Allowed" };
  }

  const { keyword } = JSON.parse(event.body || "{}");

  const facts = await searchFactsByKeyword(keyword);

  return {
    statusCode: 200,
    body: JSON.stringify({ facts }),
  };
};
