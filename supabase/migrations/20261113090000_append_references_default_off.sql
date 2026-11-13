-- 参考資料は記事本文に載せないのを基本にする（2026-11-13）
-- 今あるスケジュールもすべて OFF にする。載せたいスケジュールだけ画面で ON にする
ALTER TABLE public.schedule_settings
ALTER COLUMN append_references SET DEFAULT false;

UPDATE public.schedule_settings
SET append_references = false
WHERE append_references = true;

COMMENT ON COLUMN public.schedule_settings.append_references IS
'記事末に参考資料（出典のリンク）を付けるか。既定は付けない。付けない場合も出典は新方式のジョブ結果に残る';
