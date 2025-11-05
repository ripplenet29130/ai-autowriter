import type { Handler } from "@netlify/functions";
import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL!;
const supabaseKey = process.env.SUPABASE_SERVICE_KEY || process.env.VITE_SUPABASE_SERVICE_KEY!;

if (!supabaseUrl || !supabaseKey) {
  console.error("❌ Supabase環境変数が見つかりません。Netlify環境変数を確認してください。");
}

const supabase = createClient(supabaseUrl, supabaseKey);


export const handler: Handler = async (event) => {
  try {
    const { keyword } = JSON.parse(event.body || "{}");
    if (!keyword) {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: "keywordが指定されていません" }),
      };
    }

    console.log("📊 Googleトレンド取得開始:", keyword);

    // Googleトレンド非公式JSONエンドポイント（公開URL）
    const url = `https://trends.google.com/trends/api/explore?hl=ja&tz=-540&req=${encodeURIComponent(
      JSON.stringify({
        comparisonItem: [{ keyword, time: "today 3-m" }],
        category: 0,
        property: "",
      })
    )}`;

    const res = await fetch(url);
    const text = await res.text();

    // HTMLではなくJSONが返ってくるように調整
    const jsonText = text.replace(/^[^{]+/, ""); // XSSI防止プレフィックスを削除
    const data = JSON.parse(jsonText);

    // 人気度データ用のリクエストを生成
    const widget = data.widgets.find((w: any) => w.id === "TIMESERIES");

    const timelineRes = await fetch(
      `https://trends.google.com/trends/api/widgetdata/multiline?hl=ja&tz=-540&req=${encodeURIComponent(
        JSON.stringify(widget.request)
      )}&token=${widget.token}`
    );
    const timelineText = await timelineRes.text();
    const timelineJson = JSON.parse(timelineText.replace(/^[^{]+/, ""));
    const timeline = timelineJson.default.timelineData.map((item: any) => ({
      time: new Date(Number(item.time) * 1000).toLocaleDateString("ja-JP"),
      value: item.value[0],
    }));

    const trendScore = {
      average: Math.round(
        timeline.reduce((acc: number, t: any) => acc + t.value, 0) /
          timeline.length
      ),
      timeline,
    };

    // === Supabaseに保存 ===
    const { error } = await supabase
      .from("trend_keywords")
      .update({
        trend_score: trendScore,
        source: "hybrid",
      })
      .eq("keyword", keyword);

    if (error) throw error;

    console.log("✅ Googleトレンド分析完了:", keyword);

    return {
      statusCode: 200,
      body: JSON.stringify({
        keyword,
        trend_score: trendScore,
      }),
    };
  } catch (error: any) {
    console.error("❌ Googleトレンド取得エラー:", error);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: error.message || "不明なエラー" }),
    };
  }
};
