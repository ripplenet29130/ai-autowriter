// ===============================================
// searchFacts.ts（本文2件・Abort・キャッシュ対応）
// ===============================================

import { createClient } from "@supabase/supabase-js";

type Fact = { source: string; content: string };

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!
);

// キャッシュ有効期間（例：24時間）
const CACHE_TTL_HOURS = 24;

// 本文取得 最大件数（Netlify 30秒対策）
const MAX_FETCH_PAGES = 1;

// 1ページあたりのfetchタイムアウト（ms）
const FETCH_TIMEOUT_MS = 4500;

// 本文抽出後にfactsとして使う最大文字数（暴走防止）
const MAX_EXTRACT_CHARS = 1400;

// SerpAPIで取る検索結果件数（URL候補）
const SERP_NUM = 2;

function normalizeKeyword(k: string) {
  return (k || "").trim();
}

function buildCacheKey(k: string) {
  // 必要なら lowercase や全角半角統一など
  return normalizeKeyword(k);
}

async function getCachedFacts(keyword: string): Promise<Fact[] | null> {
  const key = buildCacheKey(keyword);
  if (!key) return null;

  const since = new Date(Date.now() - CACHE_TTL_HOURS * 60 * 60 * 1000).toISOString();

  const { data, error } = await supabase
    .from("facts_cache")
    .select("facts, created_at")
    .eq("keyword", key)
    .gte("created_at", since)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    console.warn("[facts_cache] read error:", error.message);
    return null;
  }
  if (!data?.facts) return null;

  try {
    const facts = data.facts as Fact[];
    if (Array.isArray(facts) && facts.length > 0) {
      console.log(`[facts_cache] HIT keyword="${key}" created_at=${data.created_at}`);
      return facts;
    }
  } catch {
    // ignore
  }
  return null;
}

async function saveCachedFacts(keyword: string, facts: Fact[]) {
  const key = buildCacheKey(keyword);
  if (!key || !facts?.length) return;

  const { error } = await supabase.from("facts_cache").insert({
    keyword: key,
    facts: facts,
  });

  if (error) {
    console.warn("[facts_cache] insert error:", error.message);
  } else {
    console.log(`[facts_cache] SAVED keyword="${key}" facts=${facts.length}`);
  }
}

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), ms);

  // promise側にsignalを渡せない場合用に、fetch専用関数で使うのが本当は良い
  // ここでは使わない（fetchにsignalを渡す）
  clearTimeout(t);
  return promise;
}

async function fetchHtml(url: string): Promise<string> {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), FETCH_TIMEOUT_MS);

  try {
    const res = await fetch(url, {
      method: "GET",
      redirect: "follow",
      headers: {
        // 403回避のため最低限
        "User-Agent":
          "Mozilla/5.0 (compatible; RippleNetBot/1.0; +https://www.rip-ple.com/)",
        "Accept-Language": "ja,en-US;q=0.9,en;q=0.8",
      },
      signal: ac.signal,
    });

    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const ct = res.headers.get("content-type") || "";
    if (!ct.includes("text/html")) throw new Error(`Not HTML: ${ct}`);
    return await res.text();
  } finally {
    clearTimeout(t);
  }
}

function stripTags(html: string) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function extractMainText(html: string): string {
  // 超軽量抽出：article > main > body の順で“それっぽい”ところを取る
  // （厳密抽出は重くなりがちなので、まずは軽量で）
  const articleMatch = html.match(/<article[\s\S]*?<\/article>/i);
  if (articleMatch?.[0]) return stripTags(articleMatch[0]).slice(0, MAX_EXTRACT_CHARS);

  const mainMatch = html.match(/<main[\s\S]*?<\/main>/i);
  if (mainMatch?.[0]) return stripTags(mainMatch[0]).slice(0, MAX_EXTRACT_CHARS);

  return stripTags(html).slice(0, MAX_EXTRACT_CHARS);
}

function cleanFactText(t: string) {
  return (t || "")
    .replace(/\s+/g, " ")
    .replace(/（PR）|PR:|広告|スポンサー/gi, "")
    .trim();
}

async function serpapiSearch(keyword: string) {
  const q = normalizeKeyword(keyword);
  const params = new URLSearchParams({
    q, // ✅ 完全一致クオートは外す（検索が狭まりすぎる）
    engine: "google",
    hl: "ja",
    gl: "jp",
    num: String(SERP_NUM),
    api_key: process.env.SERPAPI_API_KEY!,
  });

  const url = `https://serpapi.com/search.json?${params.toString()}`;
  console.log("[searchFacts][serpapi] request:", url);

  const res = await fetch(url);
  if (!res.ok) throw new Error(`SerpAPI error: ${res.status}`);

  const data = await res.json();
  const organic = data?.organic_results || [];
  return organic as any[];
}

export async function searchFactsByKeyword(keyword: string): Promise<Fact[]> {
  const key = normalizeKeyword(keyword);
  console.log("[searchFacts] keyword:", key);

  if (!key) return [];

  // 0) cache
  const cached = await getCachedFacts(key);
  if (cached) return cached;

  // 1) serpapi
  const organic = await serpapiSearch(key);

  // 2) snippet facts（フォールバック用に必ず作る）
  const snippetFacts: Fact[] =
    organic
      .map((item: any) => ({
        source: item.link,
        content: cleanFactText(item.snippet || item.title || ""),
      }))
      .filter((f: Fact) => f.source && f.content) || [];

  // 3) 本文を最大2件だけ取ってfactsを追加（取れなければスキップ）
  const pageFacts: Fact[] = [];
  const links = organic.map((x: any) => x.link).filter(Boolean);

  for (const link of links.slice(0, MAX_FETCH_PAGES)) {
    try {
      console.log("[searchFacts][fetch] start:", link);
      const html = await fetchHtml(link);
      const text = cleanFactText(extractMainText(html));
      if (text.length < 80) {
        console.log("[searchFacts][fetch] too short, skip:", link);
        continue;
      }
      // 「本文断片」としてfacts化（要約はまだしない：時間とAI回数を増やさない）
      pageFacts.push({
        source: link,
        content: text,
      });
      console.log("[searchFacts][fetch] ok chars=", text.length, link);
    } catch (e: any) {
      console.log("[searchFacts][fetch] failed:", link, e?.message || e);
      continue;
    }
  }

  // 4) 結果を合成：本文factsを優先、足りなければスニペットで補う
  const facts = [...pageFacts, ...snippetFacts].slice(0, 10);

  console.log("[searchFacts] facts count:", facts.length);

  // 5) cache save（失敗しても処理継続）
  if (facts.length > 0) await saveCachedFacts(key, facts);

  return facts;
}
