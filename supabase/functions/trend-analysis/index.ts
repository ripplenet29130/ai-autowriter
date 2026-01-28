import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { corsHeaders } from "../_shared/cors.ts";

console.log("トレンド分析関数が起動しました");

interface TrendAnalysisResponse {
    keyword: string;
    trendScore: number;
    searchVolume: number;
    competition: "low" | "medium" | "high";
    relatedKeywords: string[];
    hotTopics: string[];
    seoData: {
        difficulty: number;
        opportunity: number;
        suggestions: string[];
    };
    timestamp: string;
}

serve(async (req) => {
    // CORSヘッダーを追加
    if (req.method === "OPTIONS") {
        return new Response("ok", { headers: corsHeaders });
    }

    try {
        const { keyword } = await req.json();

        if (!keyword) {
            return new Response(
                JSON.stringify({ error: "キーワードが必要です" }),
                {
                    status: 400,
                    headers: { ...corsHeaders, "Content-Type": "application/json" },
                }
            );
        }

        console.log(`トレンド分析を開始: キーワード="${keyword}"`);

        // SerpAPI設定（オプション）
        const serpApiKey = Deno.env.get("SERPAPI_KEY");

        let trendScore = 50;
        let searchVolume = 10000;
        let relatedKeywords: string[] = [];

        // SerpAPIが設定されている場合、Google Trendsデータを取得
        if (serpApiKey) {
            try {
                console.log("SerpAPI経由でGoogle Trendsデータを取得中...");
                const trendsUrl = `https://serpapi.com/search.json?engine=google_trends&q=${encodeURIComponent(keyword)}&geo=JP&date=today 12-m&api_key=${serpApiKey}`;

                const trendsResponse = await fetch(trendsUrl);

                if (trendsResponse.ok) {
                    const trendsData = await trendsResponse.json();

                    // トレンドスコアを取得
                    const timelineData = trendsData.interest_over_time?.timeline_data || [];
                    if (timelineData.length > 0) {
                        const recentData = timelineData[timelineData.length - 1];
                        trendScore = recentData.values?.[0]?.value || 50;
                    }

                    // 関連検索クエリを取得
                    const relatedQueries = trendsData.related_queries?.rising || [];
                    relatedKeywords = relatedQueries
                        .slice(0, 8)
                        .map((q: any) => q.query);

                    console.log(`Google Trendsデータ取得成功: トレンドスコア=${trendScore}`);
                }
            } catch (error) {
                console.warn("SerpAPI呼び出しエラー（フォールバック使用）:", error);
            }
        }

        // 関連キーワードが取得できなかった場合、生成する
        if (relatedKeywords.length === 0) {
            relatedKeywords = generateRelatedKeywords(keyword);
        }

        // 検索ボリュームを推定
        searchVolume = estimateSearchVolume(keyword, trendScore);

        // SEO難易度を計算
        const difficulty = calculateSEODifficulty(keyword);
        const opportunity = 100 - difficulty;

        // SEO提案を生成
        const suggestions = generateSEOSuggestions(keyword, difficulty);

        // ホットトピックを抽出
        const hotTopics = relatedKeywords
            .filter((kw) =>
                kw.includes("2024") ||
                kw.includes("2025") ||
                kw.includes("最新") ||
                kw.includes("トレンド")
            )
            .slice(0, 5);

        // 競合度を判定
        const competition = difficulty > 70 ? "high" : difficulty > 40 ? "medium" : "low";

        const result: TrendAnalysisResponse = {
            keyword,
            trendScore: Math.round(trendScore),
            searchVolume,
            competition,
            relatedKeywords,
            hotTopics,
            seoData: {
                difficulty,
                opportunity,
                suggestions,
            },
            timestamp: new Date().toISOString(),
        };

        console.log(
            `トレンド分析完了: スコア=${result.trendScore}, ボリューム=${result.searchVolume}`
        );

        return new Response(JSON.stringify(result), {
            headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
    } catch (error: any) {
        console.error("トレンド分析エラー:", error);
        return new Response(
            JSON.stringify({
                error: "トレンド分析処理中にエラーが発生しました",
                message: error.message,
            }),
            {
                status: 500,
                headers: { ...corsHeaders, "Content-Type": "application/json" },
            }
        );
    }
});

// ヘルパー関数

function generateRelatedKeywords(keyword: string): string[] {
    const patterns = [
        `${keyword} 方法`,
        `${keyword} 効果`,
        `${keyword} 比較`,
        `${keyword} おすすめ`,
        `${keyword} 最新`,
        `${keyword} 2025`,
        `${keyword} 解説`,
        `${keyword} 入門`,
    ];
    return patterns;
}

function estimateSearchVolume(keyword: string, trendScore: number): number {
    // トレンドスコアから検索ボリュームを推定
    let baseVolume = Math.floor(trendScore * 1000);

    // 特定キーワードでボリュームを調整
    const highVolumeKeywords = ["AI", "ビジネス", "健康", "投資"];
    const isHighVolume = highVolumeKeywords.some((k) => keyword.includes(k));

    if (isHighVolume) {
        baseVolume *= 2;
    }

    // ランダム要素を追加（±30%）
    const randomFactor = 0.7 + Math.random() * 0.6;
    return Math.floor(baseVolume * randomFactor);
}

function calculateSEODifficulty(keyword: string): number {
    let difficulty = 50; // ベース値

    // 競合性の高いキーワード
    const highCompetition = ["AI", "ビジネス", "投資", "保険", "クレジットカード"];
    const mediumCompetition = ["健康", "美容", "教育", "テクノロジー"];
    const lowCompetition = ["自伝", "趣味", "ライフスタイル"];

    if (highCompetition.some((term) => keyword.includes(term))) {
        difficulty += 30;
    } else if (mediumCompetition.some((term) => keyword.includes(term))) {
        difficulty += 15;
    } else if (lowCompetition.some((term) => keyword.includes(term))) {
        difficulty -= 15;
    }

    // キーワードの長さ（ロングテールは難易度が低い）
    const wordCount = keyword.split(/\s+/).length;
    if (wordCount >= 3) {
        difficulty -= 10;
    } else if (wordCount === 1) {
        difficulty += 20;
    }

    return Math.max(0, Math.min(100, difficulty));
}

function generateSEOSuggestions(keyword: string, difficulty: number): string[] {
    const suggestions: string[] = [];

    if (difficulty > 70) {
        suggestions.push("ロングテールキーワードを活用する");
        suggestions.push("ニッチな角度からアプローチする");
        suggestions.push("専門性を高めてE-A-Tを向上させる");
    } else if (difficulty > 40) {
        suggestions.push("関連キーワードを組み合わせる");
        suggestions.push("ユーザーの検索意図を深く分析する");
        suggestions.push("競合記事より詳細な内容を作成する");
    } else {
        suggestions.push("基本的なSEO対策を徹底する");
        suggestions.push("内部リンクを最適化する");
        suggestions.push("定期的なコンテンツ更新を行う");
    }

    // 共通の提案
    suggestions.push("タイトルタグにキーワードを含める");
    suggestions.push("見出し構造を最適化する");

    return suggestions;
}
