# Google Search Console Integration Plan

## 目的

AIオートライターに、登録済みのWordPressサイトごとにGoogle Search Consoleの検索パフォーマンスを確認できる機能を追加する。

最初のゴールは、SEO researcherアプリを丸ごと統合することではなく、同アプリにあるSearch Console連携機能をAIオートライターの既存導線に合わせて取り込むことである。

## 背景

現在のAIオートライターは、WordPressサイトを `wordpress_configs` で管理している。記事生成、予約投稿、WordPress投稿はこの設定を中心に動いている。

一方、`seo-researcher` は独立したNext.jsアプリで、以下の機能を持っている。

- Google Search Console OAuth連携
- Search Consoleのクリック数、表示回数、CTR、平均掲載順位の取得
- クエリ別Search Consoleデータ表示
- サイト管理
- キーワード順位取得
- Chatwork通知
- 自動取得スケジュール

今回の目的に対しては、SEO researcher側の「サイト管理」をそのまま持ち込むより、AIオートライターのWordPress設定を親データとして使い、Search Console結果だけを紐づける方が自然である。

## 対象範囲

### MVPで実装する

- Google Search Console連携ボタン
- Google OAuthで `webmasters.readonly` スコープを取得
- GSCトークン保存、更新
- 登録済みWordPressサイトとGSCプロパティの一致確認
- サイト別の検索パフォーマンス表示
  - クリック数
  - 表示回数
  - CTR
  - 平均掲載順位
- 日別推移グラフ
- クエリ別テーブル
- 期間切り替え
  - 7日
  - 28日
  - 90日

### MVPでは実装しない

- SerpAPIによる順位取得
- キーワード順位の定期取得
- Chatwork通知
- SEO researcherの独立したサイト管理画面
- URL別、ページ別の高度な分析
- AIによる改善提案の自動生成

これらは第2段階以降で検討する。

## 推奨UX

### 1. 接続設定画面

既存の `接続設定` または `WordPress設定` にSearch Console連携状態を追加する。

各WordPressサイトのカードまたは一覧に以下を表示する。

- GSC連携状態
  - 未連携
  - 確認済み
  - 権限なし
  - プロパティ未一致
  - トークン期限切れ
- 一致したGSCプロパティURL
- 最終確認日時
- 「Google Search Consoleと連携」ボタン
- 「状態を再確認」ボタン

### 2. Search Consoleダッシュボード

WordPressサイトごとの詳細表示として、以下を表示する。

- 期間選択
- サマリーカード
  - クリック数
  - 表示回数
  - CTR
  - 平均掲載順位
- 日別グラフ
- クエリ別テーブル
  - クエリ
  - クリック数
  - 表示回数
  - CTR
  - 平均掲載順位
- ソート
- クエリ検索

### 3. 将来の生成連携

第2段階では、Search Consoleデータを記事生成に活かす。

- 表示回数が多くCTRが低いクエリからタイトル改善候補を出す
- 平均掲載順位が8〜20位のクエリからリライト候補を出す
- クリック数が伸びているクエリから新規記事候補を出す
- 記事生成画面に「Search Consoleからキーワード候補を取り込む」を追加する

## 既存資産

SEO researcher側から参考にするファイル。

- `seo-researcher/lib/gsc.ts`
  - GSCトークン取得、更新
  - Search Consoleスコープ確認
- `seo-researcher/lib/gscSiteStatus.ts`
  - GSCプロパティ一覧取得
  - サイトURLとGSCプロパティの一致判定
- `seo-researcher/app/actions/fetchGSCData.ts`
  - 日別クリック数、表示回数取得
- `seo-researcher/app/actions/fetchGSCQueryData.ts`
  - クエリ別データ取得
- `seo-researcher/components/SearchConsoleChart.tsx`
  - グラフUIの参考
- `seo-researcher/components/SearchConsoleQueryTable.tsx`
  - クエリテーブルUIの参考
- `seo-researcher/supabase/migrations/20260303160500_add_user_gsc_tokens.sql`
  - トークン保存テーブルの参考
- `seo-researcher/supabase/migrations/20260424000100_add_gsc_property_status_to_sites.sql`
  - GSCプロパティ確認状態の参考

