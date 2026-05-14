import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";

type DeleteClientAccountRequest = {
  account_id: string;
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

  const { data: isAdmin, error: adminError } = await userClient.rpc("is_admin");
  if (adminError || !isAdmin) {
    return json({ error: "Admin permission is required." }, 403);
  }

  let body: DeleteClientAccountRequest;
  try {
    body = await req.json();
  } catch {
    return json({ error: "Invalid JSON body." }, 400);
  }

  const accountId = String(body.account_id ?? "").trim();
  if (!accountId) {
    return json({ error: "account_id is required." }, 400);
  }

  const adminClient = createClient(supabaseUrl, serviceRoleKey);

  const { data: account, error: accountError } = await adminClient
    .from("accounts")
    .select("id,name")
    .eq("id", accountId)
    .single();

  if (accountError || !account) {
    return json({ error: "Client account was not found." }, 404);
  }

  const { data: profiles, error: profilesError } = await adminClient
    .from("profiles")
    .select("user_id,role")
    .eq("account_id", accountId);

  if (profilesError) {
    return json({ error: profilesError.message }, 500);
  }

  const nonClientProfile = (profiles ?? []).find((profile) => profile.role !== "client");
  if (nonClientProfile) {
    return json({ error: "Only client accounts can be deleted with this function." }, 400);
  }

  const authUserIds = (profiles ?? [])
    .map((profile) => profile.user_id)
    .filter((userId): userId is string => Boolean(userId));

  const { error: profileDeleteError } = await adminClient
    .from("profiles")
    .delete()
    .eq("account_id", accountId);

  if (profileDeleteError) {
    return json({ error: profileDeleteError.message }, 500);
  }

  for (const userId of authUserIds) {
    const { error: deleteUserError } = await adminClient.auth.admin.deleteUser(userId);
    if (deleteUserError) {
      return json({ error: deleteUserError.message }, 500);
    }
  }

  const { error: accountDeleteError } = await adminClient
    .from("accounts")
    .delete()
    .eq("id", accountId);

  if (accountDeleteError) {
    return json({ error: accountDeleteError.message }, 500);
  }

  return json({
    account_id: accountId,
    deleted_auth_user_count: authUserIds.length,
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
