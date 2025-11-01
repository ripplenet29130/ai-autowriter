// src/supabase/testConnection.ts
import { supabase } from "@/lib/supabaseClient"; // ✅ これだけでOK

// --- 接続テスト関数 ---
export async function testSupabaseConnection() {
  console.log("🔍 Supabase接続テストを開始します...");

  const { data, error } = await supabase
    .from("ai_configs") // どのテーブルでもOK
    .select("*")
    .limit(1);

  if (error) {
    console.error("❌ 接続エラー:", error.message);
  } else {
    console.log("✅ Supabase接続成功！");
    console.log("取得データ:", data);
  }
}
