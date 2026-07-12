// 競合調査（competitor-search 経由）と関連キーワード抽出
import { fetchWithTimeout, trimForLog } from './_shared.ts';

export function extractRelatedKeywordsFromCompetitorData(
  competitorData: any,
  mainKeyword: string,
  limit: number = 5
): string[] {
  if (!competitorData?.articles || competitorData.articles.length === 0) return [];

  const wordFrequency = new Map<string, number>();
  const mainKeywordLower = mainKeyword.toLowerCase();

  for (const article of competitorData.articles) {
    // 髫募唱繝ｻ邵ｺ蜉ｱﾂｰ郢ｧ蟲ｨ縺冗ｹ晢ｽｼ郢晢ｽｯ郢晢ｽｼ郢晏ｳｨ・定ｬ夲ｽｽ陷・ｽｺ
    const headings: string[] = article.headings || [];
    for (const heading of headings) {
      // 髫募唱繝ｻ邵ｺ蜉ｱ・定怺蛟ｩ・ｪ讒ｭ竊楢崕繝ｻ迚｡邵ｺ蜉ｱ窶ｻ鬯・ｽｻ陟趣ｽｦ郢ｧ・ｫ郢ｧ・ｦ郢晢ｽｳ郢昴・
      const words = heading
        .replace(/[邵ｲ闊個莉｣ﾂ蠕個髦ｪﾂ蠑ｱﾂ謫ｾ・ｼ闌ｨ・ｼ繝ｻ)\[\]]/g, ' ')
        .split(/[\s邵ｲﾂ,邵ｲ竏壹・]+/)
        .map((w: string) => w.trim())
        .filter((w: string) => w.length >= 2 && w.length <= 20);

      for (const word of words) {
        if (word.toLowerCase() === mainKeywordLower) continue;
        wordFrequency.set(word, (wordFrequency.get(word) || 0) + 1);
      }
    }

    // metaDescription邵ｺ荵晢ｽ臥ｹｧ繧・￥郢晢ｽｼ郢晢ｽｯ郢晢ｽｼ郢晏ｳｨ・定ｬ夲ｽｽ陷・ｽｺ
    if (article.metaDescription) {
      const descWords = article.metaDescription
        .replace(/[。、！？「」『』（）()[\]【】,，.．:：;；/]/g, ' ')
        .split(/\s+/)
        .map((w: string) => w.trim())
        .filter((w: string) => w.length >= 2 && w.length <= 15);

      for (const word of descWords) {
        if (word.toLowerCase() === mainKeywordLower) continue;
        wordFrequency.set(word, (wordFrequency.get(word) || 0) + 1);
      }
    }
  }

  // 陷・ｽｺ霑ｴ・ｾ鬯・ｽｻ陟趣ｽｦ邵ｺ・ｧ郢ｧ・ｽ郢晢ｽｼ郢晏現・邵ｲ竏ｽ・ｸ雍具ｽｽ髦ｪ・帝恆譁絶・
  return Array.from(wordFrequency.entries())
    .filter(([, count]) => count >= 2) // 2陜玲ｨ費ｽｻ・･闕ｳ髮√・霑ｴ・ｾ邵ｺ蜉ｱ笳・ｹｧ繧・・邵ｺ・ｮ邵ｺ・ｿ
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([word]) => word);
}


export function extractCompetitorHeadings(competitorData: any, limit: number = 15): string[] {
  if (!competitorData?.articles || competitorData.articles.length === 0) return [];

  const headings: string[] = [];
  const seen = new Set<string>();

  for (const article of competitorData.articles) {
    const articleHeadings = Array.isArray(article?.headings) ? article.headings : [];

    for (const heading of articleHeadings) {
      const normalized = String(heading || '')
        .replace(/<[^>]+>/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();

      if (!normalized || normalized.length < 3 || normalized.length > 120) continue;
      const key = normalized.toLowerCase();
      if (seen.has(key)) continue;

      seen.add(key);
      headings.push(normalized);
      if (headings.length >= limit) return headings;
    }
  }

  return headings;
}

// Google Custom Search API邵ｺ・ｧ鬮｢・｢鬨ｾ・｣郢ｧ・ｭ郢晢ｽｼ郢晢ｽｯ郢晢ｽｼ郢晏ｳｨ・定愾髢・ｾ繝ｻ

export async function fetchRelatedKeywordsViaCustomSearch(
  keyword: string,
  googleApiKey: string,
  searchEngineId: string
): Promise<string[]> {
  try {
    const url = `https://www.googleapis.com/customsearch/v1?key=${googleApiKey}&cx=${searchEngineId}&q=${encodeURIComponent(keyword)}&gl=jp&hl=ja&num=5`;
    const res = await fetch(url);
    if (!res.ok) return [];
    const data = await res.json();
    const items = data.items || [];

    const keywords = new Set<string>();
    for (const item of items) {
      // 郢ｧ・ｿ郢ｧ・､郢晏現ﾎ晉ｸｺ・ｨ郢ｧ・ｹ郢昜ｹ昴・郢昴・繝ｨ邵ｺ荵晢ｽ臥ｹｧ・ｭ郢晢ｽｼ郢晢ｽｯ郢晢ｽｼ郢晏ｳｨ・定ｬ夲ｽｽ陷・ｽｺ
      const text = `${item.title || ''} ${item.snippet || ''}`;
      const words = text
        .replace(/[邵ｲ闊個莉｣ﾂ蠕個髦ｪﾂ蠑ｱﾂ謫ｾ・ｼ闌ｨ・ｼ繝ｻ)\[\]邵ｲ繧・繝ｻ・ｼ繝ｻ・ｼ貅ｪﾂ・ｦ]/g, ' ')
        .split(/[\s邵ｲﾂ,]+/)
        .map((w: string) => w.trim())
        .filter((w: string) =>
          w.length >= 2 &&
          w.length <= 15 &&
          w.toLowerCase() !== keyword.toLowerCase()
        );
      words.forEach((w: string) => keywords.add(w));
    }

    return Array.from(keywords).slice(0, 8);
  } catch (err) {
    console.warn('Google Custom Search keyword extraction failed:', err);
    return [];
  }
}

