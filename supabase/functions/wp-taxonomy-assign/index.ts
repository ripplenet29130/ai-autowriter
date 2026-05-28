import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { corsHeaders } from "../_shared/cors.ts";

type AssignTaxonomyRequest = {
  url?: string;
  username?: string;
  password?: string;
  postId?: string | number;
  postType?: string;
  taxonomy?: string;
  term?: string;
};

function escapeXml(value: string | number): string {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function normalizeBaseUrl(value: string): string {
  return String(value || "").replace(/\/+$/, "");
}

function buildXmlRpcBody(params: Required<AssignTaxonomyRequest>): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<methodCall>
  <methodName>wp.editPost</methodName>
  <params>
    <param><value><int>0</int></value></param>
    <param><value><string>${escapeXml(params.username)}</string></value></param>
    <param><value><string>${escapeXml(params.password)}</string></value></param>
    <param><value><string>${escapeXml(params.postId)}</string></value></param>
    <param>
      <value>
        <struct>
          <member>
            <name>post_type</name>
            <value><string>${escapeXml(params.postType)}</string></value>
          </member>
          <member>
            <name>terms_names</name>
            <value>
              <struct>
                <member>
                  <name>${escapeXml(params.taxonomy)}</name>
                  <value>
                    <array>
                      <data>
                        <value><string>${escapeXml(params.term)}</string></value>
                      </data>
                    </array>
                  </value>
                </member>
              </struct>
            </value>
          </member>
          <member>
            <name>terms</name>
            <value>
              <struct>
                <member>
                  <name>${escapeXml(params.taxonomy)}</name>
                  <value>
                    <array>
                      <data>
                        <value><string>${escapeXml(params.term)}</string></value>
                      </data>
                    </array>
                  </value>
                </member>
              </struct>
            </value>
          </member>
        </struct>
      </value>
    </param>
  </params>
</methodCall>`;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  try {
    const body = await req.json() as AssignTaxonomyRequest;
    const url = normalizeBaseUrl(body.url || "");
    const username = String(body.username || "").trim();
    const password = String(body.password || "");
    const postId = body.postId;
    const postType = String(body.postType || "").trim();
    const taxonomy = String(body.taxonomy || "").trim();
    const term = String(body.term || "").trim();

    if (!url || !username || !password || !postId || !postType || !taxonomy || !term) {
      return new Response(JSON.stringify({ error: "Missing required fields" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const xml = buildXmlRpcBody({
      url,
      username,
      password,
      postId,
      postType,
      taxonomy,
      term,
    });

    const endpoint = `${url}/xmlrpc.php`;
    const upstream = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "text/xml" },
      body: xml,
    });
    const responseText = await upstream.text();
    const faultMatch = responseText.match(/<name>faultString<\/name>\s*<value>\s*<string>([\s\S]*?)<\/string>/i);
    const safeBody = responseText.replace(/<string>[\s\S]{200,}?<\/string>/g, "<string>[truncated]</string>").slice(0, 1200);

    if (!upstream.ok || faultMatch?.[1]) {
      return new Response(JSON.stringify({
        error: faultMatch?.[1] || `XML-RPC request failed with status ${upstream.status}`,
        status: upstream.status,
        body: safeBody,
      }), {
        status: 502,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({ success: true }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    return new Response(JSON.stringify({
      error: error instanceof Error ? error.message : "Unknown error",
    }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
