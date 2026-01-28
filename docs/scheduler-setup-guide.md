# スケジューラー設定ガイド

このガイドでは、サーバーサイドスケジューラーを設定して、ブラウザを開かなくても自動的に記事を生成・投稿する方法を説明します。

## 概要

このシステムは以下の3つのコンポーネントで構成されています：

1. **Supabase Database**: WordPress設定、AI設定、スケジュール設定を保存
2. **Supabase Edge Function**: 記事生成と投稿のロジックを実行
3. **外部Cronサービス**: Edge Functionを定期的に呼び出し

## セットアップ手順

### 1. Supabaseの設定（完了済み）

以下のテーブルがすでに作成されています：
- `wordpress_configs`: WordPress設定
- `schedule_settings`: スケジュール設定
- `ai_configs`: AI設定
- `execution_history`: 実行履歴

### 2. Edge Functionのデプロイ（完了済み）

`scheduler-executor` という Edge Function がデプロイされています。このFunctionは以下を実行します：

1. Supabaseからアクティブなスケジュール設定を取得
2. 実行時刻をチェック
3. 未使用のキーワードを選択
4. AIでタイトルと記事を生成
5. WordPressに投稿
6. 実行履歴を保存

### 3. 外部Cronサービスの設定

#### オプション1: cron-job.org（推奨・無料）

1. **アカウント作成**
   - https://cron-job.org にアクセス
   - 無料アカウントを作成

2. **Cronジョブの作成**
   - "Create cronjob" をクリック
   - 以下の設定を入力：
     - **Title**: `AI Blog Scheduler`
     - **URL**: `https://xafalymslrgksysvstqe.supabase.co/functions/v1/scheduler-executor`
     - **Execution schedule**: 毎時実行するように設定
       - 例: `*/60 * * * *`（毎60分）
       - または: `0 * * * *`（毎時0分）
     - **HTTP Method**: POST
     - **Request headers**:
       - `Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InhhZmFseW1zbHJna3N5c3ZzdHFlIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjE1NDQ2MTUsImV4cCI6MjA3NzEyMDYxNX0.CuSCldihlFqJ3dY2RNKx0sqdSiVIf_0z_Beiq0VMw1M`
       - `Content-Type: application/json`

3. **保存して有効化**

#### オプション2: EasyCron（無料プランあり）

1. **アカウント作成**
   - https://www.easycron.com にアクセス
   - 無料アカウントを作成（月100回まで無料）

2. **Cronジョブの作成**
   - "Create New Cron Job" をクリック
   - 以下を設定：
     - **Cron Expression**: `0 * * * *`（毎時0分）
     - **URL to call**: `https://xafalymslrgksysvstqe.supabase.co/functions/v1/scheduler-executor`
     - **HTTP Method**: POST
     - **HTTP Headers**:
       ```
       Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InhhZmFseW1zbHJna3N5c3ZzdHFlIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjE1NDQ2MTUsImV4cCI6MjA3NzEyMDYxNX0.CuSCldihlFqJ3dY2RNKx0sqdSiVIf_0z_Beiq0VMw1M
       Content-Type: application/json
       ```

3. **保存して有効化**

#### オプション3: GitHub Actions（無料）

プロジェクトリポジトリに以下のファイルを作成：

`.github/workflows/scheduler.yml`:
```yaml
name: AI Blog Scheduler

on:
  schedule:
    - cron: '0 * * * *'  # 毎時0分に実行
  workflow_dispatch:  # 手動実行も可能

jobs:
  trigger-scheduler:
    runs-on: ubuntu-latest
    steps:
      - name: Call Scheduler Edge Function
        run: |
          curl -X POST \
            -H "Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InhhZmFseW1zbHJna3N5c3ZzdHFlIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjE1NDQ2MTUsImV4cCI6MjA3NzEyMDYxNX0.CuSCldihlFqJ3dY2RNKx0sqdSiVIf_0z_Beiq0VMw1M" \
            -H "Content-Type: application/json" \
            https://xafalymslrgksysvstqe.supabase.co/functions/v1/scheduler-executor
```

## 使い方

