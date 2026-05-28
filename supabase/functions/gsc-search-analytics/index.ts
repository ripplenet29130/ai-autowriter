import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";

type AnalyticsRequest = {
  wordpress_config_id?: string;
  days?: number;
  start_date?: string;
  end_date?: string;
  dimension?: "date" | "query";
  row_limit?: number;
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

  let body: AnalyticsRequest;
  try {
    body = await req.json();
  } catch {
    return json({ error: "Invalid JSON body." }, 400);
  }

  const wordpressConfigId = String(body.wordpress_config_id ?? "").trim();
  if (!wordpressConfigId) {
    return json({ error: "wordpress_config_id is required." }, 400);
  }

  const range = resolveDateRange(body);
  if (!range) {
    return json({ error: "Invalid date range." }, 400);
  }

  const days = getInclusiveDays(range.startDate, range.endDate);
  const dimension = body.dimension === "query" ? "query" : "date";
  const rowLimit = clampNumber(body.row_limit ?? (dimension === "query" ? 25 : 250), 1, 1000);

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
    .select("id,account_id,url")
    .eq("id", wordpressConfigId)
    .eq("account_id", profile.account_id)
    .maybeSingle();

  if (wpError) {
    return json({ error: wpError.message }, 500);
  }

  if (!wpConfig) {
    return json({ error: "WordPress config was not found." }, 404);
  }

  const tokenResult = await getValidGscToken(adminClient, env, user.id);
  if (!tokenResult.accessToken) {
    return json({ error: tokenResult.errorMessage, error_code: tokenResult.errorCode }, 400);
  }

  const { data: status } = await adminClient
    .from("gsc_property_statuses")
    .select("verified,matched_property_url")
    .eq("wordpress_config_id", wordpressConfigId)
    .eq("account_id", profile.account_id)
    .maybeSingle();

  const siteUrl = status?.matched_property_url || normalizeForApi(wpConfig.url);
  const response = await fetch(
    `https://www.googleapis.com/webmasters/v3/sites/${encodeURIComponent(siteUrl)}/searchAnalytics/query`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${tokenResult.accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        startDate: range.startDate,
        endDate: range.endDate,
        dimensions: [dimension],
        rowLimit,
      }),
    },
  );

  if (!response.ok) {
    const text = await response.text();
    return json({
      error: text || `Search Console API error: ${response.status}`,
      error_code: `gsc_analytics_${response.status}`,
      site_url: siteUrl,
    }, response.status === 401 || response.status === 403 || response.status === 404 ? 400 : 500);
  }

  const data = await response.json();
  const rawRows = Array.isArray(data.rows)
    ? data.rows.map((row: any) => ({
      key: row.keys?.[0] || "",
      clicks: row.clicks || 0,
      impressions: row.impressions || 0,
      ctr: row.ctr || 0,
      position: row.position || 0,
    }))
    : [];
  const rows = dimension === "date" ? fillDateRows(range.startDate, range.endDate, rawRows) : rawRows;

  return json({
    site_url: siteUrl,
    dimension,
    days,
    start_date: range.startDate,
    end_date: range.endDate,
    rows,
    summary: summarizeRows(rows),
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
  userId: string,
): Promise<{ accessToken: string | null; errorCode?: string; errorMessage?: string }> {
  const { data: token, error } = await adminClient
    .from("gsc_tokens")
    .select("provider_token,provider_refresh_token,expires_at")
    .eq("user_id", userId)
    .maybeSingle();

  if (error) {
    return { accessToken: null, errorCode: "token_load_failed", errorMessage: error.message };
  }

  if (!token?.provider_token) {
    return { accessToken: null, errorCode: "missing_token", errorMessage: "Google Search Console is not connected." };
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
      expires_at: expiresAtIso,
      updated_at: new Date().toISOString(),
    })
    .eq("user_id", userId);

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

function normalizeForApi(rawUrl: string): string {
  if (rawUrl.startsWith("sc-domain:")) return rawUrl;
  return rawUrl.endsWith("/") ? rawUrl : `${rawUrl}/`;
}

function formatDate(date: Date): string {
  return date.toISOString().split("T")[0];
}

function parseDateString(value: string | undefined): string | null {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const date = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime())) return null;
  return formatDate(date) === value ? value : null;
}

function resolveDateRange(body: AnalyticsRequest): { startDate: string; endDate: string } | null {
  const explicitStartDate = parseDateString(body.start_date);
  const explicitEndDate = parseDateString(body.end_date);
  if (explicitStartDate || explicitEndDate) {
    if (!explicitStartDate || !explicitEndDate) return null;
    if (explicitStartDate > explicitEndDate) return null;
    if (getInclusiveDays(explicitStartDate, explicitEndDate) > 548) return null;
    return { startDate: explicitStartDate, endDate: explicitEndDate };
  }

  const days = clampNumber(body.days ?? 28, 1, 180);
  const endDate = new Date();
  const startDate = new Date();
  startDate.setDate(startDate.getDate() - days + 1);
  return {
    startDate: formatDate(startDate),
    endDate: formatDate(endDate),
  };
}

function getInclusiveDays(startDate: string, endDate: string): number {
  const start = new Date(`${startDate}T00:00:00.000Z`).getTime();
  const end = new Date(`${endDate}T00:00:00.000Z`).getTime();
  return Math.floor((end - start) / 86400000) + 1;
}

function addDays(dateString: string, days: number): string {
  const date = new Date(`${dateString}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return formatDate(date);
}

function fillDateRows(
  startDate: string,
  endDate: string,
  rows: Array<{ key: string; clicks: number; impressions: number; ctr: number; position: number }>,
) {
  const rowsByDate = new Map(rows.map((row) => [row.key, row]));
  const filledRows = [];
  let currentDate = startDate;

  while (currentDate <= endDate) {
    filledRows.push(rowsByDate.get(currentDate) ?? {
      key: currentDate,
      clicks: 0,
      impressions: 0,
      ctr: 0,
      position: 0,
    });
    currentDate = addDays(currentDate, 1);
  }

  return filledRows;
}

function clampNumber(value: number, min: number, max: number): number {
  const normalized = Number(value);
  if (!Number.isFinite(normalized)) return min;
  return Math.max(min, Math.min(max, Math.floor(normalized)));
}

function summarizeRows(rows: Array<{ clicks: number; impressions: number; ctr: number; position: number }>) {
  const clicks = rows.reduce((sum, row) => sum + row.clicks, 0);
  const impressions = rows.reduce((sum, row) => sum + row.impressions, 0);
  const weightedPositionBase = rows.reduce((sum, row) => sum + row.position * row.impressions, 0);
  const ctr = impressions > 0 ? clicks / impressions : 0;
  const position = impressions > 0 ? weightedPositionBase / impressions : 0;
  return { clicks, impressions, ctr, position };
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
