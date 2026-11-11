-- 記事品質改善（Cプラン）: スケジュールごとの品質モードと参考資料の付記
ALTER TABLE public.schedule_settings
ADD COLUMN IF NOT EXISTS quality_mode text NOT NULL DEFAULT 'high',
ADD COLUMN IF NOT EXISTS append_references boolean NOT NULL DEFAULT true;

ALTER TABLE public.schedule_settings
DROP CONSTRAINT IF EXISTS schedule_settings_quality_mode_check;

ALTER TABLE public.schedule_settings
ADD CONSTRAINT schedule_settings_quality_mode_check
CHECK (quality_mode IN ('high', 'standard'));

COMMENT ON COLUMN public.schedule_settings.quality_mode IS
'high: 本文の執筆と見直しに上位モデル（Gemini 3.1 Pro）を使う / standard: すべて基本モデル';

COMMENT ON COLUMN public.schedule_settings.append_references IS
'記事末に参考資料（根拠メモの出典）を付けるか';
