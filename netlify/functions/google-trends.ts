import type { Handler } from "@netlify/functions";
import googleTrends from "google-trends-api";

export const handler: Handler = async (event) => {
  const { keyword } = JSON.parse(event.body || "{}");

  if (!keyword) {
    return {
      statusCode: 400,
      body: JSON.stringify({ error: "キーワードが必要です" }),
    };
  }

  try {
    // --- 関連キーワード ---
    const relatedRaw = await googleTrends.relatedQueries({
      keyword,
      geo: "JP",
    });

    const relatedJson = JSON.parse(relatedRaw);
    const related =
      relatedJson.default?.rankedList ?? [];

    // --- 推移データ ---
    const timelineRaw = await googleTrends.interestOverTime({
      keyword,
      geo: "JP",
      timeframe: "today 1-m",
    });

    const timelineJson = JSON.parse(timelineRaw);
    const timeline =
      timelineJson.default?.timelineData?.map((item: any) => ({
        formattedTime: item.formattedTime,
        value: item.value,
      })) ?? [];

    return {
      statusCode: 200,
      body: JSON.stringify({ related, timeline }),
    };

  } catch (e) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: "Google Trends Error", details: e }),
    };
  }
};
