import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";

type ResetClientPasswordRequest = {
  account_id: string;
  password: string;
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || Deno.env.get("SERVICE_ROLE_KEY");
  if (!supabaseUrl || !anonKey || !serviceRoleKey) {
    return json({ error: "Supabase function environment is not configured." }, 500);
  }

  const authorization = req.headers.get("Authorization");
  if (!authorization) return json({ error: "Authorization header is required." }, 401);

  const userClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authorization } },
  });
  const { data: isAdmin, error: adminError } = await userClient.rpc("is_admin");
  if (adminError || !isAdmin) return json({ error: "Admin permission is required." }, 403);

  let body: ResetClientPasswordRequest;
  try {
    body = await req.json();
  } catch {
    return json({ error: "Invalid JSON body." }, 400);
  }

  const accountId = String(body.account_id ?? "").trim();
  const password = String(body.password ?? "");
  if (!accountId) return json({ error: "account_id is required." }, 400);
  if (password.length < 8) return json({ error: "password must be at least 8 characters." }, 400);

  const adminClient = createClient(supabaseUrl, serviceRoleKey);
  const { data: profile, error: profileError } = await adminClient
    .from("profiles")
    .select("user_id")
    .eq("account_id", accountId)
    .eq("role", "client")
    .maybeSingle();
  if (profileError) return json({ error: profileError.message }, 500);
  if (!profile) return json({ error: "No client login is registered for this account." }, 404);

  const { error: updateError } = await adminClient.auth.admin.updateUserById(profile.user_id, { password });
  if (updateError) return json({ error: updateError.message }, 500);

  return json({ success: true });
});
