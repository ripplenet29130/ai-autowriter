// netlify/functions/google-trends.ts
import type { Handler } from "@netlify/functions";
import googleTrends from "google-trends-api";
import { createClient } from "@supabase/supabase-js";

// ✅ Netlify環境変数名に変更（VITE_を削除）
const supabase = createClient(
  process.SUPABASE_URL!,
  process.SUPABASE_SERVICE_KEY!
);

export const handler: Handler = async (event) => {
  try {
    const { keyword } = JSON.parse(event.body || "{}");
    if (!keyword) {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: "keywordが指定されていません" }),
      };
    }

    // === Googleトレンド人気度データ取得 ===
    const timelineResults = await googleTrends.interestOverTime({
      keyword,
      geo: "JP",
      timeframe: "today 3-m",
    });

    const parsedTimeline = JSON.parse(timelineResults);
    const timeline = parsedTimeline.default.timelineData.map((item: any) => ({
      time: new Date(Number(item.time) * 1000).toLocaleDateString("ja-JP"),
      value: item.value[0],
    }));

    const trendScore = {
      average: Math.round(
        timeline.reduce((acc: number, t: any) => acc + t.value, 0) / timeline.length
      ),
      timeline,
    };

    // === 上昇関連キーワード取得 ===
    const relatedResults = await googleTrends.relatedQueries({
      keyword,
      geo: "JP",
    });

    const parsedRelated = JSON.parse(relatedResults);
    const risingKeywords =
      parsedRelated.default?.rankedList[1]?.rankedKeyword?.map((r: any) => r.query) || [];

    // === Supabaseへ保存 ===
    const { error } = await supabase
      .from("trend_keywords")
      .update({
        trend_score: trendScore,
        rising_keywords: risingKeywords,
        source: "hybrid",
      })
      .eq("keyword", keyword);

    if (error) throw error;

    return {
      statusCode: 200,
      body: JSON.stringify({
        message: "Googleトレンド分析完了",
        keyword,
        rising_keywords: risingKeywords,
      }),
    };
  } catch (error: any) {
    console.error("Googleトレンドエラー:", error);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: error.message || "不明なエラー" }),
    };
  }
};
