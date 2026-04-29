# AutomaticWriter 管理者・クライアント機能 実装タスク

## 目的

`13_Admin_Client_Account_Design.md` の設計をもとに、AutomaticWriterへ管理者用ページ、clientアカウント管理、ログイン権限、WordPress登録数制限、AI API設定権限を追加するための具体的な実装手順を整理する。

このタスク表は、進捗管理用として使う。

## 実装方針

- 既存アプリに管理者用ページを追加する
- サイトやアプリは分けない
- ロールは `admin` / `client` の2つだけにする
- `agency` ロールは作らない
- `account_type` は作らない
- 代理店的な利用は `client` の `wordpress_site_limit` で対応する
- clientにはWordPress設定とAI API設定の管理権限を持たせる
- データ分離は `account_id` を基準に行う

## 進捗ステータス

タスクの状態は以下で管理する。

```text
[ ] 未着手
[~] 作業中
[x] 完了
[!] 要確認・ブロック中
```

## Phase 0: 事前確認

- [x] 現在のSupabaseプロジェクトURL、anon key、service role keyの管理場所を確認する
- [!] 現在の本番環境、開発環境、ローカル環境の違いを整理する
- [x] Supabase Authが有効になっているか確認する
- [x] 既存テーブル一覧をSupabase上で確認する
- [!] 既存RLSポリシーの一覧を確認する
- [x] `USING (true)` / `TO public` / `Allow all access` のポリシーを洗い出す
- [!] 既存データのバックアップ方針を決める
- [~] 既存ユーザー、記事、WordPress設定、AI設定の移行方針を決める
- [!] 初期adminユーザーの作成方法を決める

Phase 0 メモ:

- ローカル `.env` には `VITE_SUPABASE_URL` と `VITE_SUPABASE_ANON_KEY` が設定済み。
- ローカル `.env` には `VITE_SUPABASE_SERVICE_KEY` は未設定。adminユーザー作成や本番DB操作はSupabase管理画面または安全な管理環境で行う。
- `supabase/.temp/project-ref` から現在のSupabase project refは確認済み。
- `supabase/config.toml` は存在しないため、ローカルSupabase環境よりもリモートSupabase前提の構成。
- `.env` は `.gitignore` 済み。
- 既存マイグレーション上、`articles`、`wordpress_configs`、`schedule_settings`、`ai_configs`、`execution_history`、`custom_topics`、`generation_prompts`、`keyword_sets`、`prompt_sets`、`title_sets`、`app_settings`、`scheduler_execution_locks` などに全許可系ポリシーがある。
- `fact_check_settings`、`fact_check_results`、`generation_regression_results` は一部 `user_id` / `auth.uid()` ベースの制限がある。
- 既存データはまず1つの初期accountへ紐づけ、その後client追加に対応する方針が安全。
- Supabase Table Editorの画像から、public schemaに以下の既存テーブルがあることを確認済み: `ai_configs`、`app_settings`、`articles`、`competitor_research`、`execution_history`、`fact_check_results`、`fact_check_settings`、`facts_cache`、`keyword_sets`、`keywords`、`prompt_sets`、`schedule_settings`、`schedule_used_keywords`、`scheduler_execution_locks`、`scheduler_lock`、`title_sets`、`trend_keywords`、`wordpress_configs`、`wp_configs`。
- 画像上で `UNRESTRICTED` 表示があるテーブル: `ai_configs`、`articles`、`competitor_research`、`facts_cache`、`schedule_settings`、`schedule_used_keywords`、`scheduler_lock`、`trend_keywords`、`wordpress_configs`、`wp_configs`。外部提供前にRLS見直しが必要。
- Supabase AuthのUsersにGoogleアカウントが存在する前提。Googleログインユーザーでも `auth.users.id` を `profiles.user_id` に紐づければ、admin/client設計で利用できる。
- ローカル環境には `supabase` CLI が存在する。Supabase CLIログインまたはアクセストークン設定ができれば、DB状態確認やマイグレーション適用を進めやすい。

完了条件:

- 現在のDB状態と既存データ移行方針が確認済み
- 外部提供化前に壊してはいけない既存機能が整理済み

## Phase 1: DB基盤追加

### 1. accountsテーブル追加

