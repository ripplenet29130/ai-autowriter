// ===============================================
// api-search.ts（SerpAPI / Google検索）
// ===============================================

import type { Handler } from "@netlify/functions";

type Fact = {
  source: string;
  content: string;
};

export const handler: Handler = async (event) => {
  try {
    if (event.httpMethod !== "POST") {
      return { statusCode: 405, body: "Method Not Allowed" };
    }

    const { keyword } = JSON.parse(event.body || "{}");

    if (!keyword) {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: "keyword is required" }),
      };
    }

    // -------------------------------
    // SerpAPI（Google検索）
    // -------------------------------
    const params = new URLSearchParams({
      q: keyword,
      engine: "google",
      hl: "ja",
      gl: "jp",
      num: "5",
      api_key: process.env.SERPAPI_API_KEY!,
    });

    const res = await fetch(
      `https://serpapi.com/search.json?${params.toString()}`
    );

    if (!res.ok) {
      throw new Error(`SerpAPI error: ${res.status}`);
    }

    const data = await res.json();

    // -------------------------------
    // facts 生成
    // -------------------------------
    const facts: Fact[] =
      data.organic_results?.map((item: any) => ({
        source: item.link,
        content: item.snippet,
      })) || [];

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
