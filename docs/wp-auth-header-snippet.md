# サーバーがログイン情報を捨てるサイトへの対応コード

接続テストで「現在ログインしていません」（`rest_not_logged_in`）と出て、WordPress のサイトヘルスに
「Authorization ヘッダーがありません」と出るサイト向けです。

## 何が起きているか

AI オートライターは、ユーザー名とアプリケーションパスワードを `Authorization` ヘッダーに入れて送ります。
サーバーによってはこのヘッダーを WordPress に渡す前に捨ててしまうため、WordPress から見ると
「ログイン情報なし」になります。

アプリは同じ値を予備のヘッダー `X-Autowriter-Auth` でも送っています。下のコードを入れると、
WordPress がこの予備ヘッダーを読んで、通常どおりアプリケーションパスワードを確認します。

- パスワードの確認は WordPress 本体が今まで通り行います。コードは値を移し替えるだけです。
- 通常の `Authorization` ヘッダーが届いているときは何もしません。
- 通信は HTTPS なので、予備ヘッダーも通常のヘッダーと同じく暗号化されます。

## テーマを編集できない場合（プラグインで入れる）

テーマファイルエディターが使えないサイトでも、プラグインを追加できれば同じことができます。

1. `wordpress-plugin/autowriter-auth-header` フォルダーを zip にする
   （`.diagnostics/autowriter-auth-header.zip` に作成済みの場合はそれを使う）
2. WordPress 管理画面 → プラグイン → 新規追加 → 「プラグインのアップロード」で zip を選ぶ
3. 「今すぐインストール」→「有効化」
4. AI オートライターで接続テストをする

プラグインはテーマを切り替えても効き続けます。functions.php のコードと両方入れても問題ありません。

## 貼り方（子テーマの functions.php）

1. WordPress 管理画面 → 外観 → テーマファイルエディター
2. 右上で **子テーマ** を選び、`functions.php`（テーマのための関数）を開く
3. 1行目の `<?php` のすぐ下に、次のコードを貼る
4. 「ファイルを更新」を押す
5. AI オートライターで接続テストをする

ファイルの最後に `?>` がある場合でも、`<?php` のすぐ下に貼れば問題ありません。

```php
/**
 * AI オートライター: サーバーが Authorization ヘッダーを捨てる場合の対応
 * 予備ヘッダー X-Autowriter-Auth の値を、WordPress が読む場所に移す。
 */
if (
	empty( $_SERVER['PHP_AUTH_USER'] )
	&& empty( $_SERVER['HTTP_AUTHORIZATION'] )
	&& empty( $_SERVER['REDIRECT_HTTP_AUTHORIZATION'] )
	&& ! empty( $_SERVER['HTTP_X_AUTOWRITER_AUTH'] )
) {
	$autowriter_auth = trim( (string) $_SERVER['HTTP_X_AUTOWRITER_AUTH'] );
	if ( 0 === stripos( $autowriter_auth, 'basic ' ) ) {
		$autowriter_decoded = base64_decode( substr( $autowriter_auth, 6 ), true );
		if ( false !== $autowriter_decoded && false !== strpos( $autowriter_decoded, ':' ) ) {
			list( $_SERVER['PHP_AUTH_USER'], $_SERVER['PHP_AUTH_PW'] ) = explode( ':', $autowriter_decoded, 2 );
			// テーマより先にログイン判定が済んでいた場合は、判定をやり直させる
			if ( isset( $GLOBALS['current_user'] ) && $GLOBALS['current_user'] instanceof WP_User && 0 === $GLOBALS['current_user']->ID ) {
				$GLOBALS['current_user'] = null;
			}
		}
	}
	unset( $autowriter_auth, $autowriter_decoded );
}
```

## 注意

- テーマを別のものに切り替えると、このコードは効かなくなります。その場合は新しいテーマ（の子テーマ）に貼り直してください。
- 親テーマの `functions.php` に貼ると、テーマ更新で消えます。必ず子テーマに貼ってください。
