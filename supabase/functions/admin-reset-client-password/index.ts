import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";

type ResetClientPasswordRequest = {
  account_id: string;
  password: string;
};

const findAuthUserByEmail = async (
  adminClient: ReturnType<typeof createClient>,
  email: string,
) => {
  const normalizedEmail = email.trim().toLowerCase();
  const perPage = 1000;

  for (let page = 1; page <= 100; page += 1) {
    const { data, error } = await adminClient.auth.admin.listUsers({ page, perPage });
    if (error) throw error;

    const user = data.users.find((candidate) => candidate.email?.toLowerCase() === normalizedEmail);
    if (user) return user;
    if (data.users.length < perPage) break;
  }

  return null;
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
    .select("id,user_id,login_email")
    .eq("account_id", accountId)
    .eq("role", "client")
    .maybeSingle();
  if (profileError) return json({ error: profileError.message }, 500);
  if (!profile) return json({ error: "No client login is registered for this account." }, 404);

  const { data: authUserData, error: authUserError } = await adminClient.auth.admin.getUserById(profile.user_id);
  if (authUserError || !authUserData.user?.email) {
    return json({ error: "The client authentication user could not be found." }, 404);
  }
  let authUser = authUserData.user;
  let mappingRepaired = false;
  if (profile.login_email && authUser.email.toLowerCase() !== profile.login_email.trim().toLowerCase()) {
    let matchingUser;
    try {
      matchingUser = await findAuthUserByEmail(adminClient, profile.login_email);
    } catch (error) {
      return json({ error: error instanceof Error ? error.message : "Failed to find the login user." }, 500);
    }

    if (!matchingUser) {
      return json({ error: "No authentication user exists for the registered login email." }, 404);
    }

    const { error: repairError } = await adminClient
      .from("profiles")
      .update({ user_id: matchingUser.id })
      .eq("id", profile.id);
    if (repairError) {
      return json({ error: `Failed to repair the login account mapping: ${repairError.message}` }, 409);
    }

    authUser = matchingUser;
    mappingRepaired = true;
  }

  const { error: updateError } = await adminClient.auth.admin.updateUserById(authUser.id, { password });
  if (updateError) return json({ error: updateError.message }, 500);

  // Verify against the same password grant used by the application before
  // reporting success. This catches an unexpected Auth/user mapping issue
  // without exposing the password or session to the browser.
  const verificationClient = createClient(supabaseUrl, anonKey);
  const { error: verificationError } = await verificationClient.auth.signInWithPassword({
    email: authUser.email,
    password,
  });
  if (verificationError) {
    return json({ error: `Password was updated but sign-in verification failed: ${verificationError.message}` }, 500);
  }

  return json({ success: true, mapping_repaired: mappingRepaired });
});
