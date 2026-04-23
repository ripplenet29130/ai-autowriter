# AutomaticWriter 改修・外販化計画書

## 1. 概要
本ドキュメントは、現在自社運用している「AutomaticWriter」を将来的にシステム販売（外販）することを見据え、システムの安定性、信頼性、およびユーザー体験（UX）を向上させるための改修計画をまとめたものである。

---

## 2. 重点改修項目

### 2.1 記事生成品質の改善（見出し保持の強化）
*   **現状の課題**: 
    AI記事生成の「対話モード」において、最終的な構成（アウトライン）を作る段階でユーザーが新しい見出しを追加しても、その後の執筆工程でその見出しが無視され、記事本文に反映されない場合がある。
*   **解決方針**: 
    構成案の確定フェーズで動的に追加された見出しデータを、確実に執筆エンジンの入力パラメータに同期させる。また、後処理（推敲・整形ロジック）において見出しが欠落しないよう、プロンプトの制約を強化する。

### 2.2 ファクトチェック機能の高度化と強制化
*   **現状の課題**: 
    現在はファクトチェックの有無をユーザーが選択可能で、チェック対象も一部に限定されている。
*   **解決方針（外販モデル）**: 
    1.  **機能の組み込み**: クライアント向け販売モデルでは、ファクトチェック機能を「オフにできない標準機能」としてシステムに統合する。
    2.  **全文検証**: 記事の一部のセンテンスだけでなく、最初から最後まで全文を網羅的に検証し、情報の正確性を担保する。

### 2.3 管理者通知システム（Chatwork連携）
*   **現状の課題**: 
    ファクトチェック結果や異常通知の送信先が柔軟に変更できない。
*   **解決方針**: 
    管理者通知用のChatworkルームIDを設定画面（UI）から直接指定・変更できるようにする。これにより、複数のクライアント環境からの通知を特定の管理用ルームへ集約することを容易にする。

---

## 3. UI/UXおよび利便性の向上

### 3.1 メニューおよび設定構成の再整理
*   **目的**: 
    初めてシステムを触る「他者」が、マニュアルなしでも直感的に操作できるようにする。
*   **改善案**: 
    - 初期設定（APIキー、WordPress連携）から運用（スケジュール作成、記事生成）までの流れに沿ってメニュー順を整理。
    - 設定項目に補助説明（ツールチップ）を追加し、各項目の役割を明確化。

### 3.2 クライアント用アクセス制限（パスワード機能）
*   **目的**: 
    提供先（子サイト）ごとに異なるアクセス制限を設け、セキュリティを確保する。
*   **実装計画**: 
    各環境ごとに独自のアクセスパスワードを設定できる仕組みを導入。サイト訪問時にパスワード要求画面（ゲートページ）を表示する簡易認証機能を実装する。

---

## 4. アーキテクチャおよび運用

### 4.1 親子関係モデルによる配布とメンテナンス
*   **コンセプト**: 
    親サイト（マスター）のコードを修正すれば、すべての子サイト（配布先）にも修正が反映される仕組み。
*   **方式**: 
    Gitのブランチ管理や共通のコアライブラリ参照、あるいは環境変数による挙動の切り替えを検討し、一括アップデートが可能なデプロイフローを確立する。
*   **テスト環境**: 
    実際に親子関係を持つテスト用サイトを1組構築し、配布プロセスと動作を検証する。

### 4.2 補助金対応および資料の整合性
*   **対応内容**: 
    補助金申請用資料（`docs/AutomaticWriter_Subsidy_Specification.md`）から、現状利用していない「画像生成API検索」に関する記述を削除し、実態に即した内容に修正済み。

---

## 5. 今後のステップ
1.  設計詳細の確定（本ドキュメントの承認）
2.  各項目の実装（開発者への依頼）
3.  テスト環境での検証（親子関係のテスト含む）
4.  正式リリース・配布開始

---

