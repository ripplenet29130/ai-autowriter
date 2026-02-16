-- fact_check_results のRLSをユーザー単位に修正
-- 作成日: 2026-02-14

ALTER TABLE fact_check_results ENABLE ROW LEVEL SECURITY;

-- 既存の全公開ポリシーを削除
DROP POLICY IF EXISTS "Anyone can view fact check results" ON fact_check_results;

-- 既存のSELECTポリシーがあればクリア（再作成のため）
DROP POLICY IF EXISTS "Users can view their own fact check results" ON fact_check_results;

-- スケジュール所有者のみ閲覧可能
CREATE POLICY "Users can view their own fact check results"
  ON fact_check_results FOR SELECT
  USING (
    EXISTS (
      SELECT 1
      FROM schedule_settings s
      WHERE s.id = fact_check_results.schedule_id
        AND s.user_id = auth.uid()
    )
  );

-- 挿入は従来どおりサービスロール用途を維持
DROP POLICY IF EXISTS "Service role can insert fact check results" ON fact_check_results;
CREATE POLICY "Service role can insert fact check results"
  ON fact_check_results FOR INSERT
  WITH CHECK (true);
