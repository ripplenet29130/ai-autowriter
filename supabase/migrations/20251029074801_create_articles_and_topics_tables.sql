/*
  # AI髫ｪ蛟・ｽｺ迢怜・隰瑚・縺咏ｹｧ・ｹ郢昴・ﾎ堤ｸｺ・ｮ郢昴・繝ｻ郢ｧ・ｿ闖ｫ譎擾ｽｭ菫ｶ・ｩ貅ｯ繝ｻ

  ## 隶弱ｊ・ｦ繝ｻ
  AI髫ｪ蛟・ｽｺ迢怜・隰瑚・縲定抄諛医・邵ｺ霈費ｽ檎ｸｺ貅ｯ・ｨ蛟・ｽｺ荵敖竏壹″郢ｧ・ｹ郢ｧ・ｿ郢晢｣ｰ郢晏現繝ｴ郢昴・縺醍ｸｲ竏ｫ蜃ｽ隰瑚・繝ｻ郢晢ｽｭ郢晢ｽｳ郢晏干繝ｨ郢ｧ蜻茨ｽｰ・ｸ驍ｯ螢ｼ蝟ｧ邵ｺ蜷ｶ・狗ｸｺ貅假ｽ∫ｸｺ・ｮ郢昴・繝ｻ郢晄じﾎ晉ｹｧ蜑・ｽｽ諛医・邵ｺ蜉ｱ竏ｪ邵ｺ蜷ｶﾂ繝ｻ

  ## 隴・ｽｰ髫穂ｸ翫Θ郢晢ｽｼ郢晄じﾎ・

  ### 1. articles繝ｻ驛・ｽｨ蛟・ｽｺ荵昴Θ郢晢ｽｼ郢晄じﾎ昴・繝ｻ
  騾墓ｻ薙・邵ｺ霈費ｽ檎ｸｺ貅ｯ・ｨ蛟・ｽｺ荵晢ｽ定将譎擾ｽｭ蛟･繝ｻ驍ゑｽ｡騾・・・邵ｺ・ｾ邵ｺ蜷ｶﾂ繝ｻ
  
  **郢ｧ・ｫ郢晢ｽｩ郢晢｣ｰ:**
  - `id` (uuid, primary key) - 髫ｪ蛟・ｽｺ邏D
  - `title` (text, required) - 髫ｪ蛟・ｽｺ荵昴■郢ｧ・､郢晏現ﾎ・
  - `content` (text, required) - 隴幢ｽｬ隴√・
  - `excerpt` (text) - 隰壽㏍・ｲ荵昴・髫補悪・ｴ繝ｻ
  - `keywords` (jsonb) - 郢ｧ・ｭ郢晢ｽｼ郢晢ｽｯ郢晢ｽｼ郢晁崟繝ｻ陋ｻ繝ｻ
  - `category` (text) - 郢ｧ・ｫ郢昴・縺也ｹ晢ｽｪ
  - `status` (text) - 霑･・ｶ隲ｷ繝ｻ 'draft' | 'scheduled' | 'published' | 'failed'
  - `tone` (text) - 郢晏現繝ｻ郢晢ｽｳ: 'professional' | 'casual' | 'technical' | 'friendly'
  - `length` (text) - 鬮滂ｽｷ邵ｺ繝ｻ 'short' | 'medium' | 'long'
  - `ai_provider` (text) - 闖ｴ・ｿ騾包ｽｨ邵ｺ蜉ｱ笳・I郢晏干ﾎ溽ｹ晁・縺・ｹ敖郢晢ｽｼ
  - `ai_model` (text) - 闖ｴ・ｿ騾包ｽｨ邵ｺ蜉ｱ笳・ｹ晢ｽ｢郢昴・ﾎ・
  - `scheduled_at` (timestamptz) - 陷茨ｽｬ鬮｢蛟ｶ・ｺ莠･・ｮ螢ｽ蠕玖ｭ弱・
  - `published_at` (timestamptz) - 陞ｳ貊・怙邵ｺ・ｮ陷茨ｽｬ鬮｢蛹ｺ蠕玖ｭ弱・
  - `wordpress_post_id` (text) - WordPress邵ｺ・ｮ隰壽・・ｨ・ｿID
  - `wordpress_config_id` (uuid) - 闖ｴ・ｿ騾包ｽｨ邵ｺ蜉ｱ笳・ordPress髫ｪ・ｭ陞ｳ繝ｻ
  - `seo_score` (integer) - SEO郢ｧ・ｹ郢ｧ・ｳ郢ｧ・｢
  - `reading_time` (integer) - 髫ｱ・ｭ闔繝ｻ蜃ｾ鬮｢髮｣・ｼ莠･繝ｻ繝ｻ繝ｻ
  - `word_count` (integer) - 隴√・・ｭ邇ｲ辟・
  - `trend_data` (jsonb) - 郢晏現ﾎ樒ｹ晢ｽｳ郢晉甥繝ｻ隴ｫ闊後Ι郢晢ｽｼ郢ｧ・ｿ
  - `created_at` (timestamptz) - 闖ｴ諛医・隴鯉ｽ･隴弱・
  - `updated_at` (timestamptz) - 隴厄ｽｴ隴・ｽｰ隴鯉ｽ･隴弱・

  ### 2. custom_topics繝ｻ蛹ｻ縺咲ｹｧ・ｹ郢ｧ・ｿ郢晢｣ｰ郢晏現繝ｴ郢昴・縺醍ｹ昴・繝ｻ郢晄じﾎ昴・繝ｻ
  郢晢ｽｦ郢晢ｽｼ郢ｧ・ｶ郢晢ｽｼ邵ｺ謔溘・陷牙ｸ呻ｼ邵ｺ貅倥″郢ｧ・ｹ郢ｧ・ｿ郢晢｣ｰ郢晏現繝ｴ郢昴・縺醍ｹｧ蜑・ｽｿ譎擾ｽｭ蛟･繝ｻ陷讎願懸騾包ｽｨ邵ｺ蜉ｱ竏ｪ邵ｺ蜷ｶﾂ繝ｻ
  
  **郢ｧ・ｫ郢晢ｽｩ郢晢｣ｰ:**
  - `id` (uuid, primary key) - 郢晏現繝ｴ郢昴・縺選D
  - `topic_name` (text, required) - 郢晏現繝ｴ郢昴・縺題惺繝ｻ
  - `keywords` (jsonb) - 鬮｢・｢鬨ｾ・｣郢ｧ・ｭ郢晢ｽｼ郢晢ｽｯ郢晢ｽｼ郢晁崟繝ｻ陋ｻ繝ｻ
  - `tone` (text) - 郢昴・繝ｵ郢ｧ・ｩ郢晢ｽｫ郢晏現繝ｨ郢晢ｽｼ郢晢ｽｳ
  - `length` (text) - 郢昴・繝ｵ郢ｧ・ｩ郢晢ｽｫ郢晉｣ｯ閨樒ｸｺ繝ｻ
  - `category` (text) - 郢ｧ・ｫ郢昴・縺也ｹ晢ｽｪ
  - `use_count` (integer) - 闖ｴ・ｿ騾包ｽｨ陜玲ｨ顔・
  - `last_used_at` (timestamptz) - 隴崢驍ｨ繧・ｽｽ・ｿ騾包ｽｨ隴鯉ｽ･隴弱・
  - `is_favorite` (boolean) - 邵ｺ鬆托ｽｰ蜉ｱ竊楢怦・･郢ｧ繝ｻ
  - `created_at` (timestamptz) - 闖ｴ諛医・隴鯉ｽ･隴弱・
  - `updated_at` (timestamptz) - 隴厄ｽｴ隴・ｽｰ隴鯉ｽ･隴弱・

  ### 3. generation_prompts繝ｻ閧ｲ蜃ｽ隰瑚・繝ｻ郢晢ｽｭ郢晢ｽｳ郢晏干繝ｨ郢昴・繝ｻ郢晄じﾎ昴・繝ｻ
  髫ｪ蛟・ｽｺ迢怜・隰悟・蜃ｾ邵ｺ・ｮ髫ｧ・ｳ驍擾ｽｰ邵ｺ・ｪ髫ｪ・ｭ陞ｳ螢ｹ・帝坎蛟ｬ鮖ｸ邵ｺ蜉ｱ竏ｪ邵ｺ蜷ｶﾂ繝ｻ
  
  **郢ｧ・ｫ郢晢ｽｩ郢晢｣ｰ:**
  - `id` (uuid, primary key) - 郢晏干ﾎ溽ｹ晢ｽｳ郢晏干繝ｨID
  - `article_id` (uuid, FK) - 鬮｢・｢鬨ｾ・｣邵ｺ蜷ｶ・矩坎蛟・ｽｺ邏D
  - `topic` (text) - 郢晏現繝ｴ郢昴・縺・
  - `keywords` (jsonb) - 郢ｧ・ｭ郢晢ｽｼ郢晢ｽｯ郢晢ｽｼ郢晁崟繝ｻ陋ｻ繝ｻ
  - `tone` (text) - 郢晏現繝ｻ郢晢ｽｳ
  - `length` (text) - 鬮滂ｽｷ邵ｺ繝ｻ
  - `include_introduction` (boolean) - 陝・ｸｻ繝ｻ鬩幢ｽｨ郢ｧ雋樊ｧ郢ｧﾂ邵ｺ繝ｻ
  - `include_conclusion` (boolean) - 驍ｨ蜊・ｫ謔ｶ・定惺・ｫ郢ｧﾂ邵ｺ繝ｻ
  - `include_sources` (boolean) - 陷・ｽｺ陷茨ｽｸ郢ｧ雋樊ｧ郢ｧﾂ邵ｺ繝ｻ
  - `use_trend_data` (boolean) - 郢晏現ﾎ樒ｹ晢ｽｳ郢晏ｳｨ繝ｧ郢晢ｽｼ郢ｧ・ｿ郢ｧ蜑・ｽｽ・ｿ騾包ｽｨ邵ｺ蜉ｱ笳・ｸｺ繝ｻ
  - `trend_analysis` (jsonb) - 郢晏現ﾎ樒ｹ晢ｽｳ郢晉甥繝ｻ隴ｫ蜊・ｽｵ蜈域｣｡
  - `created_at` (timestamptz) - 闖ｴ諛医・隴鯉ｽ･隴弱・

  ## 郢ｧ・ｻ郢ｧ・ｭ郢晢ｽ･郢晢ｽｪ郢昴・縺・
  - 陷茨ｽｨ郢昴・繝ｻ郢晄じﾎ晉ｸｺ・ｧRLS繝ｻ繝ｻow Level Security繝ｻ蟲ｨ・定ｭ帷甥譟題峪繝ｻ
  - 霑ｴ・ｾ隴弱ｉ縺帷ｸｺ・ｧ邵ｺ・ｯ陷茨ｽｨ郢晢ｽｦ郢晢ｽｼ郢ｧ・ｶ郢晢ｽｼ邵ｺ蠕後＞郢ｧ・ｯ郢ｧ・ｻ郢ｧ・ｹ陷ｿ・ｯ髢ｭ・ｽ繝ｻ驛・ｽｪ蟠趣ｽｨ・ｼ陞ｳ貅ｯ・｣繝ｻ・ｾ蠕娯・陋ｻ・ｶ鬮ｯ莉吝ｺ・妙・ｽ繝ｻ繝ｻ

  ## 郢昜ｻ｣繝ｵ郢ｧ・ｩ郢晢ｽｼ郢晄ｧｭﾎｦ郢ｧ・ｹ隴崢鬩包ｽｩ陋ｹ繝ｻ
  - 鬯・ｽｻ驛｢竏壺・闖ｴ・ｿ騾包ｽｨ邵ｺ霈費ｽ檎ｹｧ荵昴″郢晢ｽｩ郢晢｣ｰ邵ｺ・ｫ郢ｧ・､郢晢ｽｳ郢昴・繝｣郢ｧ・ｯ郢ｧ・ｹ郢ｧ蜑・ｽｽ諛医・
  - 郢ｧ・ｹ郢昴・繝ｻ郢ｧ・ｿ郢ｧ・ｹ郢ｧ繝ｻ蠕玖脂蛟･縲堤ｸｺ・ｮ隶諛・ｽｴ・｢郢ｧ蟶晢ｽｫ蛟ｬﾂ貅ｷ蝟ｧ
*/

