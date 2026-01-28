-- Supabase Cron Job設定
-- これをSupabase SQL Editorで実行してください

-- 1. pg_cron拡張を有効化（初回のみ）
CREATE EXTENSION IF NOT EXISTS pg_cron;

-- 2. 毎日9:00（JST）に実行するCron Job
-- 注意: Supabaseのサーバーは UTC なので、JST 9:00 = UTC 0:00
SELECT cron.schedule(
    'daily-article-generation',  -- ジョブ名
    '0 0 * * *',                 -- 毎日 UTC 0:00 (JST 9:00)
    $$
    SELECT
      net.http_post(
          url:='https://YOUR_PROJECT_REF.supabase.co/functions/v1/scheduler',
          headers:='{"Content-Type": "application/json", "Authorization": "Bearer YOUR_ANON_KEY"}'::jsonb,
          body:='{}'::jsonb
      ) as request_id;
    $$
);

-- 3. Cron Jobの確認
SELECT * FROM cron.job;

-- 4. Cron Jobの削除（必要な場合）
-- SELECT cron.unschedule('daily-article-generation');
