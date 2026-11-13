// 参考資料のリンクに載せる「ページの本当のタイトル」を取る共通部品
// Gemini 検索の出典はタイトル欄にドメイン名（eftc.or.jp など）しか入っていないため、
// ページを読みに行って <title> を取り出す（2026-11-13）。

export interface PageTitleResult {
  // 取れたタイトル（取れない・意味のないタイトルなら null）
  title: string | null;
  // ページが存在しない（404 / 410）
  dead: boolean;
}

// 「タイトルとして意味がない」もの（エラーページ・ボット対策ページなど）
const MEANINGLESS_TITLE_PATTERN =
  /^(404|403|500)\b|not found|ページが見つかりません|お探しのページ(は|が)見つかりません|^エラー$|^error$|access denied|^forbidden|just a moment|attention required|^untitled$|^ホーム$|^トップページ$|^home$/i;

const MAX_BYTES = 200_000;

function decodeEntities(text: string): string {
  return text
    .replace(/&#x([0-9a-f]+);/gi, (_m, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_m, dec) => String.fromCodePoint(Number(dec)))
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&');
}

function hostnameOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
}

// HTML から <title>（無ければ og:title）を取り出して整える
export function extractTitleFromHtml(html: string): string | null {
  const og = html.match(/<meta[^>]+property=["']og:title["'][^>]*content=["']([^"']+)["']/i)
    || html.match(/<meta[^>]+content=["']([^"']+)["'][^>]*property=["']og:title["']/i);
  const tag = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  const raw = tag?.[1] || og?.[1] || '';
  return cleanPageTitle(raw);
}

export function cleanPageTitle(raw: string): string | null {
  const title = decodeEntities(String(raw || ''))
    .replace(/<[^>]+>/g, '')
    .replace(/</g, '＜')
    .replace(/>/g, '＞')
    // Markdown のリンク文字として壊れる文字は全角にする
    .replace(/\[/g, '［')
    .replace(/\]/g, '］')
    .replace(/\s+/g, ' ')
    .trim();
  if (title.length < 4) return null;
  if (MEANINGLESS_TITLE_PATTERN.test(title)) return null;
  if (/^[a-z0-9.-]+\.[a-z]{2,}$/i.test(title)) return null; // ドメイン名だけ
  return title.length > 80 ? `${title.slice(0, 78)}…` : title;
}

function charsetOf(contentType: string | null, head: Uint8Array): string {
  const fromHeader = contentType?.match(/charset=["']?([\w-]+)/i)?.[1];
  if (fromHeader) return fromHeader.toLowerCase();
  const ascii = new TextDecoder('latin1').decode(head.slice(0, 4096));
  const fromMeta = ascii.match(/<meta[^>]+charset=["']?([\w-]+)/i)?.[1];
  return (fromMeta || 'utf-8').toLowerCase();
}

async function readLimited(response: Response): Promise<Uint8Array> {
  if (!response.body) return new Uint8Array();
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (total < MAX_BYTES) {
    const { done, value } = await reader.read();
    if (done || !value) break;
    chunks.push(value);
    total += value.length;
  }
  reader.cancel().catch(() => {});
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.length;
  }
  return out;
}

export async function fetchPageTitle(url: string, timeoutMs = 4000): Promise<PageTitleResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      redirect: 'follow',
      signal: controller.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; ReferenceTitleFetcher/1.0)',
        Accept: 'text/html,application/xhtml+xml',
        'Accept-Language': 'ja,en;q=0.8',
      },
    });
    if (response.status === 404 || response.status === 410) {
      response.body?.cancel().catch(() => {});
      return { title: null, dead: true };
    }
    const type = response.headers.get('content-type') || '';
    if (!response.ok || !/html/i.test(type)) {
      response.body?.cancel().catch(() => {});
      return { title: null, dead: false };
    }
    const bytes = await readLimited(response);
    let html: string;
    try {
      html = new TextDecoder(charsetOf(type, bytes)).decode(bytes);
    } catch {
      html = new TextDecoder('utf-8').decode(bytes);
    }
    return { title: extractTitleFromHtml(html), dead: false };
  } catch {
    return { title: null, dead: false };
  } finally {
    clearTimeout(timer);
  }
}

// 出典の候補からページタイトル付きで maxItems 件を選ぶ（存在しないページは外して次の候補で埋める）
export async function enrichReferenceTitles(
  candidates: Array<{ title: string; url: string }>,
  maxItems = 5,
  fetcher: (url: string) => Promise<PageTitleResult> = (url) => fetchPageTitle(url),
): Promise<Array<{ title: string; url: string; host: string; fetchedTitle: boolean }>> {
  const pool = candidates.slice(0, maxItems + 3);
  const results = await Promise.all(pool.map((s) => fetcher(s.url).catch(() => ({ title: null, dead: false }))));
  const picked: Array<{ title: string; url: string; host: string; fetchedTitle: boolean }> = [];
  pool.forEach((source, i) => {
    if (picked.length >= maxItems) return;
    const result = results[i];
    if (result.dead) return;
    const host = hostnameOf(source.url);
    const fallback = cleanPageTitle(source.title);
    const title = result.title || fallback || host || source.url;
    picked.push({ title, url: source.url, host, fetchedTitle: Boolean(result.title) });
  });
  return picked;
}

// 「- [ページタイトル](URL)（ドメイン名）」の形の参考資料を作る
export function formatReferenceLine(ref: { title: string; url: string; host: string }): string {
  const showHost = ref.host && ref.title !== ref.host;
  return `- [${ref.title}](${ref.url})${showHost ? `（${ref.host}）` : ''}`;
}
