type Fact = {
    source: string;
    content: string;
  };
  
  export async function searchFactsByKeyword(
    keyword: string
  ): Promise<Fact[]> {
    // -----------------------------
    // ① キーワードの最低チェック
    // -----------------------------
    if (typeof keyword !== "string" || keyword.trim().length < 3) {
      throw new Error("Keyword is too short for reliable search");
    }
  
    const params = new URLSearchParams({
      q: keyword.trim(),
      engine: "google",
      hl: "ja",
      gl: "jp",
      num: "5",
      api_key: process.env.SERPAPI_API_KEY!,
    });
  
    const res = await fetch(
      `https://serpapi.com/search.json?${params.toString()}`
    );
  
    // -----------------------------
    // ② HTTPエラー処理
    // -----------------------------
    if (!res.ok) {
      const text = await res.text();
      throw new Error(
        `SerpAPI request failed: ${res.status} ${text}`
      );
    }
  
    const data = await res.json();
  
    // -----------------------------
    // ③ organic_results 整形 + ノイズ除去
    // -----------------------------
    const facts: Fact[] =
      data.organic_results
        ?.map((item: any) => ({
          source: item.link,
          content: item.snippet,
        }))
        .filter(
          (f: Fact) =>
            typeof f.content === "string" &&
            f.content.trim().length >= 40
        ) || [];
  
    // -----------------------------
    // ④ 実質検索失敗の検知
    // -----------------------------
    if (facts.length === 0) {
      throw new Error(
        `No meaningful search results found for keyword: ${keyword}`
      );
    }
  
    return facts;
  }
  