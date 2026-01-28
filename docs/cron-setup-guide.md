# サーバーサイドスケジューラー設定ガイド

このガイドでは、外部Cronサービスを使用してSupabase Edge Functionを定期的に実行し、24時間365日自動投稿を実現する方法を説明します。

## 概要

- **目的**: ブラウザを閉じても自動的に記事を生成・投稿
- **仕組み**: 外部Cronサービス → Supabase Edge Function → 記事生成 → WordPress投稿
- **実行頻度**: 10分ごとにチェック（設定された時刻に自動実行）

## 前提条件

✅ Supabase Edge Function `scheduler-executor` がデプロイ済み
✅ WordPress設定がSupabaseデータベースに保存済み
✅ AI設定（Gemini/OpenAI/Claude）がSupabaseデータベースに保存済み
✅ スケジュール設定（キーワード、時刻、頻度）が保存済み

## 手順1: Edge Function URLの取得

あなたのEdge Function URLは以下の形式です：

```
https://xafalymslrgksysvstqe.supabase.co/functions/v1/scheduler-executor
```

このURLを外部Cronサービスから呼び出します。

## 手順2: 外部Cronサービスの選択

以下のいずれかのサービスを推奨します：

### オプションA: cron-job.org（推奨・無料）

**特徴:**
- 完全無料
- 最短1分間隔で実行可能
- 簡単な設定
- 日本語対応

**設定手順:**

