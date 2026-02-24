/*
  # 郢ｧ・ｹ郢ｧ・ｱ郢ｧ・ｸ郢晢ｽ･郢晢ｽｼ郢晢ｽｩ郢晢ｽｼ郢ｧ・ｷ郢ｧ・ｹ郢昴・ﾎ帝包ｽｨ郢昴・繝ｻ郢晄じﾎ晁抄諛医・

  ## 隴・ｽｰ髫穂ｸ翫Θ郢晢ｽｼ郢晄じﾎ・
  
  ### `wordpress_configs`
  - `id` (uuid, primary key) - 髫ｪ・ｭ陞ｳ蜚妊
  - `name` (text) - 髫ｪ・ｭ陞ｳ螢ｼ骭・
  - `url` (text) - WordPress URL
  - `username` (text) - WordPress郢晢ｽｦ郢晢ｽｼ郢ｧ・ｶ郢晢ｽｼ陷ｷ繝ｻ
  - `password` (text) - WordPress郢昜ｻ｣縺帷ｹ晢ｽｯ郢晢ｽｼ郢昜ｼ夲ｽｼ蝓溷專陷ｿ・ｷ陋ｹ蛹∬ｳ陞ゑｽｨ繝ｻ繝ｻ
  - `category` (text) - 郢昴・繝ｵ郢ｧ・ｩ郢晢ｽｫ郢晏現縺咲ｹ昴・縺也ｹ晢ｽｪ
  - `is_active` (boolean) - 郢ｧ・｢郢ｧ・ｯ郢昴・縺・ｹ晄じ繝ｵ郢晢ｽｩ郢ｧ・ｰ
  - `created_at` (timestamptz) - 闖ｴ諛医・隴鯉ｽ･隴弱・
  - `updated_at` (timestamptz) - 隴厄ｽｴ隴・ｽｰ隴鯉ｽ･隴弱・

  ### `schedule_settings`
  - `id` (uuid, primary key) - 郢ｧ・ｹ郢ｧ・ｱ郢ｧ・ｸ郢晢ｽ･郢晢ｽｼ郢晢ｽｫID
  - `wordpress_config_id` (uuid, foreign key) - WordPress髫ｪ・ｭ陞ｳ蜚妊
  - `is_active` (boolean) - 郢ｧ・ｹ郢ｧ・ｱ郢ｧ・ｸ郢晢ｽ･郢晢ｽｼ郢晢ｽｫ隴帷甥譟醍ｹ晁ｼ釆帷ｹｧ・ｰ
  - `frequency` (text) - 陞ｳ貅ｯ・｡遒・｣ｰ・ｻ陟趣ｽｦ繝ｻ繝ｻaily, weekly, biweekly, monthly繝ｻ繝ｻ
  - `time` (text) - 陞ｳ貅ｯ・｡譴ｧ蜃ｾ陋ｻ・ｻ繝ｻ繝ｻH:mm陟厄ｽ｢陟第得・ｼ繝ｻ
  - `target_keywords` (jsonb) - 郢ｧ・ｿ郢晢ｽｼ郢ｧ・ｲ郢昴・繝ｨ郢ｧ・ｭ郢晢ｽｼ郢晢ｽｯ郢晢ｽｼ郢晁崟繝ｻ陋ｻ繝ｻ
  - `publish_status` (text) - 隰壽・・ｨ・ｿ郢ｧ・ｹ郢昴・繝ｻ郢ｧ・ｿ郢ｧ・ｹ繝ｻ繝ｻublish, draft繝ｻ繝ｻ
  - `created_at` (timestamptz) - 闖ｴ諛医・隴鯉ｽ･隴弱・
  - `updated_at` (timestamptz) - 隴厄ｽｴ隴・ｽｰ隴鯉ｽ･隴弱・

  ### `ai_configs`
  - `id` (uuid, primary key) - AI髫ｪ・ｭ陞ｳ蜚妊
  - `provider` (text) - AI郢晏干ﾎ溽ｹ晁・縺・ｹ敖郢晢ｽｼ繝ｻ繝ｻpenai, claude, gemini繝ｻ繝ｻ
  - `api_key` (text) - API郢ｧ・ｭ郢晢ｽｼ繝ｻ蝓溷專陷ｿ・ｷ陋ｹ蛹∬ｳ陞ゑｽｨ繝ｻ繝ｻ
  - `model` (text) - 郢晢ｽ｢郢昴・ﾎ晁惺繝ｻ
  - `temperature` (decimal) - Temperature髫ｪ・ｭ陞ｳ繝ｻ
  - `max_tokens` (integer) - Max Tokens髫ｪ・ｭ陞ｳ繝ｻ
  - `created_at` (timestamptz) - 闖ｴ諛医・隴鯉ｽ･隴弱・
  - `updated_at` (timestamptz) - 隴厄ｽｴ隴・ｽｰ隴鯉ｽ･隴弱・

  ### `execution_history`
  - `id` (uuid, primary key) - 陞ｳ貅ｯ・｡謔滂ｽｱ・･雎・ｽｴID
  - `schedule_id` (uuid, foreign key) - 郢ｧ・ｹ郢ｧ・ｱ郢ｧ・ｸ郢晢ｽ･郢晢ｽｼ郢晢ｽｫID
  - `wordpress_config_id` (uuid, foreign key) - WordPress髫ｪ・ｭ陞ｳ蜚妊
  - `executed_at` (timestamptz) - 陞ｳ貅ｯ・｡譴ｧ蠕玖ｭ弱・
  - `keyword_used` (text) - 闖ｴ・ｿ騾包ｽｨ邵ｺ霈費ｽ檎ｸｺ貅倥￥郢晢ｽｼ郢晢ｽｯ郢晢ｽｼ郢昴・
  - `article_title` (text) - 騾墓ｻ薙・邵ｺ霈費ｽ檎ｸｺ貅ｯ・ｨ蛟・ｽｺ荵昴■郢ｧ・､郢晏現ﾎ・
  - `wordpress_post_id` (text) - WordPress邵ｺ・ｮ隰壽・・ｨ・ｿID
  - `status` (text) - 陞ｳ貅ｯ・｡蠕後○郢昴・繝ｻ郢ｧ・ｿ郢ｧ・ｹ繝ｻ繝ｻuccess, failed繝ｻ繝ｻ
  - `error_message` (text) - 郢ｧ・ｨ郢晢ｽｩ郢晢ｽｼ郢晢ｽ｡郢昴・縺晉ｹ晢ｽｼ郢ｧ・ｸ繝ｻ莠･・､・ｱ隰ｨ邇ｲ蜃ｾ繝ｻ繝ｻ
  - `created_at` (timestamptz) - 闖ｴ諛医・隴鯉ｽ･隴弱・

  ## 郢ｧ・ｻ郢ｧ・ｭ郢晢ｽ･郢晢ｽｪ郢昴・縺・
  - 邵ｺ蜷ｶ竏狗ｸｺ・ｦ邵ｺ・ｮ郢昴・繝ｻ郢晄じﾎ晉ｸｺ・ｧRLS郢ｧ蜻域剰怏・ｹ陋ｹ繝ｻ
  - 陋ｹ・ｿ陷ｷ髦ｪﾎ倡ｹ晢ｽｼ郢ｧ・ｶ郢晢ｽｼ邵ｺ・ｧ郢ｧ繧奇ｽｪ・ｭ邵ｺ・ｿ隴厄ｽｸ邵ｺ讎雁ｺ・妙・ｽ繝ｻ蛹ｻ縺咏ｹ晢ｽｳ郢晏干ﾎ晉ｸｺ・ｪ陞ｳ貅ｯ・｣繝ｻ繝ｻ邵ｺ貅假ｽ√・繝ｻ
  - 隴幢ｽｬ騾｡・ｪ霑ｺ・ｰ陟・・縲堤ｸｺ・ｯ髫ｱ蟠趣ｽｨ・ｼ郢ｧ螳夲ｽｿ・ｽ陷会｣ｰ隰暦ｽｨ陞ゑｽｨ
*/

