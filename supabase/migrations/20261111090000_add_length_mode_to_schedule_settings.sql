-- 記事改善プラン 段階 1（文字数おまかせ）: スケジュールごとの文字数の決め方
-- 既存のスケジュールは今の文字数指定のまま（fixed）にし、新しく作るスケジュールの既定は auto にする
ALTER TABLE public.schedule_settings
ADD COLUMN IF NOT EXISTS length_mode text NOT NULL DEFAULT 'fixed';

ALTER TABLE public.schedule_settings
ALTER COLUMN length_mode SET DEFAULT 'auto';

ALTER TABLE public.schedule_settings
DROP CONSTRAINT IF EXISTS schedule_settings_length_mode_check;

ALTER TABLE public.schedule_settings
ADD CONSTRAINT schedule_settings_length_mode_check
CHECK (length_mode IN ('auto', 'fixed'));

COMMENT ON COLUMN public.schedule_settings.length_mode IS
'auto: 調査をもとに AI が記事ごとに文字数を決める（1,500〜6,000字） / fixed: target_word_count を目安に使う';