- [ ] `accounts` テーブル作成用マイグレーションを追加する
- [ ] `id` を主キーとして追加する
- [ ] `name` を追加する
- [ ] `status` を追加する
- [ ] `wordpress_site_limit` を追加する
- [ ] `feature_flags` を追加する
- [ ] `monthly_article_limit` を追加する
- [ ] `created_at` / `updated_at` を追加する
- [ ] `updated_at` 自動更新トリガーを設定する

推奨カラム:

```text
accounts
- id uuid primary key
- name text not null
- status text not null default 'active'
- wordpress_site_limit integer not null default 1
- feature_flags jsonb not null default '{}'
- monthly_article_limit integer
- created_at timestamptz default now()
- updated_at timestamptz default now()
```

### 2. profilesテーブル追加

- [ ] `profiles` テーブル作成用マイグレーションを追加する
- [ ] `user_id` をSupabase AuthユーザーIDとして追加する
- [ ] `account_id` を追加する
- [ ] `role` を追加する
- [ ] `display_name` を追加する
- [ ] `created_at` / `updated_at` を追加する
- [ ] `role` は `admin` / `client` のみ許可する
- [ ] `user_id` にユニーク制約を付ける
- [ ] `account_id` にインデックスを付ける

推奨カラム:

```text
profiles
- id uuid primary key
- user_id uuid not null unique
- account_id uuid references accounts(id)
- role text not null check (role in ('admin', 'client'))
- display_name text
- created_at timestamptz default now()
- updated_at timestamptz default now()
```

### 3. 初期データ投入

- [ ] 既存利用者用の初期accountを作成する
- [ ] 初期admin用profileを作成する
- [ ] 既存データを紐づけるための初期 `account_id` を控える

完了条件:

- `accounts` と `profiles` がSupabaseに作成されている
- 初期adminユーザーが識別できる
- 既存データに紐づける初期accountが決まっている

## Phase 2: 既存テーブルへの account_id 追加

### 1. account_id追加対象

- [ ] `articles` に `account_id` を追加する
- [ ] `wordpress_configs` に `account_id` を追加する
- [ ] `ai_configs` に `account_id` を追加する
- [ ] `schedule_settings` に `account_id` を追加する
- [ ] `execution_history` に `account_id` を追加する
- [ ] `keyword_sets` に `account_id` を追加する
- [ ] `prompt_sets` に `account_id` を追加する
- [ ] `title_sets` に `account_id` を追加する
- [ ] `app_settings` に `account_id` を追加する
- [ ] `fact_check_settings` に `account_id` を追加する
- [ ] `generation_regression_results` に `account_id` を追加する

### 2. 既存データ移行

- [ ] 初期accountを既存データへ一括設定する
- [ ] `account_id` がNULLの既存レコードが残っていないか確認する
- [ ] 必要なテーブルで `account_id` をNOT NULL化する
- [ ] `account_id` にインデックスを追加する
- [ ] `account_id` の外部キー制約を追加する

完了条件:

- 主要テーブルに `account_id` が入っている
- 既存データが初期accountへ紐づいている
- clientごとのデータ分離の土台ができている

## Phase 3: Supabase Auth連携

### 1. 認証ストア追加

- [ ] `src/store/useAuthStore.ts` を追加する
- [ ] 現在ログイン中のSupabaseユーザーを保持する
- [ ] profile情報を保持する
- [ ] account情報を保持する
- [ ] `isAdmin` / `isClient` を判定できるようにする
- [ ] ログアウト処理を追加する

### 2. ログイン画面追加

- [ ] `src/components/Login.tsx` を追加する
- [ ] メールアドレスとパスワードでログインできるようにする
- [ ] ログインエラーを日本語で表示する
- [ ] ログイン成功後にprofileを取得する
- [ ] `admin` は管理画面へ遷移する
- [ ] `client` は通常アプリ画面へ遷移する

### 3. アプリ起動時の認証確認

- [ ] `src/App.tsx` でログイン状態を確認する
- [ ] 未ログインならログイン画面を表示する
- [ ] profile未作成ユーザーは利用不可画面を表示する
- [ ] 停止中accountのclientは利用不可画面を表示する
- [ ] ログイン済みclientだけ `loadFromSupabase` を実行する

完了条件:

- 未ログインではアプリ本体を表示できない
- ログイン後に `admin` / `client` の出し分けができる
- 認証状態がリロード後も復元される

## Phase 4: 管理者ページ追加

### 1. 管理画面ルート追加

- [ ] `/admin` 相当の管理者ビューを追加する
- [ ] clientは管理者ビューを開けないようにする
- [ ] 管理画面用のナビゲーションを追加する
- [ ] 通常アプリ画面と管理画面をUI上で分ける