-- WordPress髫ｪ・ｭ陞ｳ螢ｹ繝ｦ郢晢ｽｼ郢晄じﾎ・
CREATE TABLE IF NOT EXISTS wordpress_configs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  url text NOT NULL,
  username text NOT NULL,
  password text NOT NULL,
  category text DEFAULT '',
  is_active boolean DEFAULT false,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- 郢ｧ・ｹ郢ｧ・ｱ郢ｧ・ｸ郢晢ｽ･郢晢ｽｼ郢晢ｽｫ髫ｪ・ｭ陞ｳ螢ｹ繝ｦ郢晢ｽｼ郢晄じﾎ・
CREATE TABLE IF NOT EXISTS schedule_settings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  wordpress_config_id uuid REFERENCES wordpress_configs(id) ON DELETE CASCADE,
  is_active boolean DEFAULT false,
  frequency text DEFAULT 'daily',
  time text DEFAULT '09:00',
  target_keywords jsonb DEFAULT '[]'::jsonb,
  publish_status text DEFAULT 'draft',
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- AI髫ｪ・ｭ陞ｳ螢ｹ繝ｦ郢晢ｽｼ郢晄じﾎ・
CREATE TABLE IF NOT EXISTS ai_configs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider text NOT NULL,
  api_key text NOT NULL,
  model text NOT NULL,
  temperature decimal DEFAULT 0.7,
  max_tokens integer DEFAULT 4000,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- 陞ｳ貅ｯ・｡謔滂ｽｱ・･雎・ｽｴ郢昴・繝ｻ郢晄じﾎ・