## 6. 詳細仕様書および実装計画

> 本セクションは2026年4月時点のコードベースを精査した上で作成した、各改修項目の具体的な実装指針である。

---

### 6.1 見出し保持の強化（アウトライン→執筆エンジンの同期）

#### 現状の技術的問題点

- `useMultiStepGeneration.ts` の `executeStep4` は呼び出し時点の `outline` オブジェクト（`ArticleOutline`）をそのまま `generateArticleFromOutlineWithSharedCore` に渡す。
- `OutlineEditorStep.tsx` でユーザーが「新しい見出しを追加」した場合、`onAddSection` コールバックが呼ばれ Zustand の `state.outline.sections` は更新される。
- しかし `executeStep4` の呼び出しタイミングで React の `state` が古い参照を持っているケースがある（クロージャ問題）。
- 加えて `multiStepGenerationService.ts` 内の `ensureFinalSummarySection` が「まとめ」セクションを上書き挿入する際に、ユーザーが追加した末尾セクションを意図せず削除・移動させることがある。

#### 実装方針

**ファイル:** `src/hooks/useMultiStepGeneration.ts`

`executeStep4` の引数として受け取る `outline` を内部 state から再取得するのではなく、呼び出し側（`ContentGenerationStep.tsx` または `MultiStepGenerator/index.tsx`）が明示的に最新の `outline` を渡す形に統一する。

```typescript
// 修正前（イメージ）
const executeStep4 = useCallback(async (outline: ArticleOutline, options?) => {
  // outline が古い参照になりうる
}, []);

// 修正後
const executeStep4 = useCallback(async (outline: ArticleOutline, options?) => {
  // 呼び出し元が state.outline を直接渡す責務を持つ
  // フック内では state.outline を参照しない
}, []); // 依存配列から state を除去可能
```

**ファイル:** `src/services/multiStepGenerationService.ts`

`ensureFinalSummarySection` がユーザー追加セクション（`isGenerated: false`）を削除しないよう条件を追加する。

```typescript
// 修正方針
private ensureFinalSummarySection(outline: ArticleOutline): ArticleOutline {
  const sections = [...outline.sections];
  // ユーザーが明示追加したセクション（isGenerated === false）は
  // 「まとめ」自動挿入ロジックの対象外とする
  const userAddedNonSummary = sections.filter(
    s => !s.isGenerated && !this.isSummaryTitle(s.title)
  );
  // ... 既存ロジック継続
}
```

**ファイル:** `src/shared/sectionGenerationPrompt.ts` / `src/shared/multiStepPromptTemplates.ts`

執筆プロンプト内に「提供された見出しリストをすべて使用すること。見出しの追加・削除・統合は一切行わないこと」という制約文を明示的に挿入する。

```
【厳守事項】
- 以下のアウトラインに記載されたすべての見出し（H2/H3/H4）を必ず使用し、省略・統合・新規追加を行わないこと
- 見出し順序もアウトライン通りに維持すること
```

#### 実装工数目安
- `useMultiStepGeneration.ts` の修正: **0.5日**
- `multiStepGenerationService.ts` の修正: **0.5日**
- プロンプト修正 + 動作確認: **1日**
- **小計: 2日**

---

### 6.2 ファクトチェック機能の高度化と強制化

#### 現状の技術的問題点

- `FactCheckSettings.tsx` に `enabled` トグルがあり、ユーザーが無効化できる。
- `factCheckService.ts` の `extractFacts` は段落ごとに最大3件しか抽出せず、`max_items_to_check`（デフォルト10件）でさらに上限が絞られる。結果として長文記事では後半の事実が未検証のまま残る。
- 外販モデルでは「ファクトチェックをオフにできる」ことがリスクになる。

#### 実装方針

**A. 強制有効化（外販モード）**

`src/config/apiConfig.ts` または `.env` に外販フラグを追加する。

```
VITE_DEPLOYMENT_MODE=client   # "client" | "internal"
```