## アーキテクチャ方針

AIオートライターはVite + Reactアプリであり、SEO researcherはNext.jsアプリである。そのため、Next.jsのServer ActionsやApp Routerの構造はそのまま移植しない。

代わりに、以下の構成にする。

- フロントエンド
  - ReactコンポーネントとしてGSC接続UI、ダッシュボードUIを追加
  - Rechartsは既にAIオートライター側にも入っているため、グラフは既存依存で実装する
- サーバー側処理
  - Supabase Edge FunctionでGoogle API呼び出しを代理実行する
  - GSCトークン更新もEdge Function側で行う
- DB
  - 既存の `wordpress_configs` にGSC状態を直接追加するか、関連テーブルを作る
  - 推奨は関連テーブル方式

## 推奨DB設計

### gsc_tokens

Google Search Console用のOAuthトークンを保存する。

```sql
create table if not exists public.gsc_tokens (
  user_id uuid primary key references auth.users(id) on delete cascade,
  account_id uuid references public.accounts(id) on delete cascade,
  provider_token text not null,
  provider_refresh_token text,
  expires_at timestamptz,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);
```

RLS方針:

- ユーザーは自分のトークンのみ参照、更新できる
- Edge Functionのservice roleは全件参照、更新できる
- クライアントから直接Google APIへはアクセスしない

### gsc_property_statuses

WordPress設定とGSCプロパティの一致状態を保存する。

```sql
create table if not exists public.gsc_property_statuses (
  wordpress_config_id uuid primary key references public.wordpress_configs(id) on delete cascade,
  account_id uuid references public.accounts(id) on delete cascade,
  verified boolean not null default false,
  matched_property_url text,
  checked_at timestamptz,
  error_code text,
  error_message text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);
```

### キャッシュテーブル

MVPでは必須ではない。表示のたびにGSC APIを呼び出してもよい。

ただし、API制限や表示速度を考えると、将来的には以下を追加する。

```sql
create table if not exists public.gsc_daily_metrics (
  id uuid default gen_random_uuid() primary key,
  wordpress_config_id uuid references public.wordpress_configs(id) on delete cascade,
  account_id uuid references public.accounts(id) on delete cascade,
  date date not null,
  clicks integer not null default 0,
  impressions integer not null default 0,
  ctr numeric,
  position numeric,
  created_at timestamptz default now(),
  unique (wordpress_config_id, date)
);
```

```sql
create table if not exists public.gsc_query_metrics (
  id uuid default gen_random_uuid() primary key,
  wordpress_config_id uuid references public.wordpress_configs(id) on delete cascade,
  account_id uuid references public.accounts(id) on delete cascade,
  period_start date not null,
  period_end date not null,
  query text not null,
  clicks integer not null default 0,
  impressions integer not null default 0,
  ctr numeric,
  position numeric,
  created_at timestamptz default now(),
  unique (wordpress_config_id, period_start, period_end, query)
);
```

## OAuth仕様

### 必要なGoogleスコープ

```text
https://www.googleapis.com/auth/webmasters.readonly
```

### Supabase Auth設定

Supabase AuthenticationのGoogle Providerに以下を設定する。

- Google Client ID
- Google Client Secret
- Additional Scopes
  - `https://www.googleapis.com/auth/webmasters.readonly`

OAuth実行時は以下を指定する。

- `access_type=offline`
- `prompt=consent`

これにより、初回認可時にrefresh tokenを取得する。

### コールバック

AIオートライターはViteアプリなので、Next.jsの `/auth/callback` routeは使わない。

候補は2つ。

1. Supabase Authのセッション更新後、フロント側で `provider_token` と `provider_refresh_token` を読み取り、Edge Functionへ送って保存する
2. OAuth後に専用のEdge Functionを呼び、サーバー側でトークン保存を完結する

推奨は1。既存のSupabase Auth構成に最小変更で追加できるため。

## Edge Function設計

### gsc-token-save

OAuth後にGSCトークンをDBへ保存する。

入力:

```json
{
  "provider_token": "...",
  "provider_refresh_token": "...",
  "expires_in": 3600
}
```

処理:

