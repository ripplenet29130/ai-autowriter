import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";

type SaveGscTokenRequest = {
  provider_token?: string;
  provider_refresh_token?: string | null;
  expires_in?: number | null;
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return json({ error: "Method not allowed." }, 405);
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || Deno.env.get("SERVICE_ROLE_KEY");

  if (!supabaseUrl || !anonKey || !serviceRoleKey) {
    return json({ error: "Supabase function environment is not configured." }, 500);
  }

  const authorization = req.headers.get("Authorization");
  if (!authorization) {
    return json({ error: "Authorization header is required." }, 401);
  }

  const userClient = createClient(supabaseUrl, anonKey, {
    global: {
      headers: { Authorization: authorization },
    },
  });

  const { data: userData, error: userError } = await userClient.auth.getUser();
  const user = userData.user;

  if (userError || !user) {
    return json({ error: "Authenticated user is required." }, 401);
  }

  let body: SaveGscTokenRequest;
  try {
    body = await req.json();
  } catch {
    return json({ error: "Invalid JSON body." }, 400);
  }

  const providerToken = String(body.provider_token ?? "").trim();
  const providerRefreshToken = typeof body.provider_refresh_token === "string"
    ? body.provider_refresh_token.trim()
    : "";
  const expiresIn = Number.isFinite(Number(body.expires_in))
    ? Math.max(60, Number(body.expires_in))
    : 3500;

  if (!providerToken) {
    return json({ error: "provider_token is required." }, 400);
  }

  const adminClient = createClient(supabaseUrl, serviceRoleKey);

  const { data: profile, error: profileError } = await adminClient
    .from("profiles")
    .select("account_id")
    .eq("user_id", user.id)
    .maybeSingle();

  if (profileError) {
    return json({ error: profileError.message }, 500);
  }

  if (!profile?.account_id) {
    return json({ error: "Active account is required." }, 400);
  }

  let { data: existingToken, error: existingError } = await adminClient
    .from("gsc_tokens")
    .select("user_id,provider_refresh_token")
    .eq("account_id", profile.account_id)
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (existingError) {
    return json({ error: existingError.message }, 500);
  }

  if (!existingToken) {
    const fallbackResult = await adminClient
      .from("gsc_tokens")
      .select("user_id,provider_refresh_token")
      .eq("user_id", user.id)
      .maybeSingle();

    if (fallbackResult.error) {
      return json({ error: fallbackResult.error.message }, 500);
    }

    existingToken = fallbackResult.data;
  }

  const refreshTokenToSave =
    providerRefreshToken || existingToken?.provider_refresh_token || null;
  const expiresAt = new Date(Date.now() + expiresIn * 1000).toISOString();

  const savePayload = {
    account_id: profile.account_id,
    provider_token: providerToken,
    provider_refresh_token: refreshTokenToSave,
    expires_at: expiresAt,
    updated_at: new Date().toISOString(),
  };

  const saveResult = existingToken?.user_id
    ? await adminClient
      .from("gsc_tokens")
      .update(savePayload)
      .eq("user_id", existingToken.user_id)
    : await adminClient
      .from("gsc_tokens")
      .insert({
        user_id: user.id,
        ...savePayload,
      });

  if (saveResult.error) {
    return json({ error: saveResult.error.message }, 500);
  }

  return json({
    saved: true,
    expires_at: expiresAt,
    has_refresh_token: Boolean(refreshTokenToSave),
  });
});

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json",
    },
  });
