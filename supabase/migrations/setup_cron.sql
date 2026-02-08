-- Supabase Cron Job設定
-- これをSupabase SQL Editorで実行してください

-- 1. pg_cron拡張を有効化（初回のみ）
CREATE EXTENSION IF NOT EXISTS pg_cron;

-- 2. 毎分実行するCron Job (全スケジュールをチェック)
-- 重要: Supabaseのサーバー時間はUTCですが、アプリ側はJST(日本時間)で計算するように修正済みです。
-- YOUR_PROJECT_REF と YOUR_ANON_KEY をご自身のものに置き換えてください。
SELECT cron.schedule(
    'article-scheduler-check',   -- ジョブ名
    '* * * * *',                 -- 毎分実行
    $$
    SELECT
      net.http_post(
          url:='https://YOUR_PROJECT_REF.supabase.co/functions/v1/scheduler-executor',
          headers:='{"Content-Type": "application/json", "Authorization": "Bearer YOUR_ANON_KEY"}'::jsonb,
          body:='{"forceExecute": false}'::jsonb
      ) as request_id;
    $$
);

-- 3. Cron Jobの確認
SELECT * FROM cron.job;

-- 4. Cron Jobの削除（必要な場合）
-- SELECT cron.unschedule('daily-article-generation');
