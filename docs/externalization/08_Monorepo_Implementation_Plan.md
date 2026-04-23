# AutomaticWriter Monorepo 化・親子構造実装計画

このドキュメントは、AutomaticWriter を「親アプリ + 子アプリ群」の構成で外販運用するための実装計画書です。  
目的は、共通機能を親側で保守しつつ、クライアントごとに個別設定を持つ複数の子アプリを Vercel 上で独立運用できるようにすることです。

---

## 1. 目的

### 1.1 実現したいこと

- 自社用の親アプリを保守し、共通機能修正を子アプリへ反映できるようにする
- クライアントごとに URL、ロゴ、文言、接続先、権限設定だけを分離する
- 新規契約時に、雛形から短時間でクライアント環境を作成できるようにする
- 各アプリを Vercel で個別にデプロイできるようにする

### 1.2 前提

- クライアントごとの完全独立コピーではなく、1つのリポジトリ内で複数アプリを管理する
- 共通機能は shared package としてまとめる
- クライアント個別差分は app ごとに限定する

---

## 2. 採用方針

### 2.1 構成方針

採用する構成は `monorepo + shared core + client template + Vercel複数プロジェクト` とする。

### 2.2 この構成を採用する理由

- 親アプリの修正を共通 package 側に寄せられる
- 子アプリは共通 package を参照するだけなので保守が崩れにくい
- 新規クライアント追加時に、テンプレート複製だけで初期構築しやすい
- Vercel 側では app ごとに別プロジェクト化できる

### 2.3 採用しない案

#### 完全コピー方式

- コピー直後から別物になる
- 親の修正が自動反映されない
- クライアント数が増えるほど改修漏れが発生する

#### ブランチだけで親子を表現する方式

- 共通部分と個別差分の境界が曖昧になる
- どの差分がクライアント固有か追いづらい
- 長期運用でマージコストが増える

---

## 3. 想定ディレクトリ構成

```text
AutomaticWriter/
  apps/
    master/
    client-template/
    clients/
      client-a/
      client-b/
  packages/
    core/
    ui/
    config/
  docs/
    externalization/
  package.json
  pnpm-workspace.yaml
```

### 3.1 apps 配下

- `apps/master`
  - 自社利用・親アプリ
- `apps/client-template`
  - 新規クライアント追加時の雛形
- `apps/clients/client-a`
  - クライアントA向けアプリ
- `apps/clients/client-b`
  - クライアントB向けアプリ

### 3.2 packages 配下

- `packages/core`
  - 記事生成、対話型生成、ファクトチェック、WordPress連携、スケジューラーなどの共通ロジック
- `packages/ui`
  - 共通コンポーネント、レイアウト、フォーム部品
- `packages/config`
  - 環境変数解決、deployment mode、機能フラグ、共通定数

---

## 4. 親子構造の責務分離

### 4.1 親側で持つもの

- 記事生成ロジック
- 対話型記事生成ロジック
- ファクトチェックロジック
- WordPress連携ロジック
- スケジューラー基盤
- 共通レイアウト
- 共通設定UI
- deployment mode 判定

### 4.2 子側で持つもの

- アプリ名
- ロゴ
- favicon
- カラー設定
- クライアント固有文言
- `.env` に依存する接続先
- クライアントごとの通知先
- 必要に応じた機能ON/OFF

### 4.3 子側に持たせないもの

- 記事生成コアのロジック差分
- ファクトチェック本体ロジック差分
- WordPress投稿基盤の独自改造

---

## 5. Vercel 運用方針

### 5.1 基本

Vercel プロジェクトは app ごとに分ける。

例:

- `automaticwriter-master`
- `automaticwriter-client-a`
- `automaticwriter-client-b`

### 5.2 Vercel のルート設定

各 Vercel プロジェクトでは、ルートディレクトリを個別に設定する。

例:

- 親: `apps/master`
- 子A: `apps/clients/client-a`
- 子B: `apps/clients/client-b`

### 5.3 環境変数

各 Vercel プロジェクトに個別の環境変数を設定する。

例:

