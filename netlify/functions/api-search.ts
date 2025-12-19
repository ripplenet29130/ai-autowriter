// netlify/functions/api-search.ts
import type { Handler } from "@netlify/functions";

/**
 * 事実データの型
 * AIにはこの情報しか渡さない
 */
type Fact = {
  source: string;   // 情報元URL
  content: string;  // 検索結果の事実要約（snippet）
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

    /**
     * 🔽 ここが一番重要
     * 検索結果 → facts（事実）に変換
     */
    const facts: Fact[] =
      data.webPages?.value?.map((item: any) => ({
        source: item.url,
        content: item.snippet,
      })) || [];

    return {
      statusCode: 200,
      body: JSON.stringify({ facts }),
    };
  } catch (error: any) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: error.message }),
    };
  }
};
