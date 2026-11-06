# WordPress アプリケーションパスワードの一括入れ替え

`wordpress_configs.password` に登録されている WordPress のアプリケーションパスワードを、
REST API 経由でまとめて入れ替えるスクリプトです。

```
node scripts/rotate-wp-app-passwords.mjs            # 確認のみ（何も変更しない）
node scripts/rotate-wp-app-passwords.mjs --apply    # 入れ替えを実行
```

## 準備

サービスロールキーが必要です（Supabase ダッシュボード → Project Settings → API）。
`.env` に書くか、実行するターミナルでだけ環境変数として設定します。

PowerShell:

```powershell
$env:SUPABASE_URL = "https://<project-ref>.supabase.co"
$env:SUPABASE_SERVICE_ROLE_KEY = "<service role key>"
```

## 手順

1. **確認モードで実行** — `node scripts/rotate-wp-app-passwords.mjs`
   - 各サイトについて、今のパスワードで認証できるか・自動で入れ替えられるかを表示します。
   - レポート（`.diagnostics/wp-password-rotation-*.json`）の `app_passwords` に、
     各ユーザーに登録されている全アプリケーションパスワード（名前・最終使用日時・IP）が出ます。
     `role: "other"` で心当たりのないものがあれば、WP 管理画面で削除してください。
2. **実行** — `node scripts/rotate-wp-app-passwords.mjs --apply`
3. **失敗した組だけ手作業** — WP 管理画面で新しいパスワードを発行 → アプリの WordPress 設定画面で貼り替え → 接続テスト → 古いパスワードを削除。

## 実行時の動き

同じユーザー名とパスワードを使っている設定（同じサイトを複数件登録している等）はまとめて 1 回で処理します。

1. 今のパスワードで `introspect` を呼び、古いパスワードの UUID を特定
2. 新しいパスワード（名前: `ai-autowriter YYYY-MM-DD`）を発行し、登録されている全 URL で認証できるか確認
3. DB を更新（実行中に別の値へ変更された行は上書きしない）
4. すべてのサイトの更新が終わってから古いパスワードを削除し、使えなくなったことを確認

途中で失敗したサイトは、発行した新しいパスワードを削除して元の状態に戻します。
パスワードの値は画面にもレポートにも出しません。

## オプション

| オプション | 内容 |
| --- | --- |
| `--only=ID,ID` | `wordpress_configs.id` で対象を絞る（まず 1 件で試すときに便利） |
| `--keep-old` | 古いパスワードを削除しない（後で WP 管理画面から削除） |
| `--label=名前` | WP 側に表示される新パスワードの名前 |
| `--timeout=ミリ秒` | WP へのリクエストのタイムアウト（既定 20000） |
| `--report=パス` | レポートの保存先 |

## 今のパスワードの特定方法

通常は `introspect` で特定します。サイトによっては、アプリケーションパスワードで認証できているのに
`introspect` が `rest_application_password_not_found` を返すことがあります
（五十嵐工業様、rip-ple.com 公式で確認）。その場合は次のように扱います。

- そのユーザーのアプリケーションパスワードが 1 件だけ → それを今のパスワードと判断して入れ替える
  （レポートの `old_identified_by` が `only_app_password`）。削除後に旧パスワードで認証できないことを確認するので、誤判定は検出できます。
- 2 件以上ある → どれか判別できないので入れ替えない（手作業で対応）

## 自動で入れ替えられないケース

- `introspect` が使えず、ユーザーのアプリケーションパスワードが 2 件以上ある
- WordPress 5.7 未満（`introspect` がない）
- セキュリティプラグイン（SiteGuard、XO Security など）や WAF が REST API の `/users` を止めている
- 今のパスワードがすでに無効になっている

これらはレポートに `failed` として理由付きで出るので、手作業で対応してください。