`FactCheckSettings.tsx` でこのフラグを参照し、`client` モードでは `enabled` トグルを非表示にして常に `true` として扱う。

```tsx
const isClientMode = import.meta.env.VITE_DEPLOYMENT_MODE === 'client';

// enabled トグルの表示制御
{!isClientMode && (
  <Toggle label="ファクトチェックを有効にする" ... />
)}
```

**B. 全文網羅検証**

`factCheckService.ts` の `extractFacts` を以下のように変更する。

| 変更点 | 現状 | 改修後 |
|--------|------|--------|
| 段落あたり上限 | 最大3件 | 制限なし（スコア2以上を全採用） |
| `max_items_to_check` デフォルト | 10件 | 50件（外販モード時は無制限） |
| バッチサイズ | 5件 | 10件（Perplexity APIのレート内で最大化） |
| APIウェイト | 1200ms | 800ms（`sonar-pro` 使用時は500ms） |

**C. 全文検証プロセスの実装**

現状はユーザーが手動でファクトチェックを実行する。外販モードでは記事生成完了後に自動で実行されるパイプラインを追加する。

```
記事本文生成完了
  → factCheckService.extractFacts(fullContent)  // 全文を対象
  → factCheckService.verifyFacts(allItems)       // 全件を検証
  → 問題ありの場合: factCheckService.applyFactCheckFixes()
  → 修正済み本文を記事データに反映
  → Chatwork通知（6.3参照）
```

**実装ファイル:**
- `src/services/factCheckService.ts`: `extractFacts` の上限撤廃、外販モード判定
- `src/components/FactCheckSettings.tsx`: 外販モードでのトグル非表示
- `src/components/MultiStepGenerator/ContentGenerationStep.tsx`: 自動実行フロー追加

#### 実装工数目安
- `factCheckService.ts` の上限撤廃とモード分岐: **1日**
- 自動実行パイプラインの組み込み: **1日**
- `FactCheckSettings.tsx` の外販モード対応: **0.5日**
- **小計: 2.5日**

---

### 6.3 管理者通知システム（Chatwork連携）

#### 実装方針

**A. Supabaseテーブルへの設定項目追加**

既存の `app_settings` テーブルに以下のキーを追加する（マイグレーション不要、単純なupsert）。

| key | 説明 | 例 |
|-----|------|-----|
| `chatwork_api_token` | Chatwork APIトークン | `xxxxx` |
| `chatwork_room_id` | 通知先ルームID | `123456789` |
| `chatwork_notify_on_fact_issue` | 事実誤認検出時に通知 | `true` |
| `chatwork_notify_on_publish` | 記事公開時に通知 | `false` |

**B. 通知サービスの新規作成**

`src/services/chatworkService.ts` を新規作成する。

