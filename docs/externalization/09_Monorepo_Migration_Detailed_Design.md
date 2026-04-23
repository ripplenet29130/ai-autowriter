# AutomaticWriter Monorepo 移行詳細設計

このドキュメントは、`08_Monorepo_Implementation_Plan.md` を実装に落とすための詳細設計書です。  
対象は「今のリポジトリをどう分割するか」「どこから着手するか」「最初の1回をどう安全に移行するか」です。

---

## 1. 現在の構成の整理

現在のコードは概ね次の責務に分かれています。

- `src/components`
  - UI
- `src/hooks`
  - 画面ロジック
- `src/services`
  - API / DB / 外部連携
- `src/shared`
  - 共通生成ロジック
- `src/config`
  - 環境依存の設定
- `src/types`
  - 型定義
- `src/store`
  - Zustand state
- `src/utils`
  - 汎用処理

この構成は単一アプリとしては自然ですが、親子アプリ化するには「共通化できるもの」と「アプリ固有のもの」を明確に分離する必要があります。

---

## 2. 切り出し方針

### 2.1 最初に package 化する対象

最初に切り出すのは、依存が比較的読みやすく、親子共通化の効果が高いものです。

#### 優先度A

- `src/config`
- `src/types`
- `src/utils`
- `src/shared`

#### 優先度B

- `src/services`

#### 優先度C

- `src/components` のうち共通UI
- `src/hooks`
- `src/store`

### 2.2 最初は package 化しないもの

- クライアント固有ロゴ
- クライアント固有文言
- アプリごとの入口コンポーネント
- Vercel 向け app root

---

## 3. 推奨 workspace 構成

```text
AutomaticWriter/
  apps/
    master/
      src/
      package.json
      vite.config.ts
      index.html
    client-template/
      src/
      package.json
      vite.config.ts
      index.html
    clients/
      client-a/
        src/
        package.json
        vite.config.ts
        index.html
  packages/
    config/
      src/
      package.json
    types/
      src/
      package.json
    utils/
      src/
      package.json
    core/
      src/
      package.json
    ui/
      src/
      package.json
  package.json
  pnpm-workspace.yaml
  tsconfig.base.json
```

---

## 4. package ごとの責務

### 4.1 `packages/config`

責務:

- deployment mode
- 環境変数の解決
- feature flag
- 共通設定値

今の移行候補:

- `src/config/apiConfig.ts`

### 4.2 `packages/types`

責務:

- 共通 TypeScript 型

今の移行候補:

- `src/types/index.ts`
- `src/types/factCheck.ts`
- `src/types/errors.ts`
- `src/types/guards.ts`

### 4.3 `packages/utils`

責務:

- markdown 整形
- logger
- error handling
- 汎用 helper

今の移行候補:

- `src/utils/errorHandler.ts`
- `src/utils/logger.ts`
- `src/utils/markdownToHtml.ts`
- `src/utils/supabaseHelpers.ts`

### 4.4 `packages/core`

責務:

- 記事生成ロジック
- ファクトチェック
- WordPress連携基盤
- スケジューラー基盤
- AI呼び出し基盤
- shared generation core

今の移行候補:

- `src/services/aiService.ts`
- `src/services/factCheckService.ts`
- `src/services/multiStepGenerationService.ts`
- `src/services/outlineGenerationService.ts`
- `src/services/wordPressService.ts`
- `src/services/scheduleService.ts`
- `src/shared/articleGenerationCore.ts`
- `src/shared/sectionGenerationPrompt.ts`
- `src/shared/multiStepPromptTemplates.ts`

### 4.5 `packages/ui`

責務:

- 共通レイアウト
- ボタン、入力欄、モーダルなど共通 UI
- 複数 app で使い回す機能UI

今の移行候補:

- `src/components/Layout.tsx`
- `src/components/FactCheckResultsDisplay.tsx`
- `src/components/WordPressConfig/*`
- 将来的な共通フォーム部品

---

## 5. apps 側に残すもの

### 5.1 `apps/master`

残すもの:

- 自社向け `App.tsx`
- 自社向けナビゲーション構成
- 自社専用文言
- 自社専用 `.env`

### 5.2 `apps/client-template`

残すもの:

- クライアント向け雛形 `App.tsx`
- クライアント向け最小構成 UI
- ロゴ差し替え箇所
- 文言差し替え箇所

### 5.3 `apps/clients/client-a`

残すもの:

- クライアントAのロゴ
- カラー
- クライアントA向け名称
- 必要なら独自文言

---

## 6. package.json 設計方針

### 6.1 ルート `package.json`

役割:

