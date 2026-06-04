import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";

type StatusRequest = {
  wordpress_config_id?: string;
};

type GscPropertyEntry = {
  siteUrl?: string;
  permissionLevel?: string;
};

const GSC_SCOPE = "https://www.googleapis.com/auth/webmasters.readonly";

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return json({ error: "Method not allowed." }, 405);
  }

  const env = getEnv();
  if (!env) {
    return json({ error: "GSC environment is not configured." }, 500);
  }

  const authorization = req.headers.get("Authorization");
  if (!authorization) {
    return json({ error: "Authorization header is required." }, 401);
  }

  const userClient = createClient(env.supabaseUrl, env.anonKey, {
    global: { headers: { Authorization: authorization } },
  });

  const { data: userData, error: userError } = await userClient.auth.getUser();
  const user = userData.user;
  if (userError || !user) {
    return json({ error: "Authenticated user is required." }, 401);
  }

  let body: StatusRequest;
  try {
    body = await req.json();
  } catch {
    return json({ error: "Invalid JSON body." }, 400);
  }

  const wordpressConfigId = String(body.wordpress_config_id ?? "").trim();
  if (!wordpressConfigId) {
    return json({ error: "wordpress_config_id is required." }, 400);
  }

  const adminClient = createClient(env.supabaseUrl, env.serviceRoleKey);
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

  const { data: wpConfig, error: wpError } = await adminClient
    .from("wordpress_configs")
    .select("id,account_id,name,url")
    .eq("id", wordpressConfigId)
    .eq("account_id", profile.account_id)
    .maybeSingle();

  if (wpError) {
    return json({ error: wpError.message }, 500);
  }

  if (!wpConfig) {
    return json({ error: "WordPress config was not found." }, 404);
  }

  const tokenResult = await getValidGscToken(adminClient, env, profile.account_id, user.id);
  if (!tokenResult.accessToken) {
    await saveStatus(adminClient, wordpressConfigId, profile.account_id, {
      verified: false,
      matched_property_url: null,
      error_code: tokenResult.errorCode,
      error_message: tokenResult.errorMessage,
    });

    return json({
      verified: false,
      matched_property_url: null,
      checked_at: new Date().toISOString(),
      error_code: tokenResult.errorCode,
      error_message: tokenResult.errorMessage,
    });
  }

  const propertiesResult = await listAccessibleGscProperties(tokenResult.accessToken);
  if (propertiesResult.error) {
    await saveStatus(adminClient, wordpressConfigId, profile.account_id, {
      verified: false,
      matched_property_url: null,
      error_code: propertiesResult.errorCode,
      error_message: propertiesResult.error,
    });

    return json({
      verified: false,
      matched_property_url: null,
      checked_at: new Date().toISOString(),
      error_code: propertiesResult.errorCode,
      error_message: propertiesResult.error,
    });
  }

  const matchedProperty =
    propertiesResult.properties.find((property) => matchesProperty(wpConfig.url, property)) ?? null;
  const statusPayload = {
    verified: Boolean(matchedProperty),
    matched_property_url: matchedProperty,
    error_code: matchedProperty ? null : "property_not_found",
    error_message: matchedProperty ? null : "Search Console property was not found for this WordPress URL.",
  };

  const saved = await saveStatus(adminClient, wordpressConfigId, profile.account_id, statusPayload);

  return json({
    ...saved,
    site_url: wpConfig.url,
  });
});

function getEnv() {
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || Deno.env.get("SERVICE_ROLE_KEY");
  const googleClientId = Deno.env.get("GOOGLE_CLIENT_ID");
  const googleClientSecret = Deno.env.get("GOOGLE_CLIENT_SECRET");

  if (!supabaseUrl || !anonKey || !serviceRoleKey || !googleClientId || !googleClientSecret) {
    return null;
  }

  return { supabaseUrl, anonKey, serviceRoleKey, googleClientId, googleClientSecret };
}

