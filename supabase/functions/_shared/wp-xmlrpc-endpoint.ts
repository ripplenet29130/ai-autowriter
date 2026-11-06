// xmlrpc.php の場所を決める。
// WordPress本体をサブフォルダに置き、サイトの表示だけをトップで行う構成（例: 表示 https://example.jp、
// 本体 https://example.jp/wp）では、REST API はトップで動くが xmlrpc.php は本体側にしかない。
// REST API の目次（/wp-json/、認証不要）の `url` が本体の場所（siteurl）なので、そこを使う。
// 目次が読めない場合は、これまでどおり登録URL直下の xmlrpc.php を使う。

export async function resolveXmlRpcEndpoint(
  baseUrl: string,
  fetchImpl: typeof fetch = fetch,
  timeoutMs = 10000,
): Promise<string> {
  const base = String(baseUrl || "").trim().replace(/\/+$/, "");
  const fallback = `${base}/xmlrpc.php`;

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(`${base}/wp-json/`, {
      method: "GET",
      headers: { Accept: "application/json" },
      redirect: "follow",
      signal: controller.signal,
    });
    if (!response.ok) return fallback;
    const index = await response.json().catch(() => null);
    const siteUrl = typeof index?.url === "string" ? index.url.trim() : "";
    if (!/^https?:\/\//i.test(siteUrl)) return fallback;

    // 認証情報を別の宛先へ送らないよう、登録URLと同じホストのときだけ使う。
    // http/https は登録URLに合わせる（siteurl が http のままのサイトでPOSTがリダイレクトで壊れないように）。
    const baseParsed = new URL(base);
    const siteParsed = new URL(siteUrl);
    if (siteParsed.hostname.toLowerCase() !== baseParsed.hostname.toLowerCase()) return fallback;
    const path = siteParsed.pathname.replace(/\/+$/, "");
    return `${baseParsed.protocol}//${baseParsed.host}${path}/xmlrpc.php`;
  } catch {
    return fallback;
  } finally {
    clearTimeout(timeoutId);
  }
}