// === 隰ｾ・ｹ闖ｫ・ｮ4: AI郢ｧ・ｿ郢ｧ・､郢晏現ﾎ晞墓ｻ薙・郢晏･ﾎ晉ｹ昜ｻ｣繝ｻ繝ｻ驛√・陷肴・蜃ｽ隰瑚・ﾎ皮ｹ晢ｽｼ郢晉判・ｺ蛹∽ｾ繝ｻ繝ｻ===


export function isLikelyJwt(value: string): boolean {
  const token = String(value || '').trim();
  if (!token) return false;
  const parts = token.split('.');
  return parts.length === 3 && parts.every((part) => part.length > 0);
}


export type KeyCandidate = { label: 'anon' | 'service'; value: string };

export type AuthAttempt = { name: string; headers: Record<string, string> };


export function buildCompetitorSearchAuthAttempts(anonKeyRaw: string | null, serviceRoleKeyRaw: string | null): AuthAttempt[] {
  const candidates: KeyCandidate[] = [
    { label: 'anon', value: String(anonKeyRaw || '').trim() },
    { label: 'service', value: String(serviceRoleKeyRaw || '').trim() },
  ].filter((candidate) => candidate.value.length > 0);

  const apiCandidates = [
    candidates.find((candidate) => candidate.label === 'service'),
    candidates.find((candidate) => candidate.label === 'anon'),
  ].filter(Boolean) as KeyCandidate[];

  const jwtCandidates = candidates.filter((candidate) => isLikelyJwt(candidate.value));
  const nonJwtCandidates = candidates.filter((candidate) => !isLikelyJwt(candidate.value));
  const authCandidates = [...jwtCandidates, ...nonJwtCandidates];

  const attempts: AuthAttempt[] = [];
  const seen = new Set<string>();

  const pushAttempt = (name: string, headers: Record<string, string>) => {
    const fingerprint = `${name}:${Object.keys(headers).sort().join('|')}:${headers.apikey?.length ?? 0}:${headers.Authorization ? 1 : 0}`;
    if (seen.has(fingerprint)) return;
    seen.add(fingerprint);
    attempts.push({ name, headers });
  };

  for (const apiCandidate of apiCandidates) {
    for (const authCandidate of authCandidates) {
      pushAttempt(
        `auth-${authCandidate.label}-apikey-${apiCandidate.label}`,
        {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${authCandidate.value}`,
          'apikey': apiCandidate.value,
        }
      );
    }

    for (const authCandidate of authCandidates) {
      pushAttempt(
        `auth-only-${authCandidate.label}`,
        {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${authCandidate.value}`,
        }
      );
    }

    pushAttempt(
      `apikey-only-${apiCandidate.label}`,
      {
        'Content-Type': 'application/json',
        'apikey': apiCandidate.value,
      }
    );
  }

  if (attempts.length === 0) {
    attempts.push({
      name: 'no-auth-header',
      headers: { 'Content-Type': 'application/json' },
    });
  }

  return attempts;
}