-- =====================================================
-- 1. articles 郢昴・繝ｻ郢晄じﾎ・
-- =====================================================
CREATE TABLE IF NOT EXISTS articles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text NOT NULL,
  content text NOT NULL,
  excerpt text DEFAULT '',
  keywords jsonb DEFAULT '[]'::jsonb,
  category text DEFAULT '',
  status text DEFAULT 'draft',
  tone text DEFAULT 'professional',
  length text DEFAULT 'medium',
  ai_provider text DEFAULT '',
  ai_model text DEFAULT '',
  scheduled_at timestamptz,
  published_at timestamptz,
  wordpress_post_id text DEFAULT '',
  wordpress_config_id uuid,
  seo_score integer DEFAULT 0,
  reading_time integer DEFAULT 0,
  word_count integer DEFAULT 0,
  trend_data jsonb DEFAULT '{}'::jsonb,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- 郢ｧ・､郢晢ｽｳ郢昴・繝｣郢ｧ・ｯ郢ｧ・ｹ闖ｴ諛医・
CREATE INDEX IF NOT EXISTS idx_articles_status ON articles(status);
CREATE INDEX IF NOT EXISTS idx_articles_created_at ON articles(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_articles_wordpress_config_id ON articles(wordpress_config_id);
CREATE INDEX IF NOT EXISTS idx_articles_category ON articles(category);

-- 陞溷､慚夂ｹｧ・ｭ郢晢ｽｼ陋ｻ・ｶ驍上・
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints 
    WHERE constraint_name = 'articles_wordpress_config_id_fkey'
  ) THEN
    ALTER TABLE articles 
    ADD CONSTRAINT articles_wordpress_config_id_fkey 
    FOREIGN KEY (wordpress_config_id) 
    REFERENCES wordpress_configs(id) 
    ON DELETE SET NULL;
  END IF;
