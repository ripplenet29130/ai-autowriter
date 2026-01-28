# Supabaseスケジューラー設定手順（ダッシュボード版）

## 📋 事前準備

以下の情報を用意してください：
1. SupabaseプロジェクトURL（例: `https://xxxxx.supabase.co`）
2. Supabase Anon Key（プロジェクト設定から取得）
3. Supabase Service Role Key（プロジェクト設定から取得）

---

## ステップ1: Edge Functionの作成

### 1-1. Supabaseダッシュボードを開く
1. https://app.supabase.com にアクセス
2. ログイン
3. プロジェクトを選択

### 1-2. Edge Functionを作成
1. 左メニューから **Edge Functions** をクリック
2. **Create a new function** ボタンをクリック
3. 以下を入力：
   - **Function name**: `scheduler`
   - **Template**: Blank function を選択
4. **Create function** をクリック

### 1-3. コードを貼り付け
1. エディタが開いたら、既存のコードを全て削除
2. 以下のコードを貼り付け：

```typescript
// このコードは supabase/functions/scheduler/index.ts にあります
// ファイルを開いて全てコピーしてください
```

3. **Deploy** ボタンをクリック

---

## ステップ2: 環境変数の確認

### 2-1. プロジェクト設定を開く
1. 左メニューから **Project Settings** (歯車アイコン) をクリック
2. **API** タブを選択

### 2-2. 必要な情報をメモ
以下をメモしてください：
- **Project URL**: `https://xxxxx.supabase.co`
- **anon public key**: `eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...`
- **service_role key**: `eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...`

---

## ステップ3: Cron Jobの設定

### 3-1. SQL Editorを開く
1. 左メニューから **SQL Editor** をクリック
2. **New query** ボタンをクリック

### 3-2. pg_cron拡張を有効化
以下のSQLを実行：

```sql
CREATE EXTENSION IF NOT EXISTS pg_cron;
```

### 3-3. Cron Jobを作成
以下のSQLを実行（**必ず置き換えてください**）：

```sql
SELECT cron.schedule(
    'daily-article-generation',
    '0 0 * * *',  -- 毎日 UTC 0:00 (JST 9:00)
    $$
    SELECT
      net.http_post(
          url:='https://YOUR_PROJECT_REF.supabase.co/functions/v1/scheduler',
          headers:='{"Content-Type": "application/json", "Authorization": "Bearer YOUR_ANON_KEY"}'::jsonb,
          body:='{}'::jsonb
      ) as request_id;
    $$
);
```

**置き換える箇所**:
- `YOUR_PROJECT_REF` → あなたのプロジェクトURL（例: `xxxxx.supabase.co`）
- `YOUR_ANON_KEY` → ステップ2-2でメモしたanon public key

---

## ステップ4: 動作確認

### 4-1. Cron Jobが登録されているか確認
SQL Editorで実行：

```sql
SELECT * FROM cron.job;
```

結果に `daily-article-generation` が表示されればOK

### 4-2. Edge Functionを手動テスト
1. 左メニューから **Edge Functions** をクリック
2. `scheduler` を選択
3. **Invoke** タブをクリック
4. **Invoke function** ボタンをクリック

成功すると、レスポンスに記事のタイトルとURLが表示されます。

### 4-3. 実行ログを確認
SQL Editorで実行：

```sql
SELECT * FROM cron.job_run_details 
WHERE jobid = (SELECT jobid FROM cron.job WHERE jobname = 'daily-article-generation')
ORDER BY start_time DESC 
LIMIT 10;
```

---

## ステップ5: スケジュール時刻のカスタマイズ（オプション）

実行時刻を変更したい場合：

### 5-1. 既存のCron Jobを削除
```sql
SELECT cron.unschedule('daily-article-generation');
```

### 5-2. 新しいスケジュールで再作成
```sql
-- 例: 毎日12:00 (JST) = 3:00 (UTC)
SELECT cron.schedule(
    'daily-article-generation',
    '0 3 * * *',
    $$ ... $$  -- 同じ内容
);
```

**時刻変換表**:
- JST 9:00 → UTC 0:00 → `'0 0 * * *'`
- JST 12:00 → UTC 3:00 → `'0 3 * * *'`
- JST 18:00 → UTC 9:00 → `'0 9 * * *'`
- JST 21:00 → UTC 12:00 → `'0 12 * * *'`

---

## トラブルシューティング

### Edge Functionがエラーになる場合

1. **Logsタブを確認**
   - Edge Functions → scheduler → Logs
   - エラーメッセージを確認

2. **環境変数を確認**
   - Edge Functionは自動的に以下の環境変数にアクセスできます：
     - `SUPABASE_URL`
     - `SUPABASE_SERVICE_ROLE_KEY`

3. **AI設定を確認**
   - Supabaseの `ai_configs` テーブルに有効な設定があるか確認
   - `is_active = true` になっているか確認

### Cron Jobが実行されない場合

1. **pg_cronが有効か確認**
```sql
SELECT * FROM pg_extension WHERE extname = 'pg_cron';
```

2. **Cron Jobのステータス確認**
```sql
SELECT * FROM cron.job WHERE jobname = 'daily-article-generation';
```

3. **実行履歴を確認**
```sql
SELECT * FROM cron.job_run_details 
ORDER BY start_time DESC 
LIMIT 10;
```

---

## 完了チェックリスト

- [ ] Edge Function `scheduler` を作成・デプロイ
- [ ] pg_cron拡張を有効化
- [ ] Cron Jobを作成
- [ ] 手動テストで動作確認
- [ ] 実行ログで確認

すべて完了したら、毎日指定時刻に自動的に記事が投稿されます！

---

## 次のステップ

設定が完了したら：
1. 明日の指定時刻まで待つ
2. または、Cron Jobを1分後に設定してテスト
3. WordPress側で記事が投稿されているか確認

質問があれば、Supabaseのドキュメントを参照：
- https://supabase.com/docs/guides/functions
- https://supabase.com/docs/guides/database/extensions/pg_cron
