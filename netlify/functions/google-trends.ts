// netlify/functions/google-trends.ts
import type { Handler } from "@netlify/functions";
import googleTrends from "google-trends-api";

const handler: Handler = async (event) => {
  try {
    const { keyword, timeRange = "now 7-d", geo = "JP" } = JSON.parse(event.body || "{}");

    if (!keyword) {
      return new Response(JSON.stringify({ error: "Keyword is required" }), { status: 400 });
    }

    // ---- 人気度の時系列データを取得 ----
    const timelineData = await googleTrends.interestOverTime({
      keyword,
      geo,
      timeframe: timeRange,
    });

    const parsedTimeline = JSON.parse(timelineData);
    const timeline = parsedTimeline.default.timelineData.map((item: any) => ({
      time: new Date(item.time * 1000).toLocaleDateString("ja-JP"),
      value: item.value[0],
    }));

    // ---- 上昇キーワードを取得 ----
    const risingData = await googleTrends.relatedQueries({ keyword, geo });
    const parsedRising = JSON.parse(risingData);
    const rising = parsedRising.default.rankedList?.[1]?.rankedKeyword?.map((k: any) => k.query) || [];

    // ---- 平均スコア算出 ----
    const average = Math.round(
      timeline.reduce((sum: number, item: any) => sum + item.value, 0) / timeline.length
    );

    return new Response(
      JSON.stringify({
        keyword,
        timeline,
        rising,
        trend_score: { average },
      }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );
  } catch (error: any) {
    console.error("Google Trends Error:", error);
    return new Response(JSON.stringify({ error: "Failed to fetch Google Trends" }), { status: 500 });
  }
};

export { handler };