END $$;

-- RLS隴帷甥譟題峪繝ｻ
ALTER TABLE articles ENABLE ROW LEVEL SECURITY;

-- 陷茨ｽｨ郢晢ｽｦ郢晢ｽｼ郢ｧ・ｶ郢晢ｽｼ郢ｧ・｢郢ｧ・ｯ郢ｧ・ｻ郢ｧ・ｹ髫ｪ・ｱ陷ｿ・ｯ郢晄亢ﾎ懃ｹｧ・ｷ郢晢ｽｼ
CREATE POLICY "Allow all access to articles for now"
  ON articles
  FOR ALL
  TO public
  USING (true)
  WITH CHECK (true);

-- =====================================================
-- 2. custom_topics 郢昴・繝ｻ郢晄じﾎ・
-- =====================================================
CREATE TABLE IF NOT EXISTS custom_topics (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  topic_name text NOT NULL,
  keywords jsonb DEFAULT '[]'::jsonb,
  tone text DEFAULT 'professional',
  length text DEFAULT 'medium',
  category text DEFAULT '',
  use_count integer DEFAULT 0,
  last_used_at timestamptz DEFAULT now(),
  is_favorite boolean DEFAULT false,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- 郢ｧ・､郢晢ｽｳ郢昴・繝｣郢ｧ・ｯ郢ｧ・ｹ闖ｴ諛医・
CREATE INDEX IF NOT EXISTS idx_custom_topics_use_count ON custom_topics(use_count DESC);
CREATE INDEX IF NOT EXISTS idx_custom_topics_last_used_at ON custom_topics(last_used_at DESC);
CREATE INDEX IF NOT EXISTS idx_custom_topics_is_favorite ON custom_topics(is_favorite);

-- RLS隴帷甥譟題峪繝ｻ
ALTER TABLE custom_topics ENABLE ROW LEVEL SECURITY;

-- 陷茨ｽｨ郢晢ｽｦ郢晢ｽｼ郢ｧ・ｶ郢晢ｽｼ郢ｧ・｢郢ｧ・ｯ郢ｧ・ｻ郢ｧ・ｹ髫ｪ・ｱ陷ｿ・ｯ郢晄亢ﾎ懃ｹｧ・ｷ郢晢ｽｼ
CREATE POLICY "Allow all access to custom_topics for now"
  ON custom_topics
  FOR ALL
  TO public
  USING (true)
  WITH CHECK (true);

-- =====================================================
-- 3. generation_prompts 郢昴・繝ｻ郢晄じﾎ・
-- =====================================================
CREATE TABLE IF NOT EXISTS generation_prompts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  article_id uuid,
  topic text NOT NULL,
  keywords jsonb DEFAULT '[]'::jsonb,
  tone text DEFAULT 'professional',
  length text DEFAULT 'medium',
  include_introduction boolean DEFAULT true,
  include_conclusion boolean DEFAULT true,
  include_sources boolean DEFAULT true,
  use_trend_data boolean DEFAULT false,
  trend_analysis jsonb DEFAULT '{}'::jsonb,
  created_at timestamptz DEFAULT now()
);

