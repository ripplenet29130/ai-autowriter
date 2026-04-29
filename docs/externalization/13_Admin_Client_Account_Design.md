# AutomaticWriter 管理者・クライアント設計

## 目的

AutomaticWriter を外部提供できる形にするため、現在のアプリに管理者用ページとアカウント管理機能を追加する。

アプリやサイトを別々に複製して配布するのではなく、1つのマスターアプリを複数クライアントで利用できる構成にする。これにより、将来の機能追加、不具合修正、バージョンアップをマスター側で一元管理できるようにする。

## 基本方針

- 今のアプリに管理者用ページを追加する
- サイト自体は分けない
- ロールは `admin` と `client` の2つにする
- `agency` ロールは作らない
- `account_type` は持たせない
- 代理店的な利用も `client` として扱う
- WordPress登録数、利用上限、機能ON/OFFで契約差を表現する
- client は自分のWordPress設定とAI API設定を管理できる
- admin は全clientアカウントを管理できる

## ロール設計

### admin

運営管理者用のロール。

できること:

- 全clientアカウントの作成・編集
- clientの利用停止・再開
- clientごとのWordPress登録上限数の設定
- clientごとの機能ON/OFF
- clientごとの利用状況確認
- 必要に応じた登録WordPressサイトの確認
- 全体設定や共通プロンプトの管理
- バージョンアップ後の機能公開管理

### client

外部提供先、通常契約会社、複数サイトを持つ会社、HP業者をすべて含むロール。

できること:

- 自分のWordPressサイトを登録・編集・削除
- 登録上限数までWordPressサイトを追加
- 自分の登録サイトを管理
- 自分のWordPressサイトに対して記事生成・投稿
- 自分の記事、スケジュール、投稿履歴を見る
- 自分のAI API設定を登録・編集・削除
- 自分のキーワード、タイトル、プロンプト、各種設定を変更
- 自分の利用状況を見る

## 代理店的な利用の扱い

`agency` というロールは作らない。

代理店やHP業者も `client` として登録し、WordPress登録上限数を増やすことで対応する。

例:

```text
A社 client
- WordPress登録上限: 1

B社 client
- WordPress登録上限: 5

HP業者 client
- WordPress登録上限: 30
```

この形にすると、1サイトだけの会社、複数サイトを持つ会社、代理店的に複数顧客サイトを管理したいHP業者を同じ仕組みで扱える。

## アカウント設計

`account_type` は持たせない。

契約差や利用差は以下の項目で管理する。

- `wordpress_site_limit`
- `feature_flags`
- `usage_limits`
- `status`

## 推奨データ構造

### accounts

契約アカウントを表す。

```text
accounts
- id
- name
- status
- wordpress_site_limit
- feature_flags
- monthly_article_limit
- created_at
- updated_at
```

主な用途:

- clientの契約単位
- WordPress登録上限の管理
- 利用停止・再開の管理
- 機能ON/OFFの管理
- 利用上限の管理

### profiles

Supabase Auth のユーザーとアプリ内権限を紐づける。

```text
profiles
- id
- user_id
- account_id
- role: admin / client
- display_name
- created_at
- updated_at
```

補足:

- `admin` は `account_id` を持たない、または管理用accountに紐づける
- `client` は必ず `account_id` に紐づく

### wordpress_configs

WordPress投稿先サイトの設定。

```text
wordpress_configs
- id
- account_id
- site_name
- site_url
- username
- app_password
- is_active
- created_at
- updated_at
```

補足:

- clientは自分の `account_id` のWordPress設定だけ操作できる
- 登録数は `accounts.wordpress_site_limit` を超えないように制御する

### ai_configs

clientごとのAI API設定。

```text
ai_configs
- id
- account_id
- provider
- model
- api_key
- is_active
- created_at
- updated_at
```

補足:

- clientは自分のAI API設定を登録・編集・削除できる
- adminは登録状態を確認できる
- APIキーは画面上で平文表示しない
- 表示時は `sk-...abcd` のようにマスクする
- 編集時は再入力を基本にする

### articles

生成記事。

