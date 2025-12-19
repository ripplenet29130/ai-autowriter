// netlify/functions/api-search.ts
import type { Handler } from "@netlify/functions";

type SearchResult = {
  title: string;
  snippet: string;
  url: string;
};

export const handler: Handler = async (event) => {
  try {
    if (event.httpMethod !== "POST") {
      return { statusCode: 405, body: "Method Not Allowed" };
    }

    const { keyword } = JSON.parse(event.body || "{}");
    if (!keyword) {
      return { statusCode: 400, body: "keyword is required" };
    }

    const endpoint = "https://api.bing.microsoft.com/v7.0/search";
    const params = new URLSearchParams({
      q: keyword,
      mkt: "ja-JP",
      count: "5",
    });

    const res = await fetch(`${endpoint}?${params.toString()}`, {
      headers: {
        "Ocp-Apim-Subscription-Key": process.env.BING_API_KEY!,
      },
    });

    if (!res.ok) {
      throw new Error(`Bing API error: ${res.status}`);
    }

    const data = await res.json();

    const results: SearchResult[] =
      data.webPages?.value?.map((item: any) => ({
        title: item.name,
        snippet: item.snippet,
        url: item.url,
      })) || [];

    return {
      statusCode: 200,
      body: JSON.stringify({ results }),
    };
  } catch (error: any) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: error.message }),
    };
  }
};