- workspace 管理
- 共通 scripts
- 開発依存の統一

想定:

```json
{
  "private": true,
  "workspaces": [
    "apps/*",
    "apps/clients/*",
    "packages/*"
  ],
  "scripts": {
    "dev:master": "pnpm --filter master dev",
    "build:master": "pnpm --filter master build",
    "build:all": "pnpm -r build",
    "typecheck": "pnpm -r typecheck"
  }
}
```

### 6.2 app 側 `package.json`

役割:

- Vite app としての起動
- package 参照

例:

```json
{
  "name": "master",
  "private": true,
  "dependencies": {
    "@aw/config": "workspace:*",
    "@aw/core": "workspace:*",
    "@aw/types": "workspace:*",
    "@aw/ui": "workspace:*",
    "@aw/utils": "workspace:*"
  }
}
```

### 6.3 package 側 `package.json`

例:

```json
{
  "name": "@aw/core",
  "version": "0.0.0",
  "main": "src/index.ts",
  "types": "src/index.ts"
}
```

---

## 7. 初回移行の最小スコープ

最初から全部移すと壊しやすいので、初回は以下に限定します。

### Phase 1

- `packages/config`
- `packages/types`
- `packages/utils`
- `apps/master`

### Phase 2

- `packages/core` のうち `shared` と `factCheck`

### Phase 3

- 記事生成関連 service
- WordPress 関連 service

### Phase 4

- `packages/ui`
- `apps/client-template`

### Phase 5

- `apps/clients/client-a` 実証

---

## 8. 最初の移行手順

### Step 1. ルート設定追加

作業:

- `pnpm-workspace.yaml` を追加
- `tsconfig.base.json` を追加
- ルート `package.json` に workspace script を追加

### Step 2. `packages/types` 作成

作業:

- `src/types/*` を移す
- 既存 import を `@aw/types` に置換

完了条件:

- 既存アプリで型解決が通る

### Step 3. `packages/config` 作成

作業:

- `src/config/apiConfig.ts` を移す
- feature flag や deployment mode をここへ集約

完了条件:

- app から `@aw/config` を使って起動できる

### Step 4. `packages/utils` 作成

作業:

- utils を移す
- 相対 import を package import に置換

### Step 5. `apps/master` 作成

作業:

- 既存の app 一式を `apps/master` に移す
- ルート起動ではなく `apps/master` 起動へ変更

完了条件:

- `apps/master` 単体で `dev` と `build` が通る

---

## 9. import 置換方針

### 9.1 例

変更前:

```ts
import { API_CONFIG } from '../config/apiConfig';
import type { Article } from '../types';
```

変更後:

```ts
import { API_CONFIG } from '@aw/config';
import type { Article } from '@aw/types';
```

### 9.2 注意

- 一度に全ファイル置換しない
- package 単位で段階的に変える
- build と typecheck を毎段階で通す

---

## 10. `client-template` の作り方

### 10.1 目的

新規クライアント追加時に、毎回コードを手作業で複製しないための雛形を作る。

### 10.2 テンプレートに含めるもの

- 最小限の `App.tsx`
- クライアント名設定ファイル
- ロゴ格納場所
- カラー定義ファイル
- `.env.example`

### 10.3 テンプレートに含めないもの

- クライアント固有の秘密情報
- 独自運用ルール
- 個別カスタムコード

---

## 11. Vercel 設定の具体化

### 11.1 master

- Root Directory: `apps/master`
- Build Command: app 側の build
- Environment Variables: 自社用

### 11.2 client

- Root Directory: `apps/clients/client-a`
- Build Command: app 側の build
- Environment Variables: クライアント用

### 11.3 確認項目

- app ごとに別 URL で起動する
- ルートディレクトリが誤っていない
- env の入れ忘れがない

---

## 12. 新規クライアント追加用スクリプトの構想

将来的には以下のような script を用意する。

例:

```bash
pnpm create-client client-c
```

実行内容:

1. `apps/client-template` をコピー
2. `apps/clients/client-c` を作成
3. app 名、表示名を置換
4. `.env.example` を配置

---

## 13. 残課題

- Zustand store をどこまで package 化するか
- Supabase client を共通化するか app 側に残すか
- クライアントごとの DB 分離方式
- 共通 UI の境界
- デプロイ時の build crash 解消

---

## 14. 直近の実行順

1. `packages/types` を切る
2. `packages/config` を切る
3. `packages/utils` を切る
4. `apps/master` を成立させる
5. build を安定化する
6. `packages/core` の一部を切る
7. `client-template` を作る
8. `client-a` を作って Vercel 実証する