```text
articles
- id
- account_id
- wordpress_config_id
- title
- content
- status
- created_at
- updated_at
```

補足:

- clientは自分の `account_id` の記事だけ見られる
- adminは全accountの記事を確認できる

### その他 account_id を追加すべきテーブル

外部提供化では、以下にも `account_id` を追加する。

- `schedule_settings`
- `execution_history`
- `keyword_sets`
- `prompt_sets`
- `title_sets`
- `app_settings`
- `fact_check_settings`
- `generation_regression_results`

## 画面構成

サイトは1つのまま、ログイン後の権限で表示を分ける。

```text
/login
/app
/admin
```

ログイン後の遷移:

```text
admin  -> /admin
client -> /app
```

### 管理者画面

最小実装:

```text
/admin
/admin/clients
/admin/clients/new
/admin/clients/:id
```

機能:

- client一覧
- client新規作成
- client編集
- 利用停止・再開
- WordPress登録上限数の設定
- 機能ON/OFF
- 利用状況確認

### client画面

既存のオートライター画面をベースにする。

clientが使う機能:

- ダッシュボード
- 記事生成
- 記事一覧
- スケジュール
- WordPress設定
- AI API設定
- キーワード設定
- タイトル設定
- プロンプト設定
- 利用状況

## 権限制御

### 基本ルール

- 未ログインユーザーはアプリを利用できない
- clientは自分の `account_id` のデータだけ操作できる
- adminは全accountのデータを管理できる
- clientは管理者画面にアクセスできない
- 利用停止中のclientはログイン後に利用不可画面を表示する

### RLS方針

現在の `USING (true)` や `TO public` のポリシーは外部提供向けには危険なため、段階的に廃止する。

client向け:

```text
auth.uid() の profile.account_id = 対象テーブル.account_id
```

admin向け:

```text
auth.uid() の profile.role = 'admin'
```

この2つを基本条件にする。

## WordPress登録数制限

clientごとのWordPress登録数は `accounts.wordpress_site_limit` で制御する。

登録時のチェック:

```text
現在の wordpress_configs 件数 < wordpress_site_limit
```

上限に達している場合:

- 新規登録ボタンを無効化
- 上限に達していることを表示
- adminに問い合わせる導線を出す

## AI API設定の扱い

clientにAI API設定権限を持たせる。

理由:

- clientごとにAPI利用料の負担を分けられる
- providerやmodelをclientごとに選べる
- 外部提供時の運用負担を下げられる

注意点:

- APIキーは平文表示しない
- 保存時は可能であれば暗号化する
- admin画面でもAPIキー全文は表示しない
- 削除・再登録・有効化の操作を用意する

## 実装順

1. Supabase Auth を使ったログイン機能を追加
2. `accounts` と `profiles` を追加
3. `admin` / `client` の2ロールを実装
4. 既存テーブルに `account_id` を追加
5. clientのデータ取得・保存を `account_id` 単位に変更
6. WordPress登録上限数のチェックを追加
7. clientがAI API設定を管理できるようにする
8. 管理者画面の最小版を追加
9. RLSを `account_id` と `role` ベースに修正
10. 既存の `USING (true)` / `TO public` ポリシーを廃止
11. 利用状況、機能ON/OFF、上限管理を拡張

## 将来の拡張

必要になった場合に追加する。

- 複数ユーザーを1accountに紐づける
- 月間記事生成数上限
- 月間AI利用量上限
- サイト別利用状況
- account別請求管理
- お知らせ配信
- リリース履歴
- client別機能公開
- サポート対応履歴

## 結論

今のアプリに管理者用ページとアカウント管理機能を追加する方針で進める。

ロールは `admin` と `client` の2つにし、`agency` ロールや `account_type` は作らない。代理店的な利用は、clientのWordPress登録上限数を増やすことで対応する。

clientにはWordPress設定だけでなく、AI API設定の管理権限も持たせる。

この設計により、1サイト利用の会社、複数サイト利用の会社、HP業者のような代理店的利用を同じ構造で扱える。将来的なバージョンアップも、マスターアプリを修正するだけで全clientに反映できる。
