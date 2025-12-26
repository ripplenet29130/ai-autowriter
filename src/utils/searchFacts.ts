type Fact = {
    source: string;
    content: string;
  };
  
  export async function searchFactsByKeyword(
    keyword: string
  ): Promise<Fact[]> {
  
    console.log("[searchFacts] keyword:", keyword);
  
    const params = new URLSearchParams({
      q: `"${keyword}"`,
      engine: "google",
      hl: "ja",
      gl: "jp",
      num: "3",
      api_key: process.env.SERPAPI_API_KEY!,
    });
  
    const url = `https://serpapi.com/search.json?${params.toString()}`;
    console.log("[searchFacts] request url:", url);
  
    const res = await fetch(url);
  
    console.log("[searchFacts] response status:", res.status);
  
    if (!res.ok) {
      throw new Error(`SerpAPI error: ${res.status}`);
    }
  
    const data = await res.json();
  
    const facts =
      data.organic_results?.map((item: any, index: number) => ({
        source: item.link,
        content: item.snippet,
      })) || [];
  
    console.log("[searchFacts] facts count:", facts.length);
    console.log("[searchFacts] facts preview:", facts);
  
    return facts;
  }
  