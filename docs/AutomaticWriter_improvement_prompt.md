# AutomaticWriter 改善指示プロンプト

## プロジェクト概要

`c:\Users\syste\OneDrive\デスクトップ\AutomaticWriter-main`

WordPressへ記事を自動生成・スケジュール投稿するReact+TypeScriptアプリ。
Supabase（DB）＋ Netlify Functions を使用。
記事生成はセクション別にAI（Gemini/OpenAI/Claude）を呼び出す方式。

---

## 修正・改善の全タスク一覧

---

### P1：致命的バグの修正

#### [x] 1. `customInstructions` がサブ生成処理に伝播していない

**確認結果**  
`src/shared/articleGenerationCore.ts` で `appendCustomInstructions()` が追加され、`summarizeToWordCount()` / `completeSectionIfIncomplete()` / `polishArticleFormatting()` / `normalizeLengthWithQualityGate()` / `extendToMinimumLength()` 系の呼び出し経路に `customInstructions` が渡る状態になっている。

**問題**  
ユーザーがスケジュール設定で指定した `customInstructions`（文体・NGワード・追加指示）は、メインのセクション生成には渡されるが、以下の二次処理には渡されていない。そのため文体が途中で変わる。

**対象ファイル**  
`src/shared/articleGenerationCore.ts`

**渡されていない関数（全て修正対象）：**
- `extendToMinimumLength()`：文字数不足時の補足生成
- `summarizeToWordCount()`：文字数超過時の要約
- `completeSectionIfIncomplete()`：不完全セクションの補完
- `polishArticleFormatting()`：最終整形
- `normalizeLengthWithQualityGate()`：文字数調整ループ

**修正方針**  
各関数のシグネチャに `customInstructions?: string` を追加し、内部で構築するプロンプトの末尾に以下を追記する。

```typescript
${customInstructions ? `\n追加指示（必ず守ること）:\n${customInstructions}` : ''}
```

呼び出し元の `generateSectionWithQualityGate()` および `generateArticleFromOutlineWithSharedCore()` から `customInstructions` を受け取り、各サブ関数に渡すこと。

---

#### [x] 2. 文が途中で切れるバグ

**確認結果**  
`src/shared/articleGenerationCore.ts` に `trimDanglingTailSafe()` と継続表現判定用の正規表現が追加され、補足生成後・整形後の主要な経路で安全側の末尾トリムが使われている。

**問題**  
`trimDanglingTail()` および `extendToMinimumLength()` の切り取り処理が、以下のような動詞中間活用形で終わる文を「完結している」と誤判定し、文が途中で切れた状態で出力される。

例：
- 「摩擦や切削抵抗が増大し」
- 「加工精度の劣化に直結し」
- 「切りくずが排出されない場合、工具とワーク間に挟まり」

**対象ファイル**  
`src/shared/articleGenerationCore.ts` の `trimDanglingTail()` 関数

**修正方針**  
文末が「し」「して」「し、」「しており」「であり」等の非完結パターンで終わる場合は「不完全」と判定するロジックを追加する。

```typescript
// 追加する判定：文末が不完結な動詞活用で終わっていないか確認
const incompleteEndings = /[しにてでも、]$/;
if (incompleteEndings.test(merged.trimEnd())) {
  // 最後の句点以前まで切り戻す
}
```

---

### P2：品質改善

#### [x] 3. 前セクションのコンテキストが700文字しか渡されない

**確認結果**  
`src/shared/sectionGenerationPrompt.ts` の `buildHighQualitySectionPrompt()` では `previousContent` の `slice(-700)` が消えており、固定700文字制限は外れている。

**問題**  
`buildHighQualitySectionPrompt()` の `previousContent` は末尾700文字のみ。
セクション3以降では、セクション1・2の内容を「知らずに」同じ内容を繰り返す。

**対象ファイル**  
`src/shared/sectionGenerationPrompt.ts`（L67：`const context = (input.previousContent || '').slice(-700);`）

**修正方針**  
- 渡す文字数を最大2000文字に拡大
- またはセクション生成前に「直前のキーポイント（H2見出しと各段落の最初の1文）」を抽出して渡す

---

#### [x] 4. 最終スタイル統一パスの追加

**確認結果**  
`src/shared/articleGenerationCore.ts` に `finalUnifyArticleStyle()` が追加され、`polishArticleFormatting()` の後に条件付きで実行されるようになった。H2見出し固定・Markdown維持・長さ比チェック付きで、文体統一と尻切れ補完を安全側で行う構成になっている。

**問題**  
全セクション組み立て後に文体統一・重複除去・不完全文修正を行うパスが存在しない。

**対象ファイル**  
`src/shared/articleGenerationCore.ts` の `generateArticleFromOutlineWithSharedCore()` 末尾

**修正方針**  
`polishArticleFormatting()` の後、または代わりに、以下を目的とするAI呼び出しを1回追加する。

