import { createClient } from "npm:@supabase/supabase-js@2";
import { corsHeaders } from "./cors.ts";

export type AuthenticatedCaller =
  | { kind: "service_role" }
  | { kind: "user"; userId: string };

/**
 * Edge Function の呼び出し元を検証する。
 * service role キー、またはログインユーザーのアクセストークンのみ許可する
 * （anon key は verify_jwt を通過してしまうため、auth.getUser() で実ユーザーを確認する）。
 */
export const requireAuthenticatedCaller = async (
  req: Request,
): Promise<AuthenticatedCaller | { errorResponse: Response }> => {
  const unauthorized = (message: string) => ({
    errorResponse: new Response(JSON.stringify({ error: message }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 401,
    }),
  });

  const authHeader = req.headers.get("Authorization") ?? "";
  const token = authHeader.replace(/^Bearer\s+/i, "").trim();
  if (!token) {
    return unauthorized("Missing Authorization header");
  }

  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  if (serviceRoleKey && token === serviceRoleKey) {
    return { kind: "service_role" };
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY");
  if (!supabaseUrl || !supabaseAnonKey) {
    return {
      errorResponse: new Response(JSON.stringify({ error: "Server auth configuration is missing" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 500,
      }),
    };
  }

  const supabase = createClient(supabaseUrl, supabaseAnonKey);
  const { data, error } = await supabase.auth.getUser(token);
  if (error || !data?.user) {
    return unauthorized("Invalid or expired session token");
  }

  return { kind: "user", userId: data.user.id };
};
