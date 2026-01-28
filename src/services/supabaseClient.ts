import { createClient } from "@supabase/supabase-js";

// --- フロントエンド用設定 ---
const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

import type { SupabaseClient } from '@supabase/supabase-js';

let supabase: SupabaseClient | null = null;

if (supabaseUrl && supabaseKey) {
  supabase = createClient(supabaseUrl, supabaseKey);
  console.log("✅ Supabase initialized");
} else {
  console.warn("⚠️ Supabase credentials not found. Database disabled.");
}

export { supabase };
