-- ファクトチェック後の自動修正モード追加
-- 作成日: 2026-02-13

ALTER TABLE fact_check_settings
ADD COLUMN IF NOT EXISTS auto_fix_enabled BOOLEAN DEFAULT false;

COMMENT ON COLUMN fact_check_settings.auto_fix_enabled IS 'ファクトチェックで問題検出時にAIで自動修正するか';