async function getValidGscToken(
  adminClient: ReturnType<typeof createClient>,
  env: NonNullable<ReturnType<typeof getEnv>>,
  accountId: string,
  userId: string,
): Promise<{ accessToken: string | null; errorCode?: string; errorMessage?: string }> {
  let { data: token, error } = await adminClient
    .from("gsc_tokens")
    .select("user_id,account_id,provider_token,provider_refresh_token,expires_at")
    .eq("account_id", accountId)
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    return { accessToken: null, errorCode: "token_load_failed", errorMessage: error.message };
  }

  if (!token) {
    const fallbackResult = await adminClient
      .from("gsc_tokens")
      .select("user_id,account_id,provider_token,provider_refresh_token,expires_at")
      .eq("user_id", userId)
      .maybeSingle();

    if (fallbackResult.error) {
      return { accessToken: null, errorCode: "token_load_failed", errorMessage: fallbackResult.error.message };
    }

    token = fallbackResult.data;
  }

  if (!token?.provider_token) {
    return { accessToken: null, errorCode: "missing_token", errorMessage: "Google Search Console is not connected." };
  }

  if (token.account_id !== accountId) {
    await adminClient
      .from("gsc_tokens")
      .update({ account_id: accountId, updated_at: new Date().toISOString() })
      .eq("user_id", token.user_id);
  }

  const expiresAt = token.expires_at ? new Date(token.expires_at).getTime() : 0;
  if (expiresAt > Date.now() + 10 * 60 * 1000) {
    const hasScope = await hasRequiredScope(token.provider_token);
    if (!hasScope) {
      return { accessToken: null, errorCode: "missing_scope", errorMessage: "Search Console scope is missing." };
    }

    return { accessToken: token.provider_token };
  }

  if (!token.provider_refresh_token) {
    return { accessToken: null, errorCode: "missing_refresh_token", errorMessage: "Google refresh token is missing. Please reconnect." };
  }

  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: env.googleClientId,
      client_secret: env.googleClientSecret,
      refresh_token: token.provider_refresh_token,
      grant_type: "refresh_token",
    }),
  });

  const data = await response.json();
  if (!response.ok || !data.access_token) {
    console.error("[GSC] Token refresh failed:", data);
    return { accessToken: null, errorCode: "refresh_failed", errorMessage: data.error_description || data.error || "Failed to refresh Google token." };
  }

  const scopeString = typeof data.scope === "string" ? data.scope : "";
  if (scopeString && !scopeString.split(" ").includes(GSC_SCOPE)) {
    return { accessToken: null, errorCode: "missing_scope", errorMessage: "Search Console scope is missing." };
  }

  const expiresAtIso = new Date(Date.now() + Math.max(60, Number(data.expires_in ?? 3500)) * 1000).toISOString();
  await adminClient
    .from("gsc_tokens")
    .update({
      provider_token: data.access_token,
      provider_refresh_token: data.refresh_token || token.provider_refresh_token,
      account_id: accountId,
      expires_at: expiresAtIso,
      updated_at: new Date().toISOString(),
    })
    .eq("user_id", token.user_id);

  return { accessToken: data.access_token };
}

async function hasRequiredScope(accessToken: string): Promise<boolean> {
  try {
    const response = await fetch(
      `https://www.googleapis.com/oauth2/v1/tokeninfo?access_token=${encodeURIComponent(accessToken)}`,
    );
    if (!response.ok) return false;
    const data = await response.json();
    const scopeString = typeof data.scope === "string" ? data.scope : "";
    return scopeString.split(" ").includes(GSC_SCOPE);
  } catch {
    return false;
  }
}

async function listAccessibleGscProperties(accessToken: string): Promise<{
  properties: string[];
  error?: string;
  errorCode?: string;
}> {
  const response = await fetch("https://www.googleapis.com/webmasters/v3/sites", {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (!response.ok) {
    const text = await response.text();
    return {
      properties: [],
      errorCode: `gsc_sites_${response.status}`,
      error: text || `Failed to list GSC properties: ${response.status}`,
    };
  }

  const data = await response.json();
  const entries = Array.isArray(data.siteEntry) ? data.siteEntry as GscPropertyEntry[] : [];
  return {
    properties: entries
      .filter((entry) => entry.siteUrl && entry.permissionLevel && entry.permissionLevel !== "siteUnverifiedUser")
      .map((entry) => entry.siteUrl as string),
  };
}

function normalizeUrlPrefix(rawUrl: string): string | null {
  try {
    const url = new URL(rawUrl);
    const pathname = url.pathname.endsWith("/") ? url.pathname : `${url.pathname}/`;
    return `${url.protocol}//${url.host}${pathname}`;
  } catch {
    return null;
  }
}

function getHostname(rawUrl: string): string | null {
  try {
    return new URL(rawUrl).hostname.toLowerCase();
  } catch {
    return null;
  }
}

function matchesProperty(siteUrl: string, propertyUrl: string): boolean {
  if (propertyUrl.startsWith("sc-domain:")) {
    const domain = propertyUrl.replace("sc-domain:", "").toLowerCase();
    const hostname = getHostname(siteUrl);
    return hostname === domain || Boolean(hostname && hostname.endsWith(`.${domain}`));
  }

  const normalizedSiteUrl = normalizeUrlPrefix(siteUrl);
  const normalizedPropertyUrl = normalizeUrlPrefix(propertyUrl);
  return Boolean(normalizedSiteUrl && normalizedPropertyUrl && normalizedSiteUrl === normalizedPropertyUrl);
}

async function saveStatus(
  adminClient: ReturnType<typeof createClient>,
  wordpressConfigId: string,
  accountId: string,
  status: {
    verified: boolean;
    matched_property_url: string | null;
    error_code: string | null | undefined;
    error_message: string | null | undefined;
  },
) {
  const checkedAt = new Date().toISOString();
  const payload = {
    wordpress_config_id: wordpressConfigId,
    account_id: accountId,
    verified: status.verified,
    matched_property_url: status.matched_property_url,
    checked_at: checkedAt,
    error_code: status.error_code ?? null,
    error_message: status.error_message ?? null,
    updated_at: checkedAt,
  };

  const { data, error } = await adminClient
    .from("gsc_property_statuses")
    .upsert(payload, { onConflict: "wordpress_config_id" })
    .select("wordpress_config_id,verified,matched_property_url,checked_at,error_code,error_message")
    .single();

  if (error) {
    throw error;
  }

  return data;
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