### 2. client一覧

- [ ] client一覧画面を追加する
- [ ] `accounts` の一覧を表示する
- [ ] account名を表示する
- [ ] statusを表示する
- [ ] WordPress登録上限を表示する
- [ ] 登録済みWordPress数を表示する
- [ ] 作成日・更新日を表示する

### 3. client新規作成

- [ ] client作成フォームを追加する
- [ ] account名を入力できるようにする
- [ ] WordPress登録上限数を設定できるようにする
- [ ] 初期statusを設定できるようにする
- [ ] feature_flagsを初期化する
- [ ] Supabase Authユーザー作成手順を決める
- [ ] profileを作成してaccountへ紐づける

### 4. client詳細・編集

- [ ] client詳細画面を追加する
- [ ] account名を編集できるようにする
- [ ] statusを変更できるようにする
- [ ] WordPress登録上限数を変更できるようにする
- [ ] feature_flagsを変更できるようにする
- [ ] 利用停止・再開を操作できるようにする

完了条件:

- adminがclientを作成・確認・編集できる
- clientの利用停止とWordPress登録上限を管理できる

## Phase 5: client側データ分離

### 1. サービス層の修正

- [ ] `articlesService` の取得条件に `account_id` を追加する
- [ ] `articlesService` の作成データに `account_id` を付ける
- [ ] `supabaseSchedulerService` の取得・保存条件に `account_id` を追加する
- [ ] `scheduleService` の取得・保存条件に `account_id` を追加する
- [ ] `promptSetService` の取得・保存条件に `account_id` を追加する
- [ ] `keywordSetService` の取得・保存条件に `account_id` を追加する
- [ ] `titleSetService` の取得・保存条件に `account_id` を追加する
- [ ] `apiKeyManager` / `ai_configs` 周辺に `account_id` を追加する

### 2. ストア修正

- [ ] `useAppStore` がログイン中accountを参照できるようにする
- [ ] `loadFromSupabase` をaccount単位に変更する
- [ ] データ作成時に必ず `account_id` を入れる
- [ ] account切り替えが不要な前提でclientは自account固定にする

### 3. 画面修正

- [ ] 記事一覧が自accountの記事だけ表示されることを確認する
- [ ] WordPress設定が自accountの設定だけ表示されることを確認する
- [ ] AI設定が自accountの設定だけ表示されることを確認する
- [ ] スケジュールが自accountの設定だけ表示されることを確認する

完了条件:

- clientが他accountのデータを画面上で見られない
- 新規作成データに正しい `account_id` が入る

## Phase 6: WordPress登録数制限

### 1. 登録制御

- [ ] clientの `wordpress_site_limit` を取得できるようにする
- [ ] 現在のWordPress登録数を取得できるようにする
- [ ] 登録数が上限未満の場合だけ新規登録を許可する
- [ ] 登録数が上限に達した場合は新規登録ボタンを無効化する
- [ ] 上限到達メッセージを表示する

### 2. 管理画面との連携

- [ ] adminが上限数を増減できるようにする
- [ ] 上限数を減らす場合、既存登録数より小さい値を許可するか決める
- [ ] 既存登録数を下回る上限にする場合の表示仕様を決める

完了条件:

- clientごとにWordPress登録可能数を制御できる
- 1サイト利用会社にも複数サイト利用会社にも対応できる

## Phase 7: clientのAI API設定権限

### 1. AI設定のaccount対応

- [ ] `ai_configs` に `account_id` が入るようにする
- [ ] clientは自accountのAI設定だけ取得できるようにする
- [ ] clientは自accountのAI設定を作成できるようにする
- [ ] clientは自accountのAI設定を編集できるようにする
- [ ] clientは自accountのAI設定を削除できるようにする
- [ ] 有効なAI設定をaccount単位で管理する

### 2. APIキー表示の安全化

- [ ] APIキーは一覧や詳細で平文表示しない
- [ ] `sk-...abcd` のようなマスク表示にする
- [ ] 編集時はAPIキーを再入力する仕様にする
- [ ] admin画面でもAPIキー全文を表示しない
- [ ] 可能であれば保存時の暗号化方針を検討する

完了条件:

- clientが自分のAI API設定を管理できる
- APIキーが画面上に平文で露出しない

## Phase 8: RLS修正