- JWTから `user_id` を取得
- `profiles` から `account_id` を取得
- `gsc_tokens` にupsert
- refresh tokenが送られてこない場合、既存のrefresh tokenを保持する

### gsc-property-status

WordPressサイトがGSCプロパティとしてアクセス可能か確認する。

入力:

```json
{
  "wordpress_config_id": "..."
}
```

処理:

- `wordpress_configs` からURLを取得
- 有効なGSCトークンを取得または更新
- `https://www.googleapis.com/webmasters/v3/sites` を呼ぶ
- URL Prefixプロパティ、Domainプロパティの両方を照合する
- `gsc_property_statuses` に保存

### gsc-search-analytics

Search Consoleの検索パフォーマンスを取得する。

入力:

```json
{
  "wordpress_config_id": "...",
  "days": 28,
  "dimension": "date"
}
```

対応dimension:

- `date`
- `query`
- 将来: `page`

処理:

- `wordpress_configs` と `gsc_property_statuses` を取得
- `matched_property_url` があればそれを使う
- なければWordPress URLを正規化して使う
- Search Analytics APIを呼ぶ
- 結果を返す

## URL照合仕様

GSCプロパティには主に2種類ある。

### URL Prefix

例:

```text
https://example.com/
https://www.example.com/
```

照合方針:

- protocolを含める
- hostを小文字化する
- path末尾に `/` を補正する
- 完全一致を基本とする

### Domain Property

例:

```text
sc-domain:example.com
```

照合方針:

- WordPress URLのhostnameを抽出
- hostnameがdomainと一致、またはサブドメインであれば一致

例:

- `example.com` と `sc-domain:example.com` は一致
- `www.example.com` と `sc-domain:example.com` は一致
- `blog.example.com` と `sc-domain:example.com` は一致

## フロントエンド実装

### 追加コンポーネント案

```text
src/components/SearchConsole/
  ConnectGscButton.tsx
  SearchConsoleStatusBadge.tsx
  SearchConsoleDashboard.tsx
  SearchConsoleSummaryCards.tsx
  SearchConsoleChart.tsx
  SearchConsoleQueryTable.tsx
  PeriodSelector.tsx
```

### 追加サービス案

```text
src/services/searchConsoleService.ts
```

責務:

- Edge Function呼び出し
- GSC状態取得
- 日別データ取得
- クエリ別データ取得
- エラー文言の正規化

### 画面追加場所

第1候補:

- `src/components/WordPressConfig/ConfigList.tsx`
- WordPress設定カード内にGSC状態とボタンを追加

第2候補:

- `src/components/Settings.tsx`
- 接続設定の中に「Search Console」セクションを追加

推奨は第1候補。ユーザーの意識として「登録済みWordPressサイトの成果を見る」導線になるため。

## エラー表示仕様

ユーザーに表示するエラーは、Google APIの生メッセージをそのまま出さず、以下のように変換する。

| 状態 | 表示文 |
| --- | --- |
| トークンなし | Google Search Console連携が必要です |
| スコープ不足 | Search Console権限が不足しています。再連携してください |
| refresh tokenなし | 再連携が必要です |
| 403 | このGoogleアカウントには対象サイトのSearch Console権限がありません |
| 404 | 対象サイトがSearch Consoleプロパティとして見つかりません |
| 401 | Google認証の有効期限が切れています。再連携してください |

## 実装手順

### Phase 1: 調査と整理

- `seo-researcher` からGSC関連ロジックだけを抽出する
- AIオートライター側の認証方式、account_idの扱いを確認する
- `wordpress_configs` と `wp_configs` の現状を確認する
- GSC連携対象を `wordpress_configs` にするか、将来の正本テーブルにするか決める

完了条件:

- GSC連携の親データが決まっている
- OAuth後のトークン保存方式が決まっている

### Phase 2: DBマイグレーション

- `gsc_tokens` を追加
- `gsc_property_statuses` を追加
- RLSを追加
- 必要なインデックスを追加

完了条件:

- Supabaseでマイグレーションが通る
- ログインユーザーが自分のGSC状態のみ参照できる
- Edge Functionからservice roleで更新できる

### Phase 3: OAuth連携

