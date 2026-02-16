-- Enable A/B regression testing per schedule
ALTER TABLE schedule_settings
ADD COLUMN IF NOT EXISTS ab_test_enabled BOOLEAN NOT NULL DEFAULT false;

-- Store manual vs scheduler regression comparison scores
CREATE TABLE IF NOT EXISTS generation_regression_results (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  schedule_id UUID REFERENCES schedule_settings(id) ON DELETE CASCADE NOT NULL,
  execution_history_id UUID REFERENCES execution_history(id) ON DELETE SET NULL,
  user_id UUID,
  keyword TEXT NOT NULL,
  article_title TEXT NOT NULL,
  target_word_count INTEGER,
  writing_tone TEXT,
  baseline_mode TEXT NOT NULL DEFAULT 'manual',
  candidate_mode TEXT NOT NULL DEFAULT 'scheduler',
  metrics JSONB NOT NULL DEFAULT '{}'::jsonb,
  overall_score NUMERIC(5,2),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_generation_regression_schedule
  ON generation_regression_results(schedule_id);

CREATE INDEX IF NOT EXISTS idx_generation_regression_created_at
  ON generation_regression_results(created_at DESC);

CREATE INDEX IF NOT EXISTS idx_generation_regression_user
  ON generation_regression_results(user_id);

ALTER TABLE generation_regression_results ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view own regression results" ON generation_regression_results;
CREATE POLICY "Users can view own regression results"
  ON generation_regression_results FOR SELECT
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Service role can insert regression results" ON generation_regression_results;
CREATE POLICY "Service role can insert regression results"
  ON generation_regression_results FOR INSERT
  WITH CHECK (auth.role() = 'service_role');
