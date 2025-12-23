type Fact = {
    source: string;
    content: string;
  };
  
  export async function searchFactsByKeyword(
    keyword: string
  ): Promise<Fact[]> {
    const params = new URLSearchParams({
      q: keyword,
      engine: "google",
      hl: "ja",
      gl: "jp",
      num: "5",
      api_key: process.env.SERPAPI_API_KEY!,
    });
  
    const res = await fetch(
      `https://serpapi.com/search.json?${params.toString()}`
    );
  
    if (!res.ok) {
      throw new Error(`SerpAPI error: ${res.status}`);
    }
  
    const data = await res.json();
  
    return (
      data.organic_results?.map((item: any) => ({
        source: item.link,
        content: item.snippet,
      })) || []
    );
  }
  