-- 郢ｧ・､郢晢ｽｳ郢昴・繝｣郢ｧ・ｯ郢ｧ・ｹ闖ｴ諛医・
CREATE INDEX IF NOT EXISTS idx_generation_prompts_article_id ON generation_prompts(article_id);
CREATE INDEX IF NOT EXISTS idx_generation_prompts_created_at ON generation_prompts(created_at DESC);

-- 陞溷､慚夂ｹｧ・ｭ郢晢ｽｼ陋ｻ・ｶ驍上・
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints 
    WHERE constraint_name = 'generation_prompts_article_id_fkey'
  ) THEN
    ALTER TABLE generation_prompts 
    ADD CONSTRAINT generation_prompts_article_id_fkey 
    FOREIGN KEY (article_id) 
    REFERENCES articles(id) 
    ON DELETE CASCADE;
  END IF;
END $$;

-- RLS隴帷甥譟題峪繝ｻ
ALTER TABLE generation_prompts ENABLE ROW LEVEL SECURITY;

-- 陷茨ｽｨ郢晢ｽｦ郢晢ｽｼ郢ｧ・ｶ郢晢ｽｼ郢ｧ・｢郢ｧ・ｯ郢ｧ・ｻ郢ｧ・ｹ髫ｪ・ｱ陷ｿ・ｯ郢晄亢ﾎ懃ｹｧ・ｷ郢晢ｽｼ
CREATE POLICY "Allow all access to generation_prompts for now"
  ON generation_prompts
  FOR ALL
  TO public
  USING (true)
  WITH CHECK (true);

-- =====================================================
-- 4. updated_at髢ｾ・ｪ陷榊｢灘ｳｩ隴・ｽｰ郢晏現ﾎ懃ｹｧ・ｬ郢晢ｽｼ
-- =====================================================
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- articles郢昴・繝ｻ郢晄じﾎ晉ｸｺ・ｮ郢晏現ﾎ懃ｹｧ・ｬ郢晢ｽｼ
DROP TRIGGER IF EXISTS update_articles_updated_at ON articles;
CREATE TRIGGER update_articles_updated_at
  BEFORE UPDATE ON articles
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- custom_topics郢昴・繝ｻ郢晄じﾎ晉ｸｺ・ｮ郢晏現ﾎ懃ｹｧ・ｬ郢晢ｽｼ
DROP TRIGGER IF EXISTS update_custom_topics_updated_at ON custom_topics;
CREATE TRIGGER update_custom_topics_updated_at
  BEFORE UPDATE ON custom_topics
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();