- `ConnectGscButton` をAIオートライター用に実装
- Supabase Google OAuthにSearch Consoleスコープを追加
- OAuth後にGSCトークンを保存する処理を追加
- refresh tokenがない場合は既存値を保持する

完了条件:

- Google認可画面が表示される
- `gsc_tokens` にaccess tokenとrefresh tokenが保存される
- 再連携時にrefresh tokenが消えない

### Phase 4: Edge Function実装

- 有効なGSCトークン取得、更新処理を実装
- GSCプロパティ一覧取得を実装
- WordPress URLとGSCプロパティの照合を実装
- Search Analytics API呼び出しを実装

完了条件:

- 登録済みWordPressサイトのGSCプロパティ確認ができる
- 日別データを取得できる
- クエリ別データを取得できる
- 401、403、404を適切に返せる

### Phase 5: UI実装

- WordPress設定一覧にGSC状態を追加
- 連携ボタンを追加
- GSCダッシュボードを追加
- 期間切り替えを追加
- 日別グラフを追加
- クエリ別テーブルを追加

完了条件:

- WordPress登録サイトごとにGSC状態が見える
- Search Consoleデータが画面に表示される
- ローディング、空状態、エラー状態が表示される

### Phase 6: 検証

- OAuth初回連携
- OAuth再連携
- refresh token更新
- GSCプロパティ一致
- URL Prefixプロパティ
- Domainプロパティ
- 権限なしサイト
- Search Console未登録サイト
- 7日、28日、90日の期間切り替え
- クエリテーブルのソート、絞り込み
- アカウントをまたいだデータ分離

完了条件:

- 通常系、権限なし、未連携、プロパティ未一致がすべて確認済み
- `npm run build` が通る
- 主要画面でブラウザ確認が済んでいる

## 将来拡張

### 記事生成への連携

Search Consoleデータから記事作成に使える入力を作る。

- クリックが伸びているクエリ
- 表示回数が多いがCTRが低いクエリ
- 平均掲載順位が8〜20位のクエリ
- 検索意図が近いクエリのクラスタリング

### リライト候補

Search Consoleのクエリと既存記事URLを紐づけて、リライト候補を出す。

- 対象URL
- 改善余地のあるクエリ
- 改善理由
- 推奨タイトル案
- 追加すべき見出し案

### 定期取得

API制限と表示速度を考慮して、Search Consoleデータを日次でキャッシュする。

- Supabase Cronまたは外部Cron
- Edge Functionで定期取得
- `gsc_daily_metrics`
- `gsc_query_metrics`

## リスク

### 高

- Google OAuth設定が不完全だとrefresh tokenが取得できない
- Search ConsoleプロパティURLとWordPress URLの形式違いで一致判定に失敗する
- 複数アカウント環境でGSCトークンや結果が混ざると重大な情報漏えいになる

### 中

- GSC APIのレスポンスが遅い場合、画面表示が重くなる
- トークン更新失敗時の再連携導線が弱いとユーザーが復旧できない
- `wordpress_configs` と `wp_configs` の二重管理が残っているため、親テーブル選定に注意が必要

### 低

- グラフやテーブルの表示崩れ
- GSCデータが存在しない新規サイトで空状態が続く

## 検証チェックリスト

- Google OAuthでSearch Console権限を許可できる
- `gsc_tokens` にトークンが保存される
- access token期限切れ時にrefresh tokenで更新される
- refresh tokenがない場合に再連携を促せる
- URL Prefixプロパティを検出できる
- Domainプロパティを検出できる
- 権限がないサイトでは403相当の説明を表示できる
- Search Console未登録サイトでは404相当の説明を表示できる
- 日別グラフが表示される
- クエリ別テーブルが表示される
- 期間切り替えが反映される
- アカウントAのGSCデータがアカウントBから見えない
- `npm run build` が成功する

## 推奨する最初の実装単位

最初のPRまたは作業単位は以下に絞る。

1. DBマイグレーション
2. GSCトークン保存
3. GSCプロパティ状態確認
4. WordPress設定一覧で状態表示

次の作業単位で以下を追加する。

1. Search Consoleダッシュボード
2. 日別グラフ
3. クエリ別テーブル
4. 期間切り替え

この順番にすると、認証と権限まわりを先に固められるため、後続のUI実装が安定する。

