import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";

type StartRequest = {
  redirect_to?: string;
};

const GSC_SCOPE = "https://www.googleapis.com/auth/webmasters.readonly";

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
  const googleClientId = Deno.env.get("GOOGLE_CLIENT_ID");

  if (!supabaseUrl || !anonKey || !serviceRoleKey || !googleClientId) {
    return json({ error: "GSC OAuth environment is not configured." }, 500);
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

  let body: StartRequest;
  try {
    body = await req.json();
  } catch {
    return json({ error: "Invalid JSON body." }, 400);
  }

  const redirectTo = normalizeRedirect(body.redirect_to);
  if (!redirectTo) {
    return json({ error: "redirect_to is not allowed." }, 400);
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

  const state = crypto.randomUUID();
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();

  const { error: insertError } = await adminClient
    .from("gsc_oauth_states")
    .insert({
      state,
      user_id: user.id,
      account_id: profile.account_id,
      redirect_to: redirectTo,
      expires_at: expiresAt,
    });

  if (insertError) {
    return json({ error: insertError.message }, 500);
  }

  const callbackUrl = `${supabaseUrl.replace(/\/+$/, "")}/functions/v1/gsc-oauth-callback`;
  const authUrl = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  authUrl.searchParams.set("client_id", googleClientId);
  authUrl.searchParams.set("redirect_uri", callbackUrl);
  authUrl.searchParams.set("response_type", "code");
  authUrl.searchParams.set("scope", GSC_SCOPE);
  authUrl.searchParams.set("access_type", "offline");
  authUrl.searchParams.set("prompt", "consent");
  authUrl.searchParams.set("state", state);

  return json({ auth_url: authUrl.toString(), expires_at: expiresAt });
});

function normalizeRedirect(raw: string | undefined): string | null {
  if (!raw) return null;

  try {
    const url = new URL(raw);
    const allowedOrigin = Deno.env.get("APP_ORIGIN");
    if (allowedOrigin && url.origin === allowedOrigin) {
      return url.toString();
    }

    if (url.hostname === "localhost" || url.hostname === "127.0.0.1") {
      return url.toString();
    }

    if (url.origin === "https://ai-autowriter.netlify.app") {
      return url.toString();
    }
  } catch {
    return null;
  }

  return null;
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json",
    },
  });
