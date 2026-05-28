import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

type GoogleTokenResponse = {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  scope?: string;
  error?: string;
  error_description?: string;
};

const GSC_SCOPE = "https://www.googleapis.com/auth/webmasters.readonly";

serve(async (req) => {
  const requestUrl = new URL(req.url);
  const code = requestUrl.searchParams.get("code");
  const state = requestUrl.searchParams.get("state");
  const oauthError = requestUrl.searchParams.get("error");

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || Deno.env.get("SERVICE_ROLE_KEY");
  const googleClientId = Deno.env.get("GOOGLE_CLIENT_ID");
  const googleClientSecret = Deno.env.get("GOOGLE_CLIENT_SECRET");

  if (!supabaseUrl || !serviceRoleKey || !googleClientId || !googleClientSecret) {
    return redirectWithFallback(null, "config_missing");
  }

  const adminClient = createClient(supabaseUrl, serviceRoleKey);
  const stateRow = state
    ? await loadState(adminClient, state)
    : null;

  if (!stateRow) {
    return redirectWithFallback(null, "invalid_state");
  }

  await adminClient.from("gsc_oauth_states").delete().eq("state", stateRow.state);

  if (oauthError) {
    return redirectWithFallback(stateRow.redirect_to, oauthError);
  }

  if (!code) {
    return redirectWithFallback(stateRow.redirect_to, "missing_code");
  }

  const callbackUrl = `${supabaseUrl.replace(/\/+$/, "")}/functions/v1/gsc-oauth-callback`;
  const tokenResponse = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      client_id: googleClientId,
      client_secret: googleClientSecret,
      code,
      grant_type: "authorization_code",
      redirect_uri: callbackUrl,
    }),
  });

  const tokenData = await tokenResponse.json() as GoogleTokenResponse;
  if (!tokenResponse.ok || !tokenData.access_token) {
    console.error("[GSC OAuth] Token exchange failed:", tokenData);
    return redirectWithFallback(stateRow.redirect_to, tokenData.error || "token_exchange_failed");
  }

  const scopes = typeof tokenData.scope === "string" ? tokenData.scope.split(" ") : [];
  if (!scopes.includes(GSC_SCOPE)) {
    return redirectWithFallback(stateRow.redirect_to, "missing_scope");
  }

  const { data: existingToken, error: existingError } = await adminClient
    .from("gsc_tokens")
    .select("provider_refresh_token")
    .eq("user_id", stateRow.user_id)
    .maybeSingle();

  if (existingError) {
    console.error("[GSC OAuth] Failed to load existing token:", existingError);
    return redirectWithFallback(stateRow.redirect_to, "token_load_failed");
  }

  const refreshTokenToSave =
    tokenData.refresh_token || existingToken?.provider_refresh_token || null;
  const expiresIn = Math.max(60, Number(tokenData.expires_in ?? 3500));
  const expiresAt = new Date(Date.now() + expiresIn * 1000).toISOString();

  const { error: upsertError } = await adminClient
    .from("gsc_tokens")
    .upsert(
      {
        user_id: stateRow.user_id,
        account_id: stateRow.account_id,
        provider_token: tokenData.access_token,
        provider_refresh_token: refreshTokenToSave,
        expires_at: expiresAt,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "user_id" },
    );

  if (upsertError) {
    console.error("[GSC OAuth] Failed to save token:", upsertError);
    return redirectWithFallback(stateRow.redirect_to, "token_save_failed");
  }

  const redirectUrl = new URL(stateRow.redirect_to);
  redirectUrl.searchParams.set("gsc", "connected");
  redirectUrl.searchParams.set("gsc_refresh_token", refreshTokenToSave ? "1" : "0");

  return Response.redirect(redirectUrl.toString(), 302);
});

async function loadState(adminClient: ReturnType<typeof createClient>, state: string) {
  const { data, error } = await adminClient
    .from("gsc_oauth_states")
    .select("state,user_id,account_id,redirect_to,expires_at")
    .eq("state", state)
    .maybeSingle();

  if (error || !data) {
    console.error("[GSC OAuth] State lookup failed:", error);
    return null;
  }

  if (new Date(data.expires_at).getTime() < Date.now()) {
    await adminClient.from("gsc_oauth_states").delete().eq("state", state);
    return null;
  }

  return data as {
    state: string;
    user_id: string;
    account_id: string | null;
    redirect_to: string;
    expires_at: string;
  };
}

function redirectWithFallback(rawRedirectTo: string | null, errorCode: string) {
  const fallback = Deno.env.get("APP_ORIGIN") || "https://ai-autowriter.netlify.app";
  const redirectUrl = new URL(rawRedirectTo || fallback);
  redirectUrl.searchParams.set("gsc_error", errorCode);
  return Response.redirect(redirectUrl.toString(), 302);
}