export async function conductCompetitorResearchViaEdgeFunction(
  keyword: string,
  serpApiKey: string,
  limit: number = 5
) {
  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY');
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

  if (!supabaseUrl) {
    throw new Error('SUPABASE_URL is missing');
  }

  if (!anonKey && !serviceRoleKey) {
    throw new Error('SUPABASE_ANON_KEY or SUPABASE_SERVICE_ROLE_KEY is missing');
  }

  const endpoint = `${supabaseUrl}/functions/v1/competitor-search`;
  const body = JSON.stringify({ keyword, limit, serpApiKey });
  const attempts = buildCompetitorSearchAuthAttempts(anonKey, serviceRoleKey);
  const errors: string[] = [];

  for (const attempt of attempts) {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: attempt.headers,
      body,
    });

    if (response.ok) {
      const data = await response.json();
      return {
        articles: Array.isArray(data?.topArticles) ? data.topArticles : [],
        averageLength: Number.isFinite(Number(data?.averageLength)) ? Number(data.averageLength) : 0,
        commonTopics: Array.isArray(data?.commonTopics) ? data.commonTopics : [],
      };
    }

    const text = await response.text();
    const reason = `${attempt.name} -> ${response.status} ${trimForLog(text, 220)}`;
    errors.push(reason);

    // For deterministic request errors, fail fast.
    if (response.status >= 400 && response.status < 500 && response.status !== 401 && response.status !== 403) {
      throw new Error(`competitor-search error: ${reason}`);
    }
  }

  throw new Error(
    `competitor-search auth failed after ${attempts.length} attempts. ` +
    `Details: ${errors.join(' | ')}. ` +
    `If this persists, deploy competitor-search with verify_jwt disabled.`
  );
}


export async function conductCompetitorResearchWithFallback(
  keyword: string,
  serpApiKey: string,
  limit: number = 5
) {
  try {
    const deepResult = await conductCompetitorResearchViaEdgeFunction(keyword, serpApiKey, limit);
    if (deepResult.articles.length > 0) {
      console.log(`Deep competitor research completed via competitor-search (${deepResult.articles.length} articles)`);
      return deepResult;
    }
    console.warn('competitor-search returned no articles. Falling back to inline scraper.');
  } catch (error) {
    console.warn('competitor-search failed. Falling back to inline scraper:', error);
  }

  return await conductCompetitorResearch(keyword, serpApiKey, limit);
}

// 鬩包ｽｶ繝ｻ・ｶ髯ｷ・ｷ鬩帙・・ｽ・ｪ繝ｻ・ｿ髫ｴ貊ゑｽｽ・ｻ驛｢譎渉・･・取刮・ｹ譏懶ｽｻ・｣郢晢ｽｻ鬯ｮ・｢繝ｻ・｢髫ｰ・ｨ繝ｻ・ｰ郢晢ｽｻ郢晢ｽｻerpAPI鬩搾ｽｨ隶吝ｮ茨ｽｽ・ｰ郢晢ｽｻ郢晢ｽｻ

export async function conductCompetitorResearch(keyword: string, serpApiKey: string, limit: number = 5) {
  const searchUrl = `https://serpapi.com/search.json?engine=google&q=${encodeURIComponent(keyword)}&api_key=${serpApiKey}&gl=jp&hl=ja&num=${limit}`;

  const searchRes = await fetch(searchUrl);
  if (!searchRes.ok) {
    throw new Error(`SerpAPI error: ${searchRes.status}`);
  }

  const searchData = await searchRes.json();
  const results = searchData.organic_results || [];

  const articles = [];

  for (const item of results.slice(0, limit)) {
    const url = item.link;
    console.log(`Scraping: ${url}`);

    try {
      const controller = new AbortController();
      const id = setTimeout(() => controller.abort(), 8000);

      const res = await fetch(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
        },
        signal: controller.signal
      });
      clearTimeout(id);

      if (!res.ok) throw new Error(`Fetch failed: ${res.status}`);

      const html = await res.text();

      // 鬩阪・・ｽ・｡髫ｴ蝓手ｱｪ陜趣ｽｪ驍ｵ・ｺ繝ｻ・ｪ鬮ｫ蜍溷罰郢晢ｽｻ驍ｵ・ｺ驍・ｽｲ雎∵･｢諤弱・・ｺ郢晢ｽｻ陜捺ｻゑｽｽ・ｭ繝ｻ・｣鬮ｫ蜍溯㊥繝ｻ・｡繝ｻ・ｨ髴托ｽｴ繝ｻ・ｾ驛｢譎冗函郢晢ｽｻ驛｢・ｧ繝ｻ・ｹ郢晢ｽｻ郢晢ｽｻ
      const h2Matches = html.match(/<h2[^>]*>([^<]+)<\/h2>/gi) || [];
      const h3Matches = html.match(/<h3[^>]*>([^<]+)<\/h3>/gi) || [];

      const headings = [...h2Matches, ...h3Matches]
        .map(h => h.replace(/<\/?[^>]+(>|$)/g, '').trim())
        .filter(h => h.length > 2 && h.length < 100)
        .slice(0, 10);

      articles.push({
        title: item.title,
        url: url,
        domain: new URL(url).hostname,
        headings: headings.length > 0 ? headings : [item.title],
        metaDescription: item.snippet || ''
      });
    } catch (err: any) {
      console.error(`Scraping failed for ${url}:`, err.message);
      articles.push({
        title: item.title,
        url: url,
        domain: new URL(url).hostname,
        headings: [item.title],
        metaDescription: item.snippet || ''
      });
    }
  }

  return {
    articles,
    averageLength: 2500,
    commonTopics: []
  };
}