## Phase 1 調査結果と決定事項

調査日: 2026-05-21

### 確認した既存構造

AIオートライター側は、クライアントアカウント単位の分離に `account_id` を使っている。

主な関連ファイル:

- `src/store/useAuthStore.ts`
  - Supabase Authのログイン状態を管理
  - `profiles` から `account_id` と `role` を取得
  - `accounts` から利用制限やfeature flagsを取得
- `src/services/accountScope.ts`
  - 現在の `account_id` を取得する共通ヘルパー
- `src/services/supabaseSchedulerService.ts`
  - WordPress設定の保存、読み込み、削除を担当
  - `wordpress_configs` を主に読み書きしている
  - 互換用に `wp_configs` にも同期している
- `src/components/WordPressConfig/ConfigList.tsx`
  - WordPress設定一覧の表示コンポーネント
  - GSC状態表示を追加する第一候補
- `src/components/Settings.tsx`
  - 接続設定画面
  - WordPress設定、AI API、APIキー設定をまとめて表示している

### WordPress設定の親データ

Phase 1の結論として、GSC連携の親データは `wordpress_configs` にする。

理由:

- 現在の保存、読み込み、削除は `supabaseSchedulerService` で `wordpress_configs` を中心に動いている
- 予約投稿実行側も `wordpress_configs` をjoinしている
- `wp_configs` は互換同期先として残っているが、UIと実行系の主導は `wordpress_configs` である
- Phase 2以降のDB追加時に、`gsc_property_statuses.wordpress_config_id` で自然に紐づけられる

注意点:

- 既存ドキュメント `docs/wp-config-consolidation-plan.md` では `wp_configs` 正本化の計画がある
- ただし現時点でGSC機能を入れるなら、既存実装に合わせて `wordpress_configs` を親にした方が安全
- 将来 `wp_configs` へ正本移行する場合は、GSC関連テーブルの外部キーも移行対象に含める

### OAuthとトークン保存方針

Phase 1の結論として、Google OAuthはSupabase Authを使い、トークン保存は専用Edge Functionで行う。

方針:

- フロントの `ConnectGscButton` から `supabase.auth.signInWithOAuth` を呼ぶ
- OAuthオプションにSearch Consoleスコープを指定する
- OAuth完了後、Supabaseセッション内の `provider_token` と `provider_refresh_token` を取得する
- 取得したトークンを `gsc-token-save` Edge Functionへ送り、DBに保存する
- refresh tokenが返らない再連携時は、DB上の既存refresh tokenを保持する

必要スコープ:

```text
https://www.googleapis.com/auth/webmasters.readonly
```

OAuthオプション:

```ts
{
  provider: 'google',
  options: {
    scopes: 'https://www.googleapis.com/auth/webmasters.readonly',
    queryParams: {
      access_type: 'offline',
      prompt: 'consent',
    },
  },
}
```

注意点:

- SEO researcherはNext.jsの `/auth/callback` routeでトークン保存している
- AIオートライターはViteアプリなので、このrouteはそのまま使わない
- Edge Function化することで、Google Client Secretやトークン更新処理をブラウザに出さずに済む

### SEO researcherから移植する対象

移植する対象:

- `seo-researcher/lib/gsc.ts`
  - 有効トークン取得
  - トークン期限判定
  - refresh tokenによる更新
  - Search Consoleスコープ確認
- `seo-researcher/lib/gscSiteStatus.ts`
  - アクセス可能なGSCプロパティ一覧取得
  - URL Prefixプロパティ照合
  - Domainプロパティ照合
- `seo-researcher/app/actions/fetchGSCData.ts`
  - `dimensions: ['date']` のSearch Analytics取得ロジック
- `seo-researcher/app/actions/fetchGSCQueryData.ts`
  - `dimensions: ['query']` のSearch Analytics取得ロジック
- `seo-researcher/components/SearchConsoleChart.tsx`
  - グラフUIの構成参考
- `seo-researcher/components/SearchConsoleQueryTable.tsx`
  - クエリ別テーブルUIの構成参考

そのまま移植しない対象:

