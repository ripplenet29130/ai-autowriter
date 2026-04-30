import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";

type CreateClientUserRequest = {
  name: string;
  email: string;
  password: string;
  wordpress_site_limit?: number;
  monthly_article_limit?: number | null;
};

const defaultFeatureFlags = {
  wordpress_publish: true,
  scheduler: true,
  image_generation: false,
  fact_check: true,
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return json({ error: "Method not allowed" }, 405);
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

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

  const { data: isAdmin, error: adminError } = await userClient.rpc("is_admin");
  if (adminError || !isAdmin) {
    return json({ error: "Admin permission is required." }, 403);
  }

  let body: CreateClientUserRequest;
  try {
    body = await req.json();
  } catch {
    return json({ error: "Invalid JSON body." }, 400);
  }

  const name = String(body.name ?? "").trim();
  const email = String(body.email ?? "").trim().toLowerCase();
  const password = String(body.password ?? "");
  const wordpressSiteLimit = Math.max(0, Number(body.wordpress_site_limit ?? 1));
  const monthlyArticleLimit = body.monthly_article_limit === null || body.monthly_article_limit === undefined
    ? null
    : Math.max(0, Number(body.monthly_article_limit));

  if (!name) {
    return json({ error: "client name is required." }, 400);
  }

  if (!email || !email.includes("@")) {
    return json({ error: "valid email is required." }, 400);
  }

  if (password.length < 8) {
    return json({ error: "password must be at least 8 characters." }, 400);
  }

  const adminClient = createClient(supabaseUrl, serviceRoleKey);
  let accountId: string | null = null;
  let authUserId: string | null = null;

  try {
    const { data: account, error: accountError } = await adminClient
      .from("accounts")
      .insert({
        name,
        status: "active",
        wordpress_site_limit: wordpressSiteLimit,
        monthly_article_limit: monthlyArticleLimit,
        feature_flags: defaultFeatureFlags,
      })
      .select("id,name,status,wordpress_site_limit,monthly_article_limit,feature_flags")
      .single();

    if (accountError) throw accountError;
    accountId = account.id;

    const { data: createdUser, error: createUserError } = await adminClient.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: {
        display_name: name,
      },
    });

    if (createUserError) throw createUserError;
    authUserId = createdUser.user.id;

    const { data: profile, error: profileError } = await adminClient
      .from("profiles")
      .insert({
        user_id: authUserId,
        account_id: accountId,
        role: "client",
        display_name: name,
      })
      .select("id,user_id,account_id,role,display_name")
      .single();

    if (profileError) throw profileError;

    return json({
      account,
      profile,
      user: {
        id: authUserId,
        email,
      },
    });
  } catch (error) {
    if (authUserId) {
      await adminClient.auth.admin.deleteUser(authUserId);
    }

    if (accountId) {
      await adminClient.from("accounts").delete().eq("id", accountId);
    }

    return json({
      error: error instanceof Error ? error.message : "Failed to create client user.",
    }, 500);
  }
});

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json",
    },
  });