```typescript
export const chatworkService = {
  async sendMessage(message: string): Promise<void> {
    const settings = await getChatworkSettings(); // app_settings から取得
    if (!settings.apiToken || !settings.roomId) return;

    await fetch(`https://api.chatwork.com/v2/rooms/${settings.roomId}/messages`, {
      method: 'POST',
      headers: {
        'X-ChatWorkToken': settings.apiToken,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: `body=${encodeURIComponent(message)}`,
    });
  },

  async notifyFactCheckIssue(keyword: string, issueCount: number, articleTitle: string): Promise<void> {
    const msg = `[info][title]ファクトチェック警告[/title]記事「${articleTitle}」（キーワード: ${keyword}）で${issueCount}件の要確認事項が検出されました。\n管理画面で内容を確認してください。[/info]`;
    await this.sendMessage(msg);
  },
};
```

**C. 設定UIの追加**

`src/components/Settings.tsx` に「通知設定」セクションを追加し、以下のフィールドを設ける。
- Chatwork APIトークン（パスワード入力型）
- 通知先ルームID（テキスト入力）
- 通知トリガーのチェックボックス（ファクトチェック警告時 / 記事公開時）
- 「テスト送信」ボタン

**実装ファイル:**
- `src/services/chatworkService.ts`: 新規作成
- `src/components/Settings.tsx`: 通知設定セクション追加
- `src/services/factCheckService.ts`: 検証後に `chatworkService.notifyFactCheckIssue()` を呼び出す

#### 実装工数目安
- `chatworkService.ts` の新規作成: **0.5日**
- Settings UIの追加: **1日**
- factCheckServiceへの組み込み: **0.5日**
- **小計: 2日**

---

### 6.4 メニューおよび設定構成の再整理

#### 現状

`Layout.tsx` のナビゲーション順序（現状）:
1. ダッシュボード
2. AI記事生成
3. 記事一覧
4. スケジューラー
5. キーワード設定
6. タイトルリスト設定
7. WordPress設定
8. AI設定
9. 設定

#### 改善案：ワークフロー順への再配置

初期設定フェーズと運用フェーズを視覚的に分離する。

```
【初期設定グループ】
  - WordPress設定     ← まずここから始める
  - AI設定            ← APIキーの設定
  - キーワード設定
  - タイトルリスト設定

【運用グループ】
  - AI記事生成        ← 日常業務のメイン
  - スケジューラー
  - 記事一覧

【管理グループ】
  - ダッシュボード
  - 設定（システム全般）
```

**実装ファイル:** `src/components/Layout.tsx`

`navigationItems` 配列の順序変更とグループラベルの追加（`<li>` の区切り見出しとして `text-xs text-gray-400` スタイルで実装）。

#### ツールチップ追加

各ナビゲーション項目に `title` 属性は既にあるが、設定画面の各入力フィールドに補助テキストを追加する。例：

- WordPress REST API URL: 「例: https://your-site.com/wp-json/wp/v2」
- APIキー: 「OpenAI Dashboardで発行したsecret keyを入力してください」

**実装工数目安: 1日**

---

### 6.5 クライアント用アクセス制限（パスワードゲート機能）

#### 実装方針

**A. 環境変数によるパスワード設定**

`.env.local` にアクセスパスワードを設定する。

```
VITE_ACCESS_PASSWORD=your-secret-password
```

パスワードが未設定の場合はゲートを表示しない（内部利用モードとして扱う）。

**B. ゲートコンポーネントの新規作成**

`src/components/PasswordGate.tsx` を新規作成する。

```tsx
export const PasswordGate: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const requiredPassword = import.meta.env.VITE_ACCESS_PASSWORD;
  const [isUnlocked, setIsUnlocked] = useState(false);
  const [input, setInput] = useState('');
  const [error, setError] = useState(false);

  useEffect(() => {
    // セッション中は認証状態を保持
    const stored = sessionStorage.getItem('aw_auth');
    if (stored === 'true') setIsUnlocked(true);
  }, []);

  if (!requiredPassword || isUnlocked) return <>{children}</>;

  const handleSubmit = () => {
    if (input === requiredPassword) {
      sessionStorage.setItem('aw_auth', 'true');
      setIsUnlocked(true);
    } else {
      setError(true);
    }
  };

  return (
    // シンプルなログイン画面UI
    <div className="min-h-screen flex items-center justify-center bg-gray-50">
      ...
    </div>
  );
};
```

**C. `App.tsx` への組み込み**

```tsx
// App.tsx
<PasswordGate>
  <Layout>
    ...
  </Layout>
