// netlify/functions/google-trends.ts
import googleTrends from "google-trends-api";

export const handler = async (event: any) => {
  if (event.httpMethod !== "POST") {
    return {
      statusCode: 405,
      body: JSON.stringify({ error: "Method Not Allowed" }),
    };
  }

  try {
    const { keyword, geo = "JP", timeRange = "now 7-d" } = JSON.parse(event.body || "{}");

    if (!keyword) {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: "keyword is required" }),
      };
    }

    // --- Googleトレンドからデータ取得 ---
    const [timelineRes, relatedRes] = await Promise.all([
      googleTrends.interestOverTime({ keyword, geo, timeframe: timeRange }),
      googleTrends.relatedQueries({ keyword, geo, timeframe: timeRange }),
    ]);

    const timelineJson = JSON.parse(timelineRes);
    const relatedJson = JSON.parse(relatedRes);

    // --- タイムライン整形 ---
    const timeline = timelineJson.default.timelineData.map((d: any) => ({
      time: d.formattedTime,
      value: d.value[0],
    }));

    // --- 人気上昇中のキーワード抽出 ---
    const rising =
      relatedJson.default.rankedList[1]?.rankedKeyword?.map((r: any) => r.query) || [];

    // --- スコア算出 ---
    const avg = timeline.reduce((a: number, b: any) => a + b.value, 0) / timeline.length;
    const max = Math.max(...timeline.map((d: any) => d.value));
    const min = Math.min(...timeline.map((d: any) => d.value));

    // --- レスポンス ---
    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        keyword,
        timeline,
        rising,
        trend_score: { average: avg, max, min },
      }),
    };
  } catch (error) {
    console.error("Googleトレンド取得エラー:", error);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: "トレンドデータ取得に失敗しました" }),
    };
  }
};