CREATE TABLE IF NOT EXISTS execution_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  schedule_id uuid REFERENCES schedule_settings(id) ON DELETE CASCADE,
  wordpress_config_id uuid REFERENCES wordpress_configs(id) ON DELETE CASCADE,
  executed_at timestamptz DEFAULT now(),
  keyword_used text,
  article_title text,
  wordpress_post_id text,
  status text DEFAULT 'pending',
  error_message text,
  created_at timestamptz DEFAULT now()
);

-- 郢ｧ・､郢晢ｽｳ郢昴・繝｣郢ｧ・ｯ郢ｧ・ｹ闖ｴ諛医・
CREATE INDEX IF NOT EXISTS idx_schedule_settings_wordpress_config ON schedule_settings(wordpress_config_id);
CREATE INDEX IF NOT EXISTS idx_execution_history_schedule ON execution_history(schedule_id);
CREATE INDEX IF NOT EXISTS idx_execution_history_executed_at ON execution_history(executed_at DESC);

-- RLS隴帷甥譟題峪繝ｻ
ALTER TABLE wordpress_configs ENABLE ROW LEVEL SECURITY;
ALTER TABLE schedule_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_configs ENABLE ROW LEVEL SECURITY;
ALTER TABLE execution_history ENABLE ROW LEVEL SECURITY;

-- RLS郢晄亢ﾎ懃ｹｧ・ｷ郢晢ｽｼ繝ｻ莠･繝ｻ郢晢ｽｦ郢晢ｽｼ郢ｧ・ｶ郢晢ｽｼ邵ｺ蠕後＞郢ｧ・ｯ郢ｧ・ｻ郢ｧ・ｹ陷ｿ・ｯ髢ｭ・ｽ - 郢ｧ・ｷ郢晢ｽｳ郢晏干ﾎ晉ｸｺ・ｪ陞ｳ貅ｯ・｣繝ｻ・ｼ繝ｻ
CREATE POLICY "Allow all access to wordpress_configs"
  ON wordpress_configs
  FOR ALL
  TO anon
  USING (true)
  WITH CHECK (true);

CREATE POLICY "Allow all access to schedule_settings"
  ON schedule_settings
  FOR ALL
  TO anon
  USING (true)
  WITH CHECK (true);

CREATE POLICY "Allow all access to ai_configs"
  ON ai_configs
  FOR ALL
  TO anon
  USING (true)
  WITH CHECK (true);

CREATE POLICY "Allow all access to execution_history"
  ON execution_history
  FOR ALL
  TO anon
  USING (true)
  WITH CHECK (true);

-- 隴厄ｽｴ隴・ｽｰ隴鯉ｽ･隴弱ｅ繝ｻ髢ｾ・ｪ陷榊｢灘ｳｩ隴・ｽｰ郢晏現ﾎ懃ｹｧ・ｬ郢晢ｽｼ
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ language 'plpgsql';

CREATE TRIGGER update_wordpress_configs_updated_at BEFORE UPDATE
  ON wordpress_configs FOR EACH ROW EXECUTE PROCEDURE update_updated_at_column();

CREATE TRIGGER update_schedule_settings_updated_at BEFORE UPDATE
  ON schedule_settings FOR EACH ROW EXECUTE PROCEDURE update_updated_at_column();