</PasswordGate>
```

**セキュリティ上の注意点:**  
`VITE_` プレフィックスの環境変数はビルド時にバンドルに埋め込まれるため、リバースエンジニアリングで解読可能である。外販クライアント向けには、このパスワードゲートを「操作ミスによる誤アクセス防止」と位置づけ、真のアクセス制御はSupabaseのRLS（Row Level Security）またはCloudflare Accessのような外部ソリューションで補完する。

**実装ファイル:**
- `src/components/PasswordGate.tsx`: 新規作成
- `src/App.tsx`: `PasswordGate` でラップ

**実装工数目安: 1日**

---

### 6.6 親子関係モデルによる配布とメンテナンス

#### 実装方針

**A. Gitブランチ戦略**

```
main（親・マスターブランチ）
  ├── client/company-a（クライアントAのカスタマイズ）
  ├── client/company-b（クライアントBのカスタマイズ）
  └── client/company-c
```

- コア機能の修正は `main` にコミットし、`git merge main` で各クライアントブランチに取り込む。
- クライアント固有の設定（パスワード、WordPress URL、Chatwork設定）は `.env.local`（gitignore対象）で管理し、ブランチに含めない。

**B. クライアント固有の設定テンプレート**

`.env.example` を整備し、クライアントへの納品時に記載すべき項目を明示する。

```
# クライアント設定テンプレート
VITE_ACCESS_PASSWORD=
VITE_DEPLOYMENT_MODE=client
VITE_SUPABASE_URL=
VITE_SUPABASE_ANON_KEY=
```

**C. デプロイフロー（Vercel/Netlify想定）**

各クライアントのVercelプロジェクトは対応ブランチをソースとする。`main` → `client/xxx` のマージ後、Vercelが自動で再デプロイする。管理者は `main` を修正するだけで全クライアントに修正を届けられる。

**実装工数目安: 1日（設定とドキュメント整備）**

---

### 6.7 実装優先順位と全体スケジュール

| 優先度 | 項目 | 関連セクション | 工数 | 推奨実装順 |
|--------|------|----------------|------|-----------|
| 高 | 見出し保持バグ修正 | 6.1 | 2日 | 第1週 |
| 高 | ファクトチェック全文化 | 6.2 | 2.5日 | 第1〜2週 |
| 中 | Chatwork通知 | 6.3 | 2日 | 第2週 |
| 中 | パスワードゲート | 6.5 | 1日 | 第2週 |
| 低 | メニュー再整理 | 6.4 | 1日 | 第3週 |
| 低 | 親子Gitモデル整備 | 6.6 | 1日 | 第3週 |
| **合計** | | | **9.5日** | **3週間** |

#### 実装の前提条件

1. `VITE_DEPLOYMENT_MODE` 環境変数の導入を最初に行い、以降の全機能がこれを参照する形にする。
2. 見出しバグ（6.1）は品質に直結するため最優先で対応する。
3. Chatwork連携（6.3）はPerplexity APIキーが設定済みであることを前提とする。
4. 親子Gitモデル（6.6）は実装というよりも運用設計であるため、開発者とクライアント担当者の合意後に着手する。

---

### 6.8 変更ファイル一覧

| ファイル | 変更種別 | 対応項目 |
|----------|----------|----------|
| `src/hooks/useMultiStepGeneration.ts` | 修正 | 6.1 |
| `src/services/multiStepGenerationService.ts` | 修正 | 6.1 |
| `src/shared/sectionGenerationPrompt.ts` | 修正 | 6.1 |
| `src/shared/multiStepPromptTemplates.ts` | 修正 | 6.1 |
| `src/services/factCheckService.ts` | 修正 | 6.2, 6.3 |
| `src/components/FactCheckSettings.tsx` | 修正 | 6.2 |
| `src/components/MultiStepGenerator/ContentGenerationStep.tsx` | 修正 | 6.2 |
| `src/services/chatworkService.ts` | **新規作成** | 6.3 |
| `src/components/Settings.tsx` | 修正 | 6.3, 6.4 |
| `src/components/Layout.tsx` | 修正 | 6.4 |
| `src/components/PasswordGate.tsx` | **新規作成** | 6.5 |
| `src/App.tsx` | 修正 | 6.5 |
| `.env.example` | **新規作成** | 6.5, 6.6 |
