<?php
/**
 * Plugin Name: AI Autowriter Auth Header
 * Description: サーバーが Authorization ヘッダーを捨てる環境で、AI オートライターの予備ヘッダー（X-Autowriter-Auth）から認証情報を受け取ります。パスワードの確認は WordPress 本体が通常どおり行います。
 * Version: 1.0.0
 * Requires at least: 5.6
 * Requires PHP: 7.0
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

// 子テーマの functions.php に同じコードを貼っている場合も、先に動いた方だけが効く（二重には動かない）。
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
		}
	}
	unset( $autowriter_auth, $autowriter_decoded );
}
