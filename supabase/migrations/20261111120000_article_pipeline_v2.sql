-- 記事作成の新方式（v2）: 工程ごとに分けて実行するためのジョブと工程の記録
-- 仕様: docs/article-pipeline-v2-spec-2026-11-11.md（5 章・9 章）
-- 既存のテーブルは schedule_settings に列を 1 つ足すだけ（段階 4: 使う方式）

-- 1. 記事 1 本 = ジョブ
CREATE TABLE IF NOT EXISTS public.article_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid,
  user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  -- スケジュールから作られたジョブならそのスケジュールと実行履歴
  schedule_id uuid,
  execution_history_id uuid,
  wordpress_config_id uuid,
  ai_config_id uuid,
  keyword text NOT NULL,
  fixed_title text,
  -- 文字数の決め方・トーン・品質モード・追加の指示など
  settings jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'queued',
  current_step text NOT NULL DEFAULT 'research',
  -- 工程の間で受け渡す途中経過（調査結果・根拠メモ・構成案・本文の版など）
  state jsonb NOT NULL DEFAULT '{}'::jsonb,
  title text,
  content text,
  length_plan jsonb,
  verdict jsonb,
  quality jsonb,
  wordpress_post_id text,
  wordpress_url text,
  cost jsonb NOT NULL DEFAULT '{}'::jsonb,
  -- 今の工程を何回試したか（3 回失敗したらジョブを失敗にする）
  step_attempts integer NOT NULL DEFAULT 0,
  locked_until timestamptz,
  error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  CONSTRAINT article_jobs_status_check CHECK (status IN ('queued', 'running', 'completed', 'failed', 'cancelled'))
);

CREATE INDEX IF NOT EXISTS idx_article_jobs_runnable ON public.article_jobs (status, locked_until, created_at);
CREATE INDEX IF NOT EXISTS idx_article_jobs_user_created ON public.article_jobs (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_article_jobs_schedule ON public.article_jobs (schedule_id);

-- 2. 工程 1 回分の記録
CREATE TABLE IF NOT EXISTS public.article_job_steps (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id uuid NOT NULL REFERENCES public.article_jobs(id) ON DELETE CASCADE,
  step text NOT NULL,
  attempt integer NOT NULL DEFAULT 1,
  status text NOT NULL DEFAULT 'running',
  output jsonb,
  provider text,
  model text,
  tokens jsonb,
  search_count integer NOT NULL DEFAULT 0,
  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  error text,
  CONSTRAINT article_job_steps_status_check CHECK (status IN ('running', 'completed', 'failed'))
);

CREATE INDEX IF NOT EXISTS idx_article_job_steps_job ON public.article_job_steps (job_id, started_at);

-- 3. 権限: 画面からは読むだけ（作成・やり直し・キャンセルは Edge Function がサービスロールで行う）
ALTER TABLE public.article_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.article_job_steps ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admins can read article_jobs" ON public.article_jobs;
CREATE POLICY "Admins can read article_jobs" ON public.article_jobs
  FOR SELECT TO authenticated USING (public.is_admin());

DROP POLICY IF EXISTS "Users can read own article_jobs" ON public.article_jobs;
CREATE POLICY "Users can read own article_jobs" ON public.article_jobs
  FOR SELECT TO authenticated USING (user_id = auth.uid());

DROP POLICY IF EXISTS "Read steps of visible article_jobs" ON public.article_job_steps;
CREATE POLICY "Read steps of visible article_jobs" ON public.article_job_steps
  FOR SELECT TO authenticated USING (
    EXISTS (
      SELECT 1 FROM public.article_jobs j
      WHERE j.id = article_job_steps.job_id
        AND (public.is_admin() OR j.user_id = auth.uid())
    )
  );

-- 4. 次に進めるジョブを 1 件だけ取り、ロックする（同じジョブを 2 か所で同時に進めないため）
CREATE OR REPLACE FUNCTION public.claim_article_job(p_lock_seconds integer DEFAULT 170, p_job_id uuid DEFAULT NULL)
RETURNS SETOF public.article_jobs
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id uuid;
BEGIN
  SELECT id INTO v_id
  FROM public.article_jobs
  WHERE status IN ('queued', 'running')
    AND (locked_until IS NULL OR locked_until < now())
    AND (p_job_id IS NULL OR id = p_job_id)
  ORDER BY created_at
  LIMIT 1
  FOR UPDATE SKIP LOCKED;

  IF v_id IS NULL THEN
    RETURN;
  END IF;

  RETURN QUERY
  UPDATE public.article_jobs
  SET status = 'running',
      locked_until = now() + make_interval(secs => GREATEST(30, p_lock_seconds)),
      updated_at = now()
  WHERE id = v_id
  RETURNING *;
END;
$$;

REVOKE ALL ON FUNCTION public.claim_article_job(integer, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.claim_article_job(integer, uuid) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_article_job(integer, uuid) TO service_role;

COMMENT ON TABLE public.article_jobs IS '記事作成の新方式（v2）のジョブ。1 行 = 記事 1 本';
COMMENT ON TABLE public.article_job_steps IS '記事作成の新方式（v2）の工程の記録。1 行 = 工程 1 回分';

-- 5. スケジュールで使う方式（段階 4）。既定は今の方式のまま
ALTER TABLE public.schedule_settings
ADD COLUMN IF NOT EXISTS pipeline_mode text NOT NULL DEFAULT 'classic';

ALTER TABLE public.schedule_settings
DROP CONSTRAINT IF EXISTS schedule_settings_pipeline_mode_check;

ALTER TABLE public.schedule_settings
ADD CONSTRAINT schedule_settings_pipeline_mode_check
CHECK (pipeline_mode IN ('classic', 'v2'));

COMMENT ON COLUMN public.schedule_settings.pipeline_mode IS
'classic: 今の方式（1 回の実行で最後まで作る） / v2: 新方式（工程ごとに分けて実行する。article_jobs）';

-- 6. 定期実行（毎分）は環境ごとの URL とキーが必要なため、ここでは作らない。
--    docs/article-pipeline-v2-setup.md の SQL を SQL Editor で実行する。
