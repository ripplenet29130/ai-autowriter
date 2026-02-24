-- Supabase Cron Job鬮ｫ・ｪ繝ｻ・ｭ髯橸ｽｳ郢晢ｽｻ
-- 驍ｵ・ｺ髦ｮ蜻ｻ・ｽ讙趣ｽｹ・ｧ隲｡繝ｻpabase SQL Editor驍ｵ・ｺ繝ｻ・ｧ髯橸ｽｳ雋・ｽｯ繝ｻ・｡陟暮ｯ会ｽｼ・ｰ驍ｵ・ｺ繝ｻ・ｦ驍ｵ・ｺ闕ｳ蟯ｩ蜻ｳ驍ｵ・ｺ髴郁ｲｻ・ｼ繝ｻ

-- 1. pg_cron髫ｲ・｡繝ｻ・｡髯滓汚・ｽ・ｵ驛｢・ｧ陷ｻ蝓淞蜑ｰ諤上・・ｹ髯具ｽｹ陷ｴ繝ｻ・ｽ・ｼ闔・･郢晢ｽｻ髯懃軸・ｧ・ｭ郢晢ｽｻ驍ｵ・ｺ繝ｻ・ｿ郢晢ｽｻ郢晢ｽｻ
CREATE EXTENSION IF NOT EXISTS pg_cron;

-- 2. 髮惹ｺ包ｽｸ・ｻ郢晢ｽｻ髯橸ｽｳ雋・ｽｯ繝ｻ・｡陟募ｨｯ繝ｻ驛｢・ｧ雎檎ｾ覚n Job (髯ｷ闌ｨ・ｽ・ｨ驛｢・ｧ繝ｻ・ｹ驛｢・ｧ繝ｻ・ｱ驛｢・ｧ繝ｻ・ｸ驛｢譎｢・ｽ・･驛｢譎｢・ｽ・ｼ驛｢譎｢・ｽ・ｫ驛｢・ｧ陋幢ｽｵ郢晢ｽ｡驛｢・ｧ繝ｻ・ｧ驛｢譏ｴ繝ｻ邵ｺ繝ｻ
-- 鬯ｩ・･陝雜｣・ｽ・ｦ郢晢ｽｻ Supabase驍ｵ・ｺ繝ｻ・ｮ驛｢・ｧ繝ｻ・ｵ驛｢譎｢・ｽ・ｼ驛｢譎√・郢晢ｽｻ髫ｴ蠑ｱ・玖将・｣驍ｵ・ｺ繝ｻ・ｯUTC驍ｵ・ｺ繝ｻ・ｧ驍ｵ・ｺ陷ｷ・ｶ遯ｶ・ｲ驍ｵ・ｲ遶丞｣ｹ・樣Δ譎丞ｹｲ・取㊥螻√・・ｴ驍ｵ・ｺ繝ｻ・ｯJST(髫ｴ魃会ｽｽ・･髫ｴ蟷｢・ｽ・ｬ髫ｴ蠑ｱ・玖将・｣)驍ｵ・ｺ繝ｻ・ｧ鬮ｫ・ｪ髢ｧ・ｲ繝ｻ・ｮ陷会ｽｱ隨倥・・ｹ・ｧ闕ｵ譎｢・ｽ閧ｲ・ｸ・ｺ郢晢ｽｻ遶頑･｢蟆・・・ｮ髮弱・・ｽ・｣髮九ｇ迴ｾ遶擾ｽｩ驍ｵ・ｺ繝ｻ・ｧ驍ｵ・ｺ陷ｷ・ｶ・つ郢晢ｽｻ
-- YOUR_PROJECT_REF 驍ｵ・ｺ繝ｻ・ｨ YOUR_ANON_KEY 驛｢・ｧ陋幢ｽｵ繝ｻ繝ｻ譏弱・・ｪ鬮ｴ繝ｻ・ｽ・ｫ驍ｵ・ｺ繝ｻ・ｮ驛｢・ｧ郢ｧ繝ｻ繝ｻ驍ｵ・ｺ繝ｻ・ｫ鬩励ｑ・ｽ・ｮ驍ｵ・ｺ髢ｧ・ｴ鬩ｪ・､驍ｵ・ｺ陋ｹ・ｻ遯ｶ・ｻ驍ｵ・ｺ闕ｳ蟯ｩ蜻ｳ驍ｵ・ｺ髴郁ｲｻ・ｼ讓抵ｽｸ・ｲ郢晢ｽｻ
SELECT cron.schedule(
    'article-scheduler-check',   -- 驛｢・ｧ繝ｻ・ｸ驛｢譎｢・ｽ・ｧ驛｢譎樊束鬪ｭ繝ｻ
    '* * * * *',                 -- 髮惹ｺ包ｽｸ・ｻ郢晢ｽｻ髯橸ｽｳ雋・ｽｯ繝ｻ・｡郢晢ｽｻ
    $$
    SELECT
      net.http_post(
          url:='https://YOUR_PROJECT_REF.supabase.co/functions/v1/scheduler-executor',
          headers:='{"Content-Type": "application/json", "Authorization": "Bearer YOUR_ANON_KEY"}'::jsonb,
          body:='{"forceExecute": false}'::jsonb
      ) as request_id;
    $$
);

-- 3. Cron Job驍ｵ・ｺ繝ｻ・ｮ鬩墓慣・ｽ・ｺ鬮ｫ・ｱ郢晢ｽｻ
SELECT * FROM cron.job;

-- 4. Cron Job驍ｵ・ｺ繝ｻ・ｮ髯ｷ蜿ｰ・ｼ竏晄ｱらｹ晢ｽｻ闔・･繝ｻ・ｿ郢晢ｽｻ繝ｻ・ｦ遶丞｣ｺ繝ｻ髯懶ｽ｣繝ｻ・ｴ髯ｷ・ｷ髣鯉ｽｨ繝ｻ・ｼ郢晢ｽｻ
-- SELECT cron.unschedule('daily-article-generation');