### 1. WordPress設定を追加

1. アプリの「WordPress設定」ページに移動
2. WordPress URLやユーザー名などを入力
3. **スケジュール設定**セクションで：
   - 実行頻度を選択（毎日、毎週など）
   - 実行時刻を設定（例: 09:00）
   - ターゲットキーワードを追加
   - 投稿ステータスを選択（公開 or 下書き）
4. 「スケジュール有効」をONにする
5. 保存

### 2. AI設定を保存

1. 「AI設定」ページに移動
2. AIプロバイダーとAPIキーを入力
3. モデルを選択
4. 保存

### 3. 自動実行を確認

外部Cronサービスが設定されていれば：
- 設定した時刻に自動的にスケジューラーが実行されます
- 実行結果は `execution_history` テーブルに保存されます
- WordPress に記事が自動投稿されます

## 動作確認

### 手動テスト

以下のコマンドでEdge Functionを手動で実行できます：

```bash
curl -X POST \
  -H "Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InhhZmFseW1zbHJna3N5c3ZzdHFlIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjE1NDQ2MTUsImV4cCI6MjA3NzEyMDYxNX0.CuSCldihlFqJ3dY2RNKx0sqdSiVIf_0z_Beiq0VMw1M" \
  -H "Content-Type: application/json" \
  https://xafalymslrgksysvstqe.supabase.co/functions/v1/scheduler-executor
```

### ログの確認

1. Supabaseダッシュボードにログイン
2. 「Edge Functions」→「scheduler-executor」→「Logs」でログを確認
3. `execution_history` テーブルで実行履歴を確認

## トラブルシューティング

### 記事が投稿されない

1. **Cronが実行されているか確認**
   - Cronサービスのダッシュボードで実行履歴を確認
   - ステータスコード200が返ってきているか確認

2. **スケジュール設定を確認**
   - WordPress設定でスケジュールが有効になっているか
   - ターゲットキーワードが設定されているか
   - 実行時刻が正しいか

3. **AI設定を確認**
   - APIキーが正しいか
   - モデル名が正しいか（Gemini 2.5など）

4. **WordPress接続を確認**
   - WordPressのURLが正しいか
   - 認証情報が正しいか

### Edge Functionのエラー

Supabaseのログを確認：
```
https://supabase.com/dashboard/project/xafalymslrgksysvstqe/functions/scheduler-executor/logs
```

よくあるエラー：
- `AI設定が見つかりません`: AI設定を保存してください
- `アクティブなスケジュールがありません`: スケジュールを有効にしてください
- `使用可能なキーワードがありません`: ターゲットキーワードを追加してください

## 高度な設定

### 実行頻度のカスタマイズ

Edge Functionは±5分の範囲で実行を受け付けます。例えば：
- 設定時刻: 09:00
- 実行可能時間: 08:55 ～ 09:05

Cronを15分ごとに実行すると、より正確な時刻で実行されます：
```
*/15 * * * *
```

### 複数のWordPress設定

複数のWordPress設定を登録すると、それぞれ独立してスケジュール実行されます。
例：
- WordPress A: 毎日09:00に投稿
- WordPress B: 毎週月曜14:00に投稿
- WordPress C: 毎月1日10:00に投稿

### キーワードの多様性

- 各スケジュールごとに使用したキーワードが記録されます
- すべてのキーワードを使い切ると、自動的にリセットされます
- キーワードはランダムに選択されます

## セキュリティ

### 本番環境での推奨事項

1. **環境変数の使用**
   - APIキーやパスワードを環境変数で管理
   - Supabase Vaultを使用した機密情報の暗号化

2. **RLSの強化**
   - 現在は簡易的な実装（全ユーザーアクセス可）
   - 本番環境では認証付きRLSポリシーを推奨

3. **APIレート制限**
   - AI APIのレート制限に注意
   - 必要に応じてリトライロジックを追加

## まとめ

1. WordPress設定とAI設定をアプリで保存
2. 外部Cronサービスで定期実行を設定
3. 自動的に記事が生成・投稿されます

これで、ブラウザを開かなくても24時間365日自動投稿が可能になります！
