# Supabaseスケジューラー移行ガイド

## 概要
NetlifyからSupabaseへスケジューラーを移行します。これにより、完全無料で確実な自動投稿が実現できます。

## メリット
- ✅ **完全無料**: Supabaseの無料プランに含まれる
- ✅ **確実な実行**: PostgreSQLのpg_cronを使用
- ✅ **管理が簡単**: Supabaseダッシュボードから確認可能
- ✅ **デプロイ不要**: SQLで設定するだけ

## 移行手順

### ステップ1: Supabase Edge Functionのデプロイ

```bash
# Supabase CLIのインストール（未インストールの場合）
npm install -g supabase

# Supabaseにログイン
supabase login

# プロジェクトにリンク
supabase link --project-ref YOUR_PROJECT_REF

# Edge Functionをデプロイ
supabase functions deploy scheduler
```

### ステップ2: Cron Jobの設定

1. Supabaseダッシュボードを開く
2. SQL Editorを開く
3. `supabase/migrations/setup_cron.sql`の内容を実行

**重要**: SQLファイル内の以下を置き換えてください：
- `YOUR_PROJECT_REF` → あなたのSupabaseプロジェクトID
- `YOUR_ANON_KEY` → SupabaseのAnon Key

### ステップ3: 動作確認

```sql
-- Cron Jobが正しく設定されているか確認
SELECT * FROM cron.job;

-- 実行履歴を確認
SELECT * FROM cron.job_run_details 
ORDER BY start_time DESC 
LIMIT 10;
```

### ステップ4: 手動テスト

Edge Functionを手動で実行してテスト：

```bash
# ローカルでテスト
supabase functions serve scheduler

# 別のターミナルで実行
curl -i --location --request POST 'http://localhost:54321/functions/v1/scheduler' \
  --header 'Authorization: Bearer YOUR_ANON_KEY' \
  --header 'Content-Type: application/json'
```

または、Supabaseダッシュボードから：
1. Edge Functions → scheduler → Invoke
2. 実行ボタンをクリック

## スケジュール設定のカスタマイズ

### 実行時刻の変更

`setup_cron.sql`の`cron.schedule`の第2引数を変更：

```sql
-- 毎日9:00 (JST) = 0:00 (UTC)
'0 0 * * *'

-- 毎日12:00 (JST) = 3:00 (UTC)
'0 3 * * *'

-- 毎日18:00 (JST) = 9:00 (UTC)
'0 9 * * *'

-- 1日2回（9:00と18:00）
'0 0,9 * * *'
```

### 複数のスケジュール設定

```sql
-- 朝9:00
SELECT cron.schedule(
    'morning-article',
    '0 0 * * *',
    $$ SELECT net.http_post(...) $$
);

-- 夜18:00
SELECT cron.schedule(
    'evening-article',
    '0 9 * * *',
    $$ SELECT net.http_post(...) $$
);
```

## トラブルシューティング

### Cron Jobが実行されない場合

1. **pg_cron拡張が有効か確認**
```sql
SELECT * FROM pg_extension WHERE extname = 'pg_cron';
```

2. **Cron Jobのステータス確認**
```sql
SELECT * FROM cron.job WHERE jobname = 'daily-article-generation';
```

3. **実行ログを確認**
```sql
SELECT * FROM cron.job_run_details 
WHERE jobid = (SELECT jobid FROM cron.job WHERE jobname = 'daily-article-generation')
ORDER BY start_time DESC;
```

### Edge Functionのエラー確認

Supabaseダッシュボード → Edge Functions → scheduler → Logs

## Netlify設定の削除（オプション）

移行後、Netlify Functionsが不要になった場合：

1. `netlify.toml`から以下を削除：
```toml
[functions."scheduler"]
  schedule = "*/1 * * * *"
```

2. `netlify/functions/scheduler.ts`を削除（または保管）

## まとめ

Supabaseスケジューラーに移行することで：
- コストゼロで自動投稿が実現
- 確実な実行が保証される
- 管理が簡単になる

質問があれば、Supabaseのドキュメントを参照してください：
- https://supabase.com/docs/guides/functions/schedule-functions
- https://supabase.com/docs/guides/database/extensions/pg_cron
