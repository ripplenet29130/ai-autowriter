import type { Handler } from "@netlify/functions";
import { searchFactsByKeyword } from "../../src/utils/searchFacts";

export const handler: Handler = async (event) => {
  try {
    if (event.httpMethod !== "POST") {
      return { statusCode: 405, body: "Method Not Allowed" };
    }

    const { keyword } = JSON.parse(event.body || "{}");

    if (!keyword || typeof keyword !== "string" || keyword.trim() === "") {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: "keyword parameter is required and must be a non-empty string" }),
      };
    }

    const facts = await searchFactsByKeyword(keyword);

    return {
      statusCode: 200,
      body: JSON.stringify({ facts }),
    };
  } catch (err: any) {
    console.error("api-search error:", err);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: err.message }),
    };
  }
};
