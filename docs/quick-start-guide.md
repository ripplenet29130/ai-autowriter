# クイックスタートガイド - 自動投稿を開始する

このガイドでは、AI記事の自動投稿を最短で設定する方法を説明します。

## ステップ1: AI設定（1分）

1. 左サイドバーの **「AI設定」** をクリック
2. 使用するAIプロバイダーを選択（Gemini推奨）
3. APIキーを入力
4. **「設定を保存」** をクリック

✅ **保存後、設定は自動的にSupabaseデータベースに保存されます**

## ステップ2: WordPress設定（2分）

1. 左サイドバーの **「WordPress設定」** をクリック
2. **「新しいWordPress設定を追加」** をクリック
3. 以下を入力：
   - サイト名
   - WordPressのURL
   - ユーザー名
   - Application Password
   - カテゴリーID

4. **「設定を保存」** をクリック

✅ **保存後、設定は自動的にSupabaseデータベースに保存されます**

### Application Passwordの取得方法

1. WordPressダッシュボードにログイン
2. **「ユーザー」** → **「プロフィール」** に移動
3. 下にスクロールして **「Application Passwords」** セクションを見つける
4. 新しいアプリケーション名（例：AI Blog Generator）を入力
5. **「新しいアプリケーションパスワードを追加」** をクリック
6. 表示されたパスワードをコピー（スペースは削除してもOK）

## ステップ3: スケジュール設定（3分）

1. 左サイドバーの **「スケジューラー」** をクリック
2. 保存したWordPress設定の **「編集」** ボタンをクリック
3. **スケジュール設定** セクションで以下を設定：
   - **頻度**: 毎日 / 毎週 / 隔週 / 毎月
   - **実行時刻**: 例: `10:00`（24時間形式）
   - **投稿状態**: 公開 / 下書き
   - **ターゲットキーワード**: 記事のテーマとなるキーワードを追加
     - 例: `AI技術`, `機械学習`, `プログラミング`

4. **「保存」** をクリック
5. **「開始」** ボタンをクリック

✅ **保存後、スケジュール設定は自動的にSupabaseデータベースに保存されます**

## ステップ4: 外部Cronの設定（5分）

**重要**: このステップで24時間365日の自動投稿が可能になります。

### 推奨: cron-job.org（完全無料）

1. [cron-job.org](https://cron-job.org/) にアクセスして無料登録

2. **「Create Cronjob」** をクリック

3. 以下のように設定：

**基本設定:**
- **Title**: `AI Blog Scheduler`
- **URL**: `https://xafalymslrgksysvstqe.supabase.co/functions/v1/scheduler-executor`
- **Execution schedule**: `*/10 * * * *`（10分ごと）

**詳細設定:**
- **Request method**: `POST`
- **Request body**:
  ```json
  {"forceExecute": false}
  ```
- **Request headers** の「Add header」をクリックして2つ追加：
  - Header 1:
    - Name: `Content-Type`
    - Value: `application/json`
  - Header 2:
    - Name: `Authorization`
    - Value: `Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InhhZmFseW1zbHJna3N5c3ZzdHFlIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjE1NDQ2MTUsImV4cCI6MjA3NzEyMDYxNX0.CuSCldihlFqJ3dY2RNKx0sqdSiVIf_0z_Beiq0VMw1M`

4. **「Create」** をクリック

5. すぐに **「Run cronjob」** をクリックしてテスト実行

✅ **Execution resultが成功（緑色）になれば完了！**

## ステップ5: 動作確認（1分）

### 管理画面でテスト実行

1. **「スケジューラー」** タブに戻る
2. **「サーバーサイドスケジューラーを今すぐ実行」** をクリック
3. 成功メッセージが表示されることを確認

### Supabaseログの確認

1. [Supabase Dashboard](https://supabase.com/dashboard) にログイン
2. プロジェクト `xafalymslrgksysvstqe` を選択
3. **Edge Functions** → **scheduler-executor** → **Logs** をクリック
4. 実行ログが表示されていることを確認

## 完了！

これで24時間365日、自動的に記事が生成・投稿されます。

### 自動投稿の仕組み

1. **10分ごと**: cron-job.orgがSupabase Edge Functionを呼び出し
2. **時刻チェック**: 設定された時刻（±5分）かどうかをチェック
3. **記事生成**: 条件を満たす場合、キーワードからトレンド分析→タイトル生成→記事生成
4. **WordPress投稿**: 生成した記事をWordPressに自動投稿
5. **履歴保存**: 実行履歴をSupabaseに保存

### 例: 毎日10:00に投稿する場合

```
09:50 → Cron実行 → 時刻が合わないのでスキップ
10:00 → Cron実行 → 時刻が合致！記事生成・投稿を実行
10:10 → Cron実行 → 既に実行済みのためスキップ
10:20 → Cron実行 → 既に実行済みのためスキップ
...
翌日10:00 → Cron実行 → 24時間経過！記事生成・投稿を実行
```

## よくある質問

**Q: ブラウザを閉じても動作しますか？**
A: はい。外部Cronサービスがサーバー側で動作するため、ブラウザを閉じても自動投稿が継続されます。

**Q: 複数のWordPress設定を同時に動かせますか？**
A: はい。複数のWordPress設定にそれぞれスケジュールを設定できます。

**Q: キーワードは使い回されますか？**
A: はい。全てのキーワードを使い切ると、自動的にリセットされて最初から使用されます。

**Q: 投稿前に確認できますか？**
A: 「投稿状態」を「下書き」に設定すると、WordPressの下書きとして保存されます。

**Q: 費用はかかりますか？**
A: cron-job.orgとGitHub Actionsは完全無料です。AIのAPIキーは使用量に応じて課金されます。

## トラブルシューティング

### 記事が投稿されない場合

1. cron-job.orgで実行履歴を確認（HTTPステータス 200になっているか）
2. Supabaseのログを確認（エラーがないか）
3. WordPress設定が正しいか確認（URLやApplication Password）
4. スケジュールが有効になっているか確認
5. キーワードが設定されているか確認

### 詳しいトラブルシューティング

詳細は [Cron設定ガイド](./cron-setup-guide.md) を参照してください。

---

**これで自動投稿の設定は完了です。お疲れ様でした！**