1. [cron-job.org](https://cron-job.org/) にアクセス
2. 無料アカウントを作成
3. 「Create Cronjob」をクリック

**Cronjob設定:**

- **Title**: `AI Blog Scheduler`
- **URL**: `https://xafalymslrgksysvstqe.supabase.co/functions/v1/scheduler-executor`
- **Execution schedule**: `*/10 * * * *`（10分ごと）
- **Request method**: `POST`
- **Request body**:
  ```json
  {"forceExecute": false}
  ```
- **Request headers**:
  ```
  Content-Type: application/json
  Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InhhZmFseW1zbHJna3N5c3ZzdHFlIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjE1NDQ2MTUsImV4cCI6MjA3NzEyMDYxNX0.CuSCldihlFqJ3dY2RNKx0sqdSiVIf_0z_Beiq0VMw1M
  ```

4. 「Create」をクリック

### オプションB: EasyCron（無料プランあり）

**特徴:**
- 無料プランで最大1日1回まで
- 有料プランで高頻度実行可能
- 詳細なログ機能

**設定手順:**

1. [EasyCron](https://www.easycron.com/) にアクセス
2. 無料アカウントを作成
3. 「Add Cron Job」をクリック

**Cron設定:**

- **URL**: `https://xafalymslrgksysvstqe.supabase.co/functions/v1/scheduler-executor`
- **Cron Expression**: `*/10 * * * *`
- **HTTP Method**: `POST`
- **Post Data**:
  ```json
  {"forceExecute": false}
  ```
- **HTTP Headers**:
  ```
  Content-Type: application/json
  Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InhhZmFseW1zbHJna3N5c3ZzdHFlIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjE1NDQ2MTUsImV4cCI6MjA3NzEyMDYxNX0.CuSCldihlFqJ3dY2RNKx0sqdSiVIf_0z_Beiq0VMw1M
  ```

### オプションC: GitHub Actions（完全無料）

**特徴:**
- GitHubリポジトリが必要
- 完全無料
- 最短5分間隔

**設定手順:**

1. プロジェクトのGitHubリポジトリに移動
2. `.github/workflows/scheduler.yml` を作成：

```yaml
name: AI Blog Scheduler

on:
  schedule:
    - cron: '*/10 * * * *'  # 10分ごとに実行
  workflow_dispatch:  # 手動実行も可能

jobs:
  trigger-scheduler:
    runs-on: ubuntu-latest
    steps:
      - name: Call Supabase Edge Function
        run: |
          curl -X POST \
            -H "Content-Type: application/json" \
            -H "Authorization: Bearer ${{ secrets.SUPABASE_ANON_KEY }}" \
            -d '{"forceExecute": false}' \
            https://xafalymslrgksysvstqe.supabase.co/functions/v1/scheduler-executor
```

3. リポジトリの Settings → Secrets → Actions で以下を追加：
   - `SUPABASE_ANON_KEY`: `eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InhhZmFseW1zbHJna3N5c3ZzdHFlIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjE1NDQ2MTUsImV4cCI6MjA3NzEyMDYxNX0.CuSCldihlFqJ3dY2RNKx0sqdSiVIf_0z_Beiq0VMw1M`

## 手順3: 動作確認

### 3-1. Edge Functionの手動テスト

ブラウザの管理画面から：

1. **スケジューラー**タブを開く
2. **「サーバーサイドスケジューラーを今すぐ実行」**ボタンをクリック
3. 成功メッセージが表示されることを確認

### 3-2. Cronの動作確認

設定したCronサービスのダッシュボードで：

- 実行履歴を確認
- HTTPステータスコード 200 が返っていることを確認
- エラーがないことを確認

### 3-3. Supabaseログの確認

1. [Supabase Dashboard](https://supabase.com/dashboard) にログイン
2. プロジェクトを選択
3. **Edge Functions** → **scheduler-executor** → **Logs** を確認
4. 実行ログに以下が表示されていることを確認：
   - `Scheduler executor started at: [timestamp]`
   - `Using AI config: [provider] [model]`
   - `Found N active schedules`

## 実行の仕組み

### タイムライン

```
09:50 → Cron実行 → スケジュール時刻でないためスキップ
10:00 → Cron実行 → スケジュール時刻（10:00）のため記事生成・投稿
10:10 → Cron実行 → 既に実行済みのためスキップ
10:20 → Cron実行 → 既に実行済みのためスキップ
```

### 実行条件

Edge Functionは以下の条件で記事を生成・投稿します：

1. **時刻チェック**: 現在時刻がスケジュール設定の時刻±5分以内
2. **頻度チェック**: 前回実行から十分な時間が経過している
   - 毎日: 23時間以上
   - 毎週: 6.5日以上
   - 隔週: 13日以上
   - 毎月: 29日以上
3. **設定チェック**: スケジュールが有効（isActive: true）
4. **キーワードチェック**: 未使用のキーワードが残っている

## トラブルシューティング

### 記事が自動投稿されない

**確認項目:**

1. Cronが正しく実行されているか（Cronサービスのログを確認）
2. Edge Functionにエラーがないか（Supabaseログを確認）
3. スケジュール設定が有効になっているか（管理画面で確認）
4. AI設定が正しく保存されているか
5. WordPress設定が正しく保存されているか
6. キーワードが設定されているか

### Cronの実行頻度を変更したい

Cron式を変更します：

- `*/5 * * * *` → 5分ごと
- `*/15 * * * *` → 15分ごと
- `*/30 * * * *` → 30分ごと
- `0 * * * *` → 1時間ごと（毎時0分）

### 強制実行したい

Cronサービスから手動実行するか、管理画面の「サーバーサイドスケジューラーを今すぐ実行」ボタンを使用します。

または、リクエストボディを変更：

```json
{"forceExecute": true}
```

これにより時刻チェックをスキップして即座に実行されます。

## セキュリティ注意事項

- **APIキーの管理**: SupabaseのAnon Keyは公開されても問題ありませんが、Service Role Keyは絶対に公開しないでください
- **Row Level Security**: Supabaseのテーブルには既にRLSが設定されているため安全です
- **WordPress認証**: Application Passwordを使用しているため安全です

## よくある質問

**Q: Cronサービスは有料ですか？**
A: cron-job.orgとGitHub Actionsは完全無料です。EasyCronは無料プランがあります。

**Q: 複数のスケジュールを設定できますか？**
A: はい、管理画面で複数のWordPress設定にそれぞれスケジュールを設定できます。

**Q: キーワードを使い切ったらどうなりますか？**
A: 自動的にリセットされ、最初のキーワードから再度使用されます。

**Q: ブラウザベーススケジューラーとサーバーサイドスケジューラーは併用できますか？**
A: できますが、重複実行を避けるため、どちらか一方のみの使用を推奨します。

**Q: 実行履歴はどこで確認できますか？**
A: Supabaseの `execution_history` テーブルに保存されています。管理画面からも確認できます。

## サポート

問題が解決しない場合は、以下の情報を確認してください：

1. Supabase Edge Functionのログ
2. Cronサービスの実行ログ
3. ブラウザのコンソールログ
4. WordPressのエラーログ

---

**設定完了後、24時間365日自動的に記事が生成・投稿されます！**
