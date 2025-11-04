import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

interface RequestBody {
  keyword: string;
  timeRange?: string;
  geo?: string;
}

interface TrendData {
  time: string;
  value: number;
}

interface RisingKeyword {
  query: string;
  value: number;
}

// Google Trends unofficial API endpoint
const TRENDS_API_BASE = "https://trends.google.com/trends/api";

async function fetchGoogleTrends(keyword: string, geo: string, timeRange: string) {
  // Google Trendsは公式APIがないため、シンプルなモックデータを返す
  // 実際の製品版では SerpAPI などのサードパーティAPIを使用することを推奨
  console.log(`📈 Google Trendsデータ取得: ${keyword} (${geo}, ${timeRange})`);

  // モックデータ生成（過去7日間のトレンドデータ）
  const timeline: TrendData[] = [];
  const now = new Date();
  
  for (let i = 6; i >= 0; i--) {
    const date = new Date(now);
    date.setDate(date.getDate() - i);
    const timeStr = date.toISOString().split('T')[0];
    const randomValue = Math.floor(Math.random() * 40) + 30; // 30-70のランダム値
    timeline.push({ time: timeStr, value: randomValue });
  }

  // 人気上昇中キーワード（モック）
  const risingKeywords: RisingKeyword[] = [
    { query: `${keyword} 費用`, value: 100 },
    { query: `${keyword} 口コミ`, value: 85 },
    { query: `${keyword} 効果`, value: 70 },
    { query: `${keyword} 副作用`, value: 65 },
    { query: `${keyword} おすすめ`, value: 60 },
    { query: `${keyword} 比較`, value: 55 },
    { query: `${keyword} 東京`, value: 50 },
    { query: `${keyword} オンライン`, value: 45 },
    { query: `${keyword} 保険`, value: 40 },
    { query: `${keyword} 体験`, value: 35 },
  ];

  return {
    timeline,
    rising: risingKeywords,
    averageScore: Math.floor(timeline.reduce((sum, item) => sum + item.value, 0) / timeline.length),
  };
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, {
      status: 200,
      headers: corsHeaders,
    });
  }

  try {
    const { keyword, timeRange = "now 7-d", geo = "JP" }: RequestBody = await req.json();

    if (!keyword) {
      return new Response(
        JSON.stringify({ error: "キーワードは必須です" }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    console.log(`🔍 Google Trends分析開始: ${keyword}`);

    const trendsData = await fetchGoogleTrends(keyword, geo, timeRange);

    console.log(`✅ Google Trendsデータ取得成功`);

    return new Response(
      JSON.stringify({
        keyword,
        timeline: trendsData.timeline,
        rising: trendsData.rising.map(item => item.query),
        trend_score: {
          average: trendsData.averageScore,
          timeline: trendsData.timeline,
        },
        geo,
        timeRange,
      }),
      {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  } catch (err: unknown) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    console.error(`❌ Google Trendsエラー:`, errorMessage);
    return new Response(
      JSON.stringify({ error: errorMessage }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
});