### 1. ヘルパー関数

- [ ] ログインユーザーのroleを返すDB関数を追加する
- [ ] ログインユーザーのaccount_idを返すDB関数を追加する
- [ ] admin判定用DB関数を追加する

### 2. 既存ポリシーの置き換え

- [ ] `articles` の `USING (true)` ポリシーを廃止する
- [ ] `wordpress_configs` の全許可ポリシーを廃止する
- [ ] `ai_configs` の全許可ポリシーを廃止する
- [ ] `schedule_settings` の全許可ポリシーを廃止する
- [ ] `execution_history` の全許可ポリシーを廃止する
- [ ] `keyword_sets` の全許可ポリシーを廃止する
- [ ] `prompt_sets` の全許可ポリシーを廃止する
- [ ] `title_sets` の全許可ポリシーを廃止する
- [ ] `app_settings` のanon許可ポリシーを廃止する

### 3. 新RLSルール

- [ ] clientは自accountのデータだけSELECT可能にする
- [ ] clientは自accountのデータだけINSERT可能にする
- [ ] clientは自accountのデータだけUPDATE可能にする
- [ ] clientは自accountのデータだけDELETE可能にする
- [ ] adminは全accountのデータをSELECT可能にする
- [ ] adminは必要な管理テーブルをINSERT/UPDATE可能にする

完了条件:

- DBレベルでも他accountのデータを読めない
- `TO public` / `USING (true)` の危険なポリシーが主要テーブルから消えている

## Phase 9: Edge Function対応

- [ ] `ai-proxy` がログインユーザーまたはaccountを検証するようにする
- [ ] `scheduler` がaccount単位でデータを扱うようにする
- [ ] `scheduler-executor` がscheduleの `account_id` を保持して処理するようにする
- [ ] WordPress投稿時に対象accountのWordPress設定だけ使うようにする
- [ ] AI APIキー取得時に対象accountのAI設定だけ使うようにする
- [ ] service roleを使う処理でもaccount境界を崩さないようにする

完了条件:

- バックエンド処理でもaccountをまたいだ参照が起きない
- スケジュール実行やWordPress投稿が既存通り動く

## Phase 10: 利用状況・機能ON/OFF

### 1. feature_flags

- [ ] `feature_flags` の初期仕様を決める
- [ ] WordPress投稿機能ON/OFFを実装する
- [ ] スケジューラーON/OFFを実装する
- [ ] 画像生成ON/OFFを実装する
- [ ] ファクトチェックON/OFFを実装する
- [ ] 無効機能はclient画面で非表示または利用不可にする

推奨初期値:

```json
{
  "wordpress_publish": true,
  "scheduler": true,
  "image_generation": true,
  "fact_check": true
}
```

### 2. 利用状況

- [ ] accountごとの記事生成数を集計する
- [ ] accountごとのWordPress登録数を集計する
- [ ] accountごとのスケジュール数を集計する
- [ ] admin画面に利用状況を表示する
- [ ] client画面に自分の利用状況を表示する

完了条件:

- adminがclientごとの利用状況を確認できる
- clientが自分の利用状況を確認できる
- 機能ON/OFFが画面と処理に反映される

## Phase 11: UI整理・既存機能チェック

- [ ] 文字化けしている表示文言を修正する
- [ ] エラー文言をclient向けに分かりやすくする
- [ ] 管理者向け文言とclient向け文言を分ける
- [ ] 未使用機能を洗い出す
- [ ] 外部提供に不要な機能を非表示にするか削除候補にする
- [ ] WordPress設定画面に登録上限の表示を追加する
- [ ] AI設定画面にAPIキー管理の注意文を追加する
- [ ] ログアウト導線を追加する

完了条件:

- 外部提供先が迷わず使える最低限のUIになっている
- 管理者だけが見る情報とclientが見る情報が分離されている

## Phase 12: テスト

### 1. adminテスト

- [ ] adminでログインできる
- [ ] adminでclient一覧を見られる
- [ ] adminでclientを作成できる
- [ ] adminでclientを停止できる
- [ ] adminでclientを再開できる
- [ ] adminでWordPress登録上限を変更できる
- [ ] adminで機能ON/OFFを変更できる

### 2. clientテスト

