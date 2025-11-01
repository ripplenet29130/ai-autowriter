// src/lib/supabaseClient.ts
import { createClient } from "@supabase/supabase-js";

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL!;
const supabaseKey = import.meta.env.VITE_SUPABASE_ANON_KEY!;

// ⚙️ Supabaseクライアントを一度だけ初期化
export const supabase = createClient(supabaseUrl, supabaseKey);


export type AIConfig = {
  id: string;
  provider: string;
  api_key: string;
  model: string;
  temperature: number;
  max_tokens: number;
  enable_image: boolean;
  created_at: string;
};

export type WPConfig = {
  id: string;
  name: string;
  url: string;
  username: string;
  app_password: string;
  default_category: string;
  is_active: boolean;
  created_at: string;
};

export type ScheduleSetting = {
  id: string;
  ai_config_id: string;
  wp_config_id: string;
  time: string;
  frequency: string;
  status: boolean;
  last_run_at: string | null;
  next_run_at: string | null;
  created_at: string;
};
