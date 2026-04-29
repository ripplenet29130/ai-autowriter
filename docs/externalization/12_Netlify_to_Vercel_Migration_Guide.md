# AutomaticWriter Netlify から Vercel への移行手順

この手順書は、現在 Netlify で公開している AutomaticWriter を Vercel に移行するための実行順ガイドです。  
このリポジトリの現状実装を前提にしています。

---

## 1. 目的

- ホスティング先を Netlify から Vercel に切り替える
- 既存の build / Supabase / WordPress 連携を壊さずに移行する
- 将来の `master` / `client-*` 分離運用に備える

---

## 2. 事前確認

移行前に、以下を満たしていることを確認する。

1. ローカルで `npm run build` が通る
2. `.env` の必要値が洗い出せている
3. Supabase の管理権限にアクセスできる
4. 独自ドメインを使っている場合は DNS を変更できる
5. WordPress 接続先の情報を確認できる

現時点の build コマンド:

```bash
npm run build
```

出力先:

```text
build/
```

---

## 3. 移行前に洗い出す設定

少なくとも以下を確認する。

### `.env` / Environment Variables

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY`
- `VITE_DEPLOYMENT_MODE`
- `VITE_ACCESS_PASSWORD` を使う場合はその値
- Google / SerpAPI 系の各種キー

### DB / 管理画面側

- WordPress 設定
- Chatwork API Token
- Chatwork 通知先
- ファクトチェック設定

### 外部サービス側

- Supabase の Site URL
- Supabase の Redirect URLs
- 独自ドメインの DNS

---

## 4. Vercel 側で新規プロジェクトを作る

1. Vercel にログインする
2. `New Project` を選ぶ
3. GitHub リポジトリ `AutomaticWriter-main` を選ぶ
4. Framework は Vite として認識されるか確認する
5. Root Directory は現時点ではリポジトリ直下にする
6. Build Command を確認する
7. Output Directory を確認する

このプロジェクトの推奨値:

- Build Command: `npm run build`
- Output Directory: `build`
- Install Command: `npm install`

補足:

- `package.json` はすでに `build` を `tsc -b && node scripts/build-vite.mjs` にしている
- Node 24 環境でも build が通るようフォールバック済み

---

## 5. Vercel に環境変数を登録する

Vercel の Project Settings -> Environment Variables で登録する。

最低限必要なもの:

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY`
- `VITE_DEPLOYMENT_MODE`

必要に応じて登録するもの:

- `VITE_ACCESS_PASSWORD`
- `VITE_GOOGLE_TRENDS_API_KEY`
- `VITE_GOOGLE_CUSTOM_SEARCH_API_KEY`
- `VITE_GOOGLE_CUSTOM_SEARCH_ENGINE_ID`
- `VITE_SERPAPI_KEY`

推奨設定例:

### 内部用親アプリ

```env
VITE_DEPLOYMENT_MODE=internal
```

### クライアント用アプリ

```env
VITE_DEPLOYMENT_MODE=client
```

注意:

- `VITE_` 付き変数はフロントエンドに埋め込まれる
- 強い認証用途の秘密情報は Vite の public env に入れない

---

## 6. 初回デプロイを確認する

1. Vercel で初回デプロイを実行する
2. build が成功することを確認する
3. 生成された Preview URL にアクセスする
4. 画面が開くことを確認する
5. コンソールエラーが致命的でないことを確認する

最低限の確認項目:

- 画面が表示される
- 記事一覧が開く
- WordPress 設定画面が開く
- FactCheckSettings が開く
- client モードならファクトチェック UI 制御が効く

---

## 7. Supabase 側の許可 URL を更新する

Supabase を使っているため、Vercel URL を反映する。

確認するもの:

- Site URL
- Redirect URLs
- 認証に使っている callback URL

作業:

1. Supabase Dashboard に入る
2. Authentication -> URL Configuration を開く
3. Vercel の本番 URL を追加する
4. Preview URL を許可するなら追加する

独自ドメインに切り替える予定なら、最終的には独自ドメイン URL に更新する。

---

## 8. 独自ドメインを切り替える

独自ドメイン運用の場合のみ実施する。

1. Vercel の Domains に独自ドメインを追加する
2. 指示に従って DNS を変更する
3. 反映を待つ
4. SSL が有効になることを確認する

注意:

- いきなり本番切替せず、まず Vercel の付与ドメインで事前確認するのが安全
- DNS 変更前に Netlify 側のロールバック手順も用意しておく

---

## 9. 切替後の動作確認

最低限、以下を確認する。

1. トップ画面が開く
2. `npm run build` 相当のデプロイが安定している
3. Supabase に接続できる
4. WordPress 設定画面が動く
5. 記事生成が動く
6. client モードなら自動ファクトチェックが有効
7. WordPress 下書き保存ができる

---

## 10. ロールバック方針

問題が出た場合は、以下で戻せるようにしておく。

1. DNS を Netlify 側へ戻す
2. Supabase の Site URL / Redirect URLs を旧 URL に戻す
3. Vercel 側の本番公開を停止する

切替日は、ロールバック可能な時間帯に実施する。

---

## 11. このプロジェクトでの注意点

- build は通るが、chunk size 警告はまだ残っている
- `VITE_DEPLOYMENT_MODE` は未設定でも `client` 扱いになる
- そのため、親アプリを Vercel に出す場合は `internal` を明示設定した方がよい
- 将来 `apps/master` / `apps/client-*` に分けた後は、Vercel プロジェクトも app 単位で分ける

---

## 12. 完了条件

- [ ] Vercel で build 成功
- [ ] Preview URL で動作確認
- [ ] Supabase URL 設定更新
- [ ] 独自ドメイン切替完了
- [ ] 切替後の最低限動作確認完了
