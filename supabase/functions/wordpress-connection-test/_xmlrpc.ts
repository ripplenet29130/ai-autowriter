// XML-RPC でユーザー名とパスワードを確認する。
// サーバーが Authorization ヘッダーを捨てるサイトでは REST API で認証できないが、
// 投稿処理（scheduler-executor）は XML-RPC に切り替えて投稿する。接続テストも同じ経路で確認する。

export type XmlRpcCheckResult =
  | { ok: true }
  | { ok: false; reason: "auth_failed" | "disabled" | "unavailable" | "timeout" | "network_error"; message: string };

function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

export function buildGetUsersBlogsBody(username: string, password: string): string {
  return `<?xml version="1.0"?>
<methodCall>
  <methodName>wp.getUsersBlogs</methodName>
  <params>
    <param><value><string>${escapeXml(username)}</string></value></param>
    <param><value><string>${escapeXml(password)}</string></value></param>
  </params>
</methodCall>`;
}

export function parseXmlRpcResponse(status: number, text: string): XmlRpcCheckResult {
  if (/<fault>/i.test(text)) {
    const code = Number(text.match(/<name>faultCode<\/name>\s*<value>\s*<int>(-?\d+)<\/int>/i)?.[1] ?? NaN);
    const faultString = text.match(/<name>faultString<\/name>\s*<value>\s*<string>([\s\S]*?)<\/string>/i)?.[1]?.trim() ?? "";
    if (code === 403) {
      return { ok: false, reason: "auth_failed", message: faultString || "ユーザー名またはパスワードが違います。" };
    }
    if (code === 405) {
      return { ok: false, reason: "disabled", message: faultString || "XML-RPCが無効になっています。" };
    }
    return { ok: false, reason: "unavailable", message: faultString || `XML-RPCエラー (${code})` };
  }
  if (status >= 200 && status < 300 && /<methodResponse>[\s\S]*<params>/i.test(text)) {
    return { ok: true };
  }
  return { ok: false, reason: "unavailable", message: `xmlrpc.php からXML-RPCの応答が返りませんでした (HTTP ${status})` };
}

export async function checkCredentialsViaXmlRpc(
  baseUrl: string,
  username: string,
  password: string,
  fetchImpl: typeof fetch = fetch,
  timeoutMs = 15000,
): Promise<XmlRpcCheckResult> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(`${baseUrl.replace(/\/+$/, "")}/xmlrpc.php`, {
      method: "POST",
      headers: {
        "Content-Type": "text/xml; charset=UTF-8",
        "User-Agent": "AutomaticWriter-WordPress-Connection-Test/1.0",
      },
      body: buildGetUsersBlogsBody(username, password),
      redirect: "follow",
      signal: controller.signal,
    });
    return parseXmlRpcResponse(response.status, await response.text());
  } catch (error) {
    const isTimeout = error instanceof DOMException && error.name === "AbortError";
    return {
      ok: false,
      reason: isTimeout ? "timeout" : "network_error",
      message: isTimeout ? "XML-RPCの応答がありませんでした" : `XML-RPCに接続できませんでした (${error instanceof Error ? error.message : String(error)})`,
    };
  } finally {
    clearTimeout(timeoutId);
  }
}