- Next.js App Router
- Server Actions
- `@supabase/ssr`
- shadcn/uiの個別コンポーネント群
- `seo-researcher` の `sites` テーブル
- SerpAPI順位取得
- Chatwork通知
- cronによる順位定期取得
- SEO researcherの独立ダッシュボード全体

### UI追加場所

Phase 1の結論として、最初のUI追加場所はWordPress設定一覧にする。

第一候補:

- `src/components/WordPressConfig/ConfigList.tsx`

追加するもの:

- GSC状態バッジ
- 一致したGSCプロパティURL
- 最終確認日時
- 「Search Console連携」ボタン
- 「状態を確認」ボタン

第二候補:

- `src/components/Settings.tsx`

使い方:

- 接続設定画面全体にSearch Consoleセクションを置く場合の補助導線
- MVPでは必須ではない

### Phase 2へ進む前の確定事項

Phase 2では以下の前提でDBマイグレーションを作る。

- 親データは `public.wordpress_configs`
- GSCトークン保存テーブルは `public.gsc_tokens`
- GSCプロパティ確認状態は `public.gsc_property_statuses`
- どちらも `account_id` を持たせる
- RLSは `account_id = public.current_profile_account_id()` を基本にする
- token系は `user_id = auth.uid()` も併用する
- Edge Functionはservice roleでトークン更新とGSC API呼び出しを行う

### Phase 1 完了条件の結果

- GSC連携の親データ: `wordpress_configs` に決定
- OAuth後のトークン保存方式: Supabase OAuth後にEdge Functionで保存する方式に決定
- SEO researcherからの移植範囲: GSCロジックとUI参考のみに限定
- MVP外の範囲: SerpAPI、Chatwork、順位定期取得、独立サイト管理は除外

Phase 1は完了。次はPhase 2としてDBマイグレーションを実装する。

## Phase 2 実装結果

実装日: 2026-05-21

追加したマイグレーション:

- `supabase/migrations/20260521090000_add_gsc_integration_tables.sql`

### 追加テーブル

#### public.gsc_tokens

Google Search Console連携用のOAuthトークンを保存する。

主なカラム:

- `user_id`
  - `auth.users(id)` への外部キー
  - 主キー
- `account_id`
  - `public.accounts(id)` への外部キー
  - アカウント分離用
- `provider_token`
  - Google OAuth access token
- `provider_refresh_token`
  - Google OAuth refresh token
  - Googleは初回同意時のみ返すことがあるためnullable
- `expires_at`
  - access tokenの有効期限
- `created_at`
- `updated_at`

追加インデックス:

- `idx_gsc_tokens_account_id`
- `idx_gsc_tokens_expires_at`

RLS:

- 管理者は全件管理可能
- 一般ユーザーは `user_id = auth.uid()` かつ `account_id = public.current_profile_account_id()` の行のみ参照、作成、更新、削除可能

#### public.gsc_property_statuses

WordPress設定ごとのSearch Consoleプロパティ確認状態を保存する。

主なカラム:

- `wordpress_config_id`
  - `public.wordpress_configs(id)` への外部キー
  - 主キー
- `account_id`
  - `public.accounts(id)` への外部キー
- `verified`
  - GSCプロパティと一致したかどうか
- `matched_property_url`
  - 一致したURL Prefixまたは `sc-domain:` プロパティ
- `checked_at`
  - 最終確認日時
- `error_code`
  - 未連携、権限不足、プロパティ未一致などの機械判定用
- `error_message`
  - 表示またはログ用の補足
- `created_at`
- `updated_at`

追加インデックス:

- `idx_gsc_property_statuses_account_id`
- `idx_gsc_property_statuses_verified`
- `idx_gsc_property_statuses_checked_at`

RLS:

- 管理者は全件管理可能
- クライアントは `account_id = public.current_profile_account_id()` の行のみ参照、作成、更新、削除可能

### Phase 2の設計メモ

- 親データはPhase 1の決定通り `public.wordpress_configs`
- `wp_configs` には今回GSC関連テーブルを紐づけない
- 両テーブルに `updated_at` 自動更新トリガーを追加
- Edge Functionはservice roleで実行される想定のため、RLSを迂回してトークン更新とGSC状態更新ができる
- クライアントから直接トークンテーブルを更新する設計も可能だが、Phase 3ではEdge Function経由を優先する