- `VITE_DEPLOYMENT_MODE`
- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY`
- `VITE_ACCESS_PASSWORD`
- WordPress接続先
- 通知先設定

---

## 6. 新規クライアント追加フロー

### 6.1 作業手順

1. `apps/client-template` を `apps/clients/client-xxx` に複製
2. `client-xxx` 用のアプリ名、ロゴ、文言を変更
3. `.env` テンプレートをクライアント用に作成
4. 必要な Supabase / WordPress / 通知設定を投入
5. Vercel で新規プロジェクトを作成
6. ルートを `apps/clients/client-xxx` に設定
7. 環境変数を登録
8. 動作確認

### 6.2 将来的に自動化したいもの

- 雛形複製
- アプリ名差し替え
- package 名差し替え
- Vercel 設定補助
- `.env.example` の複製

---

## 7. 実装ステップ

### Step 1. 現状コードの共通部と個別部を切り分ける

対象:

- `src/components`
- `src/services`
- `src/hooks`
- `src/shared`
- `src/config`

作業:

- 親子で共通利用するものを洗い出す
- クライアント固有になるものを洗い出す
- import 依存の強い箇所を把握する

### Step 2. monorepo 基盤を作る

作業:

- `apps/` と `packages/` を作る
- workspace 設定を追加する
- 共通 tsconfig を整理する
- build / dev / lint の実行単位を app ごとに持てるようにする

### Step 3. 共通 package を切り出す

優先順:

1. `packages/core`
2. `packages/config`
3. `packages/ui`

### Step 4. 親アプリを `apps/master` へ移す

作業:

- 既存アプリを親アプリとして成立させる
- import を package 参照に置き換える
- build が通る状態にする

### Step 5. テンプレートアプリを作る

作業:

- `apps/client-template` を作る
- 変更可能な箇所を明確にする
- 直接編集してよいファイルを限定する

### Step 6. 子アプリを1つ作って実証する

作業:

- `apps/clients/client-a` を作る
- Vercel で個別デプロイする
- 親側修正が子へ反映されることを確認する

---

## 8. 実装時の注意点

### 8.1 共通 code に client 固有値を埋め込まない

ロゴ、URL、名称、通知先などは package に直接書かない。  
必ず app 側または env 側から渡す。

### 8.2 Supabase の分離方針を先に決める

選択肢:

- 全クライアント共通 Supabase + tenant 分離
- クライアントごとに Supabase 分離

後者の方が事故影響は小さいが、管理コストは上がる。

### 8.3 設定値で吸収できる範囲を広げる

コード差分ではなく設定差分で運用できるほど、外販後の保守が楽になる。

### 8.4 package の責務を広げすぎない

`core` に UI まで全部入れると再利用しにくい。  
ロジックと UI はなるべく分ける。

---

## 9. リスク

### 9.1 既存コードの import 依存が強い

影響:

- 切り出し時に広範囲修正が必要になる

対応:

- まず `config` と `shared` から切り出す
- 一気に全部やらず段階移行する

### 9.2 クライアント固有要望が増えすぎる

影響:

- 子アプリ差分が増え、共通化の意味が薄れる

対応:

- 設定で吸収する
- 個別実装の許可ラインを決める

### 9.3 Vercel 設定漏れ

影響:

- app 単位で起動失敗

対応:

- クライアント追加用チェックリストを固定化する

---

## 10. 完了条件

- [ ] 親アプリが `apps/master` で起動する
- [ ] 共通ロジックが `packages/core` に移される
- [ ] `apps/client-template` が作成される
- [ ] 少なくとも1つの子アプリが作成される
- [ ] 親の共通修正が子アプリに反映される
- [ ] app ごとに Vercel デプロイできる
- [ ] 新規クライアント追加手順が文書化される

---

## 11. 推奨する次アクション

1. 現状コードを共通部 / 個別部に分類する
2. monorepo 移行用の設計メモを作る
3. 最小構成で `apps/master` と `packages/config` だけ先に切る
4. build が通ったら `packages/core` へ広げる
5. その後 `client-template` を作る