- [ ] clientでログインできる
- [ ] clientは管理画面にアクセスできない
- [ ] clientは自accountの記事だけ見られる
- [ ] clientは自accountのWordPress設定だけ見られる
- [ ] clientは自accountのAI設定だけ見られる
- [ ] clientはAI API設定を登録できる
- [ ] clientはWordPress登録上限までサイトを追加できる
- [ ] clientはWordPress登録上限を超えて追加できない
- [ ] 停止中clientはアプリを利用できない

### 3. データ分離テスト

- [ ] client Aで作成した記事がclient Bに見えない
- [ ] client AのWordPress設定がclient Bに見えない
- [ ] client AのAI設定がclient Bに見えない
- [ ] client Aのスケジュールがclient Bに見えない
- [ ] API経由でも他accountのデータを取得できない

### 4. 既存機能回帰テスト

- [ ] 記事生成ができる
- [ ] 記事保存ができる
- [ ] WordPress下書き保存ができる
- [ ] WordPress公開ができる
- [ ] スケジュール登録ができる
- [ ] スケジュール実行ができる
- [ ] キーワード設定が保存できる
- [ ] タイトル設定が保存できる
- [ ] プロンプト設定が保存できる
- [ ] `npm run build` が通る
- [ ] `npm run lint` が通る、または既知の警告だけである

完了条件:

- admin/clientの主要操作が通る
- account分離が画面・DB・APIで確認できる
- 既存のオートライター主要機能が壊れていない

## Phase 13: リリース準備

- [ ] 本番DBのバックアップを取得する
- [ ] 本番反映用マイグレーションの順番を確認する
- [ ] 初期adminユーザー作成手順を文書化する
- [ ] 既存データの初期account紐づけSQLを確認する
- [ ] 本番環境変数を確認する
- [ ] Supabase Authメール設定を確認する
- [ ] パスワードリセット導線を確認する
- [ ] ロールバック手順を用意する
- [ ] リリース後の動作確認項目を用意する

完了条件:

- 本番反映前に戻せる状態がある
- 初期adminでログインして管理できる手順がある
- 既存データを失わず移行できる

## Phase 14: Netlify から Vercel への移行

詳細手順は `12_Netlify_to_Vercel_Migration_Guide.md` も参照する。

### 1. 移行前確認

- [ ] 現在のNetlify本番URLを確認する
- [ ] 独自ドメインを使っているか確認する
- [ ] DNSを変更できる管理画面へのアクセス権限を確認する
- [ ] Netlifyに設定されている環境変数を一覧化する
- [ ] Vercelへ移す必要がある環境変数を確定する
- [ ] ローカルで `npm run build` が通ることを確認する
- [ ] Vercel移行前のNetlify本番URLをロールバック先として控える

### 2. Vercelプロジェクト作成

- [ ] Vercelアカウントにログインする
- [ ] GitHubリポジトリをVercelに接続する
- [ ] Framework PresetがViteになっていることを確認する
- [ ] Root Directoryをリポジトリ直下に設定する
- [ ] Install Commandを確認する
- [ ] Build Commandを `npm run build` に設定する
- [ ] Output Directoryを `build` に設定する
- [ ] Node.jsバージョンが `package.json` の `>=20 <24` に合うように設定する

推奨設定:

```text
Install Command: npm install
Build Command: npm run build
Output Directory: build
```

### 3. Vercel環境変数設定

- [ ] `VITE_SUPABASE_URL` を設定する
- [ ] `VITE_SUPABASE_ANON_KEY` を設定する
- [ ] `VITE_DEPLOYMENT_MODE` を設定する
- [ ] `VITE_GOOGLE_CUSTOM_SEARCH_API_KEY` を設定する
- [ ] `VITE_GOOGLE_CUSTOM_SEARCH_ENGINE_ID` を設定する
- [ ] `VITE_SERPAPI_KEY` を設定する
- [ ] Netlify側にだけ存在する環境変数がないか確認する
- [ ] Vercel Preview / Production の両方に必要な環境変数を設定する

注意:

- `VITE_` 付き環境変数はフロントエンドに埋め込まれる
- service role keyや秘密度の高いキーはViteのpublic envに入れない
- 今後Supabase Authを使うため、Vercel URLをSupabaseの許可URLへ追加する必要がある

### 4. Vercel Preview確認

- [ ] Vercelの初回デプロイが成功する
- [ ] Preview URLで画面が開く
- [ ] ログイン画面が表示される
- [ ] adminでログインできる
- [ ] clientでログインできる
- [ ] 記事一覧が表示される
- [ ] WordPress設定画面が表示される
- [ ] AI API設定画面が表示される
- [ ] 記事生成が動く
- [ ] WordPress投稿テストが通る
- [ ] ブラウザコンソールに致命的なエラーがない