### Phase 2 完了条件の結果

- `gsc_tokens` を追加済み
- `gsc_property_statuses` を追加済み
- RLSを追加済み
- 必要なインデックスを追加済み
- 既存の `public.current_profile_account_id()` と `public.is_admin()` に合わせたポリシーへ統一済み

Phase 2は完了。次はPhase 3としてOAuth連携とトークン保存処理を実装する。

## Phase 3 実装結果

実装日: 2026-05-22

### 追加したEdge Function

追加ファイル:

- `supabase/functions/gsc-token-save/index.ts`

役割:

- OAuth後に取得したGoogle provider tokenを `public.gsc_tokens` へ保存する
- Authorization headerから現在のSupabaseユーザーを取得する
- `profiles` から `account_id` を取得する
- 既存refresh tokenがある場合、再連携時にrefresh tokenが返らなくても保持する
- `expires_at` を保存する

入力:

```json
{
  "provider_token": "...",
  "provider_refresh_token": "...",
  "expires_in": 3500
}
```

出力:

```json
{
  "saved": true,
  "expires_at": "...",
  "has_refresh_token": true
}
```

### 追加したフロントエンドサービス

追加ファイル:

- `src/services/searchConsoleService.ts`

役割:

- Google Search Console OAuthを開始する
- OAuthリダイレクト後かどうかを判定する
- Supabase sessionから `provider_token` と `provider_refresh_token` を取得する
- `gsc-token-save` Edge Functionを呼び出す
- OAuth処理後にURLの `gsc=connected` フラグを消す

重要な決定:

- OAuth開始は `supabase.auth.signInWithOAuth` ではなく `supabase.auth.linkIdentity` を使う
- 既存のメール/パスワードログインユーザーをGoogleログインで置き換えず、現在のユーザーにGoogle identityを連携するため

### 追加したUI

追加ファイル:

- `src/components/SearchConsole/ConnectGscButton.tsx`

変更ファイル:

- `src/components/WordPressConfig/ConfigList.tsx`

内容:

- WordPress設定カード内に「Search Console連携」ボタンを追加
- クリックするとGoogle Search Console連携OAuthを開始する
- Phase 4以降でGSC状態表示とプロパティ確認結果を同じ場所に追加する

### OAuthリダイレクト後の保存処理

変更ファイル:

- `src/App.tsx`

内容:

- `?gsc=connected` が付いたOAuthリダイレクトを検知する
- ログイン済みユーザーが存在する場合、現在のSupabase sessionからGoogle provider tokenを取り出す
- `gsc-token-save` Edge Functionに送信する
- 成功/失敗をtoastで表示する
- 処理後にURLから `gsc=connected` を削除する

### Phase 3の注意点

- Supabase DashboardでGoogle Providerを有効化し、Search Console scopeを追加する必要がある
- Edge Function `gsc-token-save` をSupabaseへdeployする必要がある
- 実際のOAuth疎通確認は、Supabase側のOAuth設定とFunction deploy後に行う
- refresh tokenはGoogleが初回同意時のみ返す場合があるため、再連携時は既存値を保持する

### 検証結果

ローカルで実施:

- `npx.cmd tsc -b`
  - 成功
- `npm.cmd run build`
  - 成功
  - Node 24環境のためビルドスクリプトがNode 22ランタイムを使う
  - chunk size warningは既存のVite警告であり、今回の実装によるビルド失敗ではない

未実施:

- SupabaseへのEdge Function deploy
- 実Google OAuth疎通
- `gsc_tokens` への実データ保存確認

Phase 3はローカル実装完了。次はSupabase Function deployとOAuth設定確認を行い、その後Phase 4としてGSCプロパティ確認とSearch Analytics API取得を実装する。

## Phase 3 設計変更: 管理会社GSCトークン方式

変更日: 2026-05-22

### 変更理由

当初のPhase 3では、Supabase Authの `linkIdentity` を使い、ログイン中のAIオートライターユーザーにGoogleアカウントを紐づける方式だった。

しかし運用上は、以下のようにAIオートライターのログインユーザーとSearch Consoleを管理するGoogleアカウントが異なる。

