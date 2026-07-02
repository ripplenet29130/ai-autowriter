import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";

type ConnectionTestRequest = {
  wordpress_config_id?: string;
};

type WordPressErrorBody = {
  code?: string;
  message?: string;
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return json({ error: "Method not allowed." }, 405);
  }

  const env = getEnv();
  if (!env) {
    return json({ error: "Supabase environment is not configured." }, 500);
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

  let body: ConnectionTestRequest;
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
    .select("id,account_id,name,url,username,password")
    .eq("id", wordpressConfigId)
    .eq("account_id", profile.account_id)
    .maybeSingle();

  if (wpError) {
    return json({ error: wpError.message }, 500);
  }
  if (!wpConfig) {
    return json({
      success: false,
      code: "config_not_found",
      message: "対象のWordPress設定が見つかりません。設定を保存し直してください。",
    });
  }

  const baseUrl = String(wpConfig.url ?? "").replace(/\/+$/, "");
  let endpoint: string;
  try {
    const endpointUrl = new URL(`${baseUrl}/wp-json/wp/v2/posts?per_page=1`);
    if (!["http:", "https:"].includes(endpointUrl.protocol)) {
      throw new Error("Unsupported protocol");
    }
    endpoint = endpointUrl.toString();
  } catch {
    return json({
      success: false,
      code: "invalid_url",
      message: "WordPress URLの形式が正しくありません。",
      details: baseUrl,
    });
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 15000);

  try {
    const response = await fetch(endpoint, {
      method: "GET",
      headers: {
        Authorization: `Basic ${encodeBasicAuth(`${wpConfig.username}:${wpConfig.password}`)}`,
        Accept: "application/json",
        "User-Agent": "AutomaticWriter-WordPress-Connection-Test/1.0",
      },
      redirect: "follow",
      signal: controller.signal,
    });

    const responseText = await response.text();
    const responseBody = parseWordPressBody(responseText);

    if (response.ok) {
      return json({
        success: true,
        status: response.status,
        message: `${wpConfig.name}への接続に成功しました。`,
      });
    }

    return json(buildFailureResult(response.status, responseBody, responseText));
  } catch (error) {
    const isTimeout = error instanceof DOMException && error.name === "AbortError";
    return json({
      success: false,
      code: isTimeout ? "timeout" : "network_error",
      message: isTimeout
        ? "WordPressから15秒以内に応答がありませんでした。サーバーの状態を確認してください。"
        : "WordPressサーバーへ接続できませんでした。URL、SSL証明書、サーバーの稼働状態を確認してください。",
      details: error instanceof Error ? error.message : String(error),
    });
  } finally {
    clearTimeout(timeoutId);
  }
});

function buildFailureResult(status: number, body: WordPressErrorBody | null, rawBody: string) {
  const code = body?.code || `http_${status}`;
  const remoteMessage = body?.message?.trim();
  const normalized = `${code} ${remoteMessage ?? ""}`.toLowerCase();

  let message: string;
  if (status === 401) {
    message = "認証に失敗しました。WordPressのユーザー名とアプリケーションパスワードを確認してください。";
  } else if (status === 403) {
    message = "WordPressにアクセスを拒否されました。ユーザー権限またはセキュリティ設定を確認してください。";
  } else if (status === 404) {
    message = "WordPress REST APIが見つかりません。登録URLとパーマリンク設定を確認してください。";
  } else if (status === 429 || /rate.?limit|too many|quota|上限/.test(normalized)) {
    message = "WordPress側の利用回数またはリクエスト上限に達しています。時間をおいて再試行するか、サーバー側の制限を確認してください。";
  } else if (status >= 500) {
    message = "WordPressサーバー側でエラーが発生しました。サーバーログまたは管理会社へ確認してください。";
  } else {
    message = `WordPressからHTTP ${status}エラーが返されました。`;
  }

  if (remoteMessage) {
    message += ` WordPressの応答: ${stripHtml(remoteMessage)}`;
  }

  return {
    success: false,
    status,
    code,
    message,
    details: remoteMessage || rawBody.slice(0, 500) || undefined,
  };
}

function parseWordPressBody(value: string): WordPressErrorBody | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" ? parsed as WordPressErrorBody : null;
  } catch {
    return null;
  }
}

function stripHtml(value: string): string {
  return value.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim().slice(0, 300);
}

function encodeBasicAuth(value: string): string {
  const bytes = new TextEncoder().encode(value);
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary);
}

function getEnv() {
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || Deno.env.get("SERVICE_ROLE_KEY");

  if (!supabaseUrl || !anonKey || !serviceRoleKey) {
    return null;
  }
  return { supabaseUrl, anonKey, serviceRoleKey };
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