### 5. Supabase Auth URL設定

- [ ] Supabase Dashboardを開く
- [ ] Authentication -> URL Configurationを開く
- [ ] Vercel Production URLをSite URLまたはRedirect URLsに追加する
- [ ] Vercel Preview URLをRedirect URLsに追加するか判断する
- [ ] 独自ドメイン切り替え後のURLもRedirect URLsに追加する
- [ ] パスワードリセットやメール認証を使う場合のRedirect URLを確認する

### 6. 独自ドメイン切り替え

- [ ] VercelのDomainsに独自ドメインを追加する
- [ ] DNS設定をVercel指定値へ変更する
- [ ] SSLが有効になるまで待つ
- [ ] 旧Netlify側のドメイン設定をすぐ消さず、ロールバック用に残す
- [ ] DNS切り替え後に本番URLでログインできることを確認する
- [ ] SupabaseのSite URLを最終本番URLへ更新する

### 7. Netlify停止判断

- [ ] Vercel本番で主要機能が安定していることを確認する
- [ ] DNSがVercelへ向いていることを確認する
- [ ] Netlify側を一定期間ロールバック用に残す
- [ ] 問題がなければNetlifyの自動デプロイを停止する
- [ ] Netlifyの環境変数や設定を記録してから整理する

完了条件:

- Vercelで本番デプロイが成功している
- 独自ドメインがVercelへ向いている
- Supabase Authの許可URLがVercel本番URLに対応している
- admin/clientのログインと主要機能がVercel上で動く
- Netlifyへ戻せるロールバック手順が残っている

## Phase 15: リリース後確認

- [ ] adminで本番ログインできる
- [ ] 既存データが初期accountに紐づいている
- [ ] 既存記事が表示される
- [ ] 既存WordPress設定が表示される
- [ ] 既存AI設定が表示される
- [ ] 新規clientを作成できる
- [ ] 新規clientでログインできる
- [ ] 新規clientでWordPressを登録できる
- [ ] 新規clientでAI API設定を登録できる
- [ ] 新規clientで記事生成できる
- [ ] 他clientのデータが見えない
- [ ] 停止中clientが利用できない
- [ ] Vercel本番URLで主要機能が動く
- [ ] Netlify本番URLからの切り替えが完了している

完了条件:

- 外部提供用の最小運用が開始できる
- 新しいclientを管理画面から追加できる

## 優先度付き最短ルート

最初のリリースで最低限必要なタスク。

- [ ] Phase 1: `accounts` / `profiles` 追加
- [ ] Phase 2: 主要テーブルに `account_id` 追加
- [ ] Phase 3: ログインとロール判定
- [ ] Phase 4: 管理画面の最小版
- [ ] Phase 5: client側データ分離
- [ ] Phase 6: WordPress登録数制限
- [ ] Phase 7: clientのAI API設定権限
- [ ] Phase 8: RLS修正
- [ ] Phase 12: admin/client/データ分離テスト

後回しにできるタスク。

- [ ] 詳細な利用状況グラフ
- [ ] 請求管理
- [ ] お知らせ配信
- [ ] サポート履歴
- [ ] リリース履歴表示
- [ ] 月間AI利用量の細かい集計

## 実装時の注意点

- DB変更は必ずマイグレーションで管理する
- 既存データに `account_id` を入れてからRLSを厳しくする
- RLSを先に厳しくすると既存画面が読めなくなる可能性がある
- clientのAPIキーは平文表示しない
- adminでもAPIキー全文を見せない
- service roleを使うEdge Functionではaccount境界を必ずコードで守る
- まず1つの初期accountへ既存データを寄せてから、複数client対応へ進める
- 実装中はテスト用adminとテスト用clientを最低1つずつ用意する

## 完了定義

この実装全体の完了条件。

- adminが管理画面からclientを作成・停止・編集できる
- clientがログインして通常のオートライター機能を使える
- clientが自分のWordPressサイトを登録できる
- clientがWordPress登録上限を超えて登録できない
- clientが自分のAI API設定を管理できる
- client同士のデータが分離されている
- adminは全clientを管理できる
- DBのRLSでもaccount単位の制限が効いている
- 既存の主要機能が壊れていない
- 本番環境で新規clientを追加して外部提供を開始できる
