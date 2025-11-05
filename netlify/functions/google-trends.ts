// netlify/functions/google-trends.ts
import type { Handler } from "@netlify/functions";
import googleTrends from "google-trends-api";

export const handler: Handler = async (event) => {
  try {
    const { keyword, timeRange = "now 7-d", geo = "JP" } = JSON.parse(event.body || "{}");

    // ✅ トレンドデータ取得
    const timeline = await googleTrends.interestOverTime({
      keyword,
      geo,
      timeframe: timeRange,
    });
    const rising = await googleTrends.relatedQueries({
      keyword,
      geo,
    });

    // ✅ データを整形
    const timelineData = JSON.parse(timeline).default.timelineData.map((d: any) => ({
      time: d.formattedTime,
      value: d.value[0],
    }));

    const risingData =
      JSON.parse(rising).default.rankedList?.[1]?.rankedKeyword?.map((k: any) => k.query) || [];

    const average =
      timelineData.reduce((sum: number, item: any) => sum + item.value, 0) /
      timelineData.length;

    const trend_score = { average, timeline: timelineData };

    // ✅ 成功レスポンス
    return {
      statusCode: 200,
      body: JSON.stringify({
        trend_score,
        rising: risingData,
      }),
    };
  } catch (error) {
    console.error("Googleトレンド取得エラー:", error);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: "Googleトレンドデータ取得失敗" }),
    };
  }
};