```
プロンプト方針：
「以下の記事の文体を統一し（です・ます体に統一）、内容の重複を除去し、
 途中で切れている文を完結させてください。
 H2見出しの文言・順序は変えないこと。
 内容の追加・削除・大幅な書き換えは禁止。
 出力は修正済みMarkdown本文のみ。」
```

`customInstructions` があればそれも追加すること。

---

### P3：新機能追加

#### [ ] 5. スタイル参照URL機能（最重要新機能）

**確認結果**  
`styleReferenceUrl` / `style_reference_url` の実装痕跡は `src` / `supabase` 配下で確認できず、未着手と判断。

**概要**  
スケジュール設定に「スタイル参照URL」フィールドを追加する。
クライアントの既存サイトのURLを入力すると、そのページの文体・表現スタイルを学習し、新しい記事に反映する機能。

**ユーザーフロー**
1. スケジュール設定画面に「スタイル参照URL（任意）」フィールドを追加
2. URLを入力して保存
3. 記事生成時に、URLのページをスクレイピングして本文テキストを500〜800文字抽出
4. 以下をセクション生成プロンプトに追加する：
   ```
   【文体・スタイルの参考】
   以下のサンプル文章の文体・表現スタイル・語彙レベルを参考にして書いてください。
   内容は一切コピーしないこと。あくまで「書き方」の参考として使用すること：
   
   [抽出したサンプルテキスト500〜800文字]
   ```

**実装箇所**

データモデル（Supabase `schedule_settings` テーブルに `style_reference_url` カラムを追加）：
```sql
ALTER TABLE schedule_settings ADD COLUMN style_reference_url TEXT;
```

フロントエンド：
- `src/services/supabaseSchedulerService.ts` の `saveScheduleSettings()` / `loadWordPressConfigs()` に `style_reference_url` を追加
- `src/types/index.ts` の `ScheduleSettings` 型に `styleReferenceUrl?: string` を追加
- スケジュール設定フォームに入力欄を追加

スクレイピング処理：
- 既存の `competitorResearchService.ts` を参考に、URLからテキスト抽出する関数を作成
- Supabase Edge Function （`ai-proxy` または新規）経由でスクレイピングを実行
- 抽出したテキストをスケジュール実行時にプロンプトへ渡す

スケジューラー実行側（`supabase/functions/scheduler-executor/`）に `styleReferenceUrl` を受け取り、スクレイピング → プロンプト挿入する処理を追加。

---

### P4：機能削除

#### [x] 6. SEOスコアの削除

**確認結果**  
`TitleSuggestion.clickPotential`、`titleGenerationService.ts` のランダム指標、`TrendAnalysis/SEOMetrics.tsx`、および `TrendAnalysisResult.seoData` と関連生成ロジックを削除した。SEO風の疑似スコア表示はコード上から除去済み。

**問題**  
現在のSEOスコアはランダム値（`Math.floor(Math.random() * 20) + 80`）または単純な文字数・見出し数カウントであり、実際のSEOと無関係。ユーザーに誤解を与えるため削除する。

**削除対象**

`src/services/titleGenerationService.ts`：
```typescript
seoScore: Math.floor(Math.random() * 20) + 80,  // この行を削除
clickPotential: Math.floor(Math.random() * 20) + 80,  // この行を削除
```

`src/services/aiService.ts`：
- `calculateSEOScore()` メソッドを削除
- `generateArticle()` の戻り値から `seoScore` を削除

`src/types/index.ts`：
- `TitleSuggestion` 型から `seoScore`・`clickPotential` を削除
- `Article` 型から `seoScore` を削除

UIコンポーネント：
- `src/components/TrendAnalysis/SEOMetrics.tsx` の SEOスコア表示部分を削除またはコンポーネントごと削除
- 記事一覧・詳細でSEOスコアを表示している箇所を削除

---

## 優先順序まとめ

| 状況 | 優先度 | タスク | 効果 |
|------|--------|--------|------|
| [x] | 🔴 P1 | `customInstructions` の全処理への伝播 | 文体混在の根本解決 |
| [x] | 🔴 P1 | 文の途中切れバグ修正 | 明らかな品質エラーの除去 |
| [x] | 🟠 P2 | 前セクションのコンテキスト拡大 | 内容重複の軽減 |
| [x] | 🟠 P2 | 最終スタイル統一パスの追加 | 全体的な仕上がり向上 |
| [ ] | 🟢 P3 | スタイル参照URL機能 | クライアント文体の精度向上（新機能） |
| [x] | 🔵 P4 | SEOスコアの削除 | 誤解を招く機能の除去 |

---

## 注意事項

- TypeScriptの型エラーが出ないように修正後は `npx tsc --noEmit` でチェックすること
- `customInstructions` はオプション（`?: string`）なので、`undefined` の場合は何も追加しない
- スクレイピング処理はCORSの問題があるため、必ずサーバーサイド（Supabase Edge Function）経由で実行すること
- スタイル参照URLは「文体の参考」であり「内容のコピー」ではないことをプロンプトで明示すること