- AIオートライターログイン: クライアントまたは運用担当者のメールアドレス
- Search Console管理: 運用会社のGoogleアカウント

この場合、Google identityをSupabaseユーザーへ紐づける必要はない。むしろ、既存のSEO researcherなどで同じGoogle identityが別ユーザーに紐づいていると `identity_already_exists` が発生する。

そのため、GSC連携はSupabase identity linkingではなく、Search Console API用の独立OAuthとして扱う方針に変更する。

### 新しい方式

- 現在ログイン中のSupabaseユーザーを認証する
- Edge Function `gsc-oauth-start` が一時stateを発行する
- Google OAuthへリダイレクトする
- Edge Function `gsc-oauth-callback` が認可コードを受け取る
- Google token endpointでaccess token / refresh tokenへ交換する
- `public.gsc_tokens` に保存する
- アプリへ `?gsc=connected` 付きで戻す

この方式では、Googleアカウントが既にSEO researcher側のSupabase identityとして紐づいていても衝突しない。

### 追加したマイグレーション

- `supabase/migrations/20260522090000_add_gsc_oauth_states.sql`

追加テーブル:

- `public.gsc_oauth_states`

用途:

- Google OAuthの `state` を一時保存する
- stateと現在のSupabaseユーザーを紐づける
- callback時にCSRFと期限切れを確認する

主なカラム:

- `state`
- `user_id`
- `account_id`
- `redirect_to`
- `expires_at`
- `created_at`

### 追加したEdge Functions

#### gsc-oauth-start

追加ファイル:

- `supabase/functions/gsc-oauth-start/index.ts`

役割:

- ログイン中ユーザーをAuthorization headerで確認
- `profiles` から `account_id` を取得
- `gsc_oauth_states` にstateを保存
- Google OAuth認可URLを生成して返す

#### gsc-oauth-callback

追加ファイル:

- `supabase/functions/gsc-oauth-callback/index.ts`

役割:

- Google OAuth callbackを受ける
- stateを検証する
- 認可コードをGoogle token endpointで交換する
- Search Console scopeが含まれるか確認する
- `gsc_tokens` にトークンを保存する
- アプリへ戻す

### 変更したフロントエンド

変更ファイル:

- `src/services/searchConsoleService.ts`
- `src/App.tsx`
- `src/components/SearchConsole/ConnectGscButton.tsx`

変更内容:

- `supabase.auth.linkIdentity` を廃止
- `gsc-oauth-start` Functionを呼び出してGoogle認可URLを取得
- 取得したURLへ `window.location.assign` で遷移
- callback後の `?gsc=connected` / `?gsc_error=...` を検知してtoast表示

### Supabaseに必要なFunction secrets

以下をSupabase Function secretsとして設定する。

```text
GOOGLE_CLIENT_ID
GOOGLE_CLIENT_SECRET
APP_ORIGIN
```

`APP_ORIGIN` の例:

```text
https://ai-autowriter.netlify.app
```

ローカル検証時は `APP_ORIGIN` を本番URLにしていても、Function側では `localhost` / `127.0.0.1` へのredirectも許可している。

### Google Cloud側に追加するリダイレクトURI

従来のSupabase Auth callbackに加えて、以下をGoogle OAuthクライアントへ追加する。

```text
https://jozinzyaiudwxtyjflfm.supabase.co/functions/v1/gsc-oauth-callback
```

既存のURI:

```text
https://jozinzyaiudwxtyjflfm.supabase.co/auth/v1/callback
```

これはSEO researcher等の既存Supabase Auth連携用に残す。

### デプロイ対象

新たにdeployが必要:

```bash
supabase functions deploy gsc-oauth-start
supabase functions deploy gsc-oauth-callback
```

既存の `gsc-token-save` は旧方式のFunctionであり、新方式では使用しない。

### 検証結果

ローカルで実施:

- `npx.cmd tsc -b`
  - 成功
- `npm.cmd run build`
  - 成功

未実施:

- `20260522090000_add_gsc_oauth_states.sql` のSupabase適用
- `gsc-oauth-start` / `gsc-oauth-callback` のdeploy
- Function secrets設定
- 実Google OAuth疎通
