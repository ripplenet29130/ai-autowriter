// WordPress への Basic 認証ヘッダー。
// サーバーによっては Authorization ヘッダーを PHP に渡さず捨ててしまう（CGI/FastCGI 環境など）。
// その対策として同じ値を予備ヘッダーでも送る。WordPress 側に
// docs/wp-auth-header-snippet.md のコードを入れると、予備ヘッダーから認証されるようになる。
// コードを入れていないサイトでは予備ヘッダーは無視されるだけで、動作は変わらない。

export const WP_BACKUP_AUTH_HEADER = "X-Autowriter-Auth";

/** base64 済みの "user:password" から認証ヘッダーを作る */
export function wpBasicAuthHeaders(basicToken: string): Record<string, string> {
  const value = `Basic ${basicToken}`;
  return { Authorization: value, [WP_BACKUP_AUTH_HEADER]: value };
}
