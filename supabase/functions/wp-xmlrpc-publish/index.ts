import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { corsHeaders } from "../_shared/cors.ts";

type PublishRequest = {
  url?: string;
  username?: string;
  password?: string;
  postType?: string;
  title?: string;
  content?: string;
  excerpt?: string;
  status?: string;
  taxonomy?: string;
  termIds?: number[];
  postDateGmt?: string;
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

function buildXmlRpcNewPostBody(params: Required<Pick<PublishRequest, "username" | "password" | "postType" | "title" | "content" | "excerpt" | "status">> & {
  taxonomy?: string;
  termIds?: number[];
  postDateGmt?: string;
}): string {
  const termsXml = params.taxonomy && params.termIds && params.termIds.length > 0
    ? `
          <member>
            <name>terms</name>
            <value>
              <struct>
                <member>
                  <name>${escapeXml(params.taxonomy)}</name>
                  <value>
                    <array>
                      <data>
                        ${params.termIds.map((id) => `<value><int>${id}</int></value>`).join("")}
                      </data>
                    </array>
                  </value>
                </member>
              </struct>
            </value>
          </member>`
    : "";

  const dateXml = params.postDateGmt
    ? `
          <member>
            <name>post_date_gmt</name>
            <value><dateTime.iso8601>${escapeXml(params.postDateGmt)}</dateTime.iso8601></value>
          </member>`
    : "";

  return `<?xml version="1.0" encoding="UTF-8"?>
<methodCall>
  <methodName>wp.newPost</methodName>
  <params>
    <param><value><int>0</int></value></param>
    <param><value><string>${escapeXml(params.username)}</string></value></param>
    <param><value><string>${escapeXml(params.password)}</string></value></param>
    <param>
      <value>
        <struct>
          <member>
            <name>post_type</name>
            <value><string>${escapeXml(params.postType)}</string></value>
          </member>
          <member>
            <name>post_status</name>
            <value><string>${escapeXml(params.status)}</string></value>
          </member>
          <member>
            <name>post_title</name>
            <value><string>${escapeXml(params.title)}</string></value>
          </member>
          <member>
            <name>post_content</name>
            <value><string><![CDATA[${params.content}]]></string></value>
          </member>
          <member>
            <name>post_excerpt</name>
            <value><string>${escapeXml(params.excerpt)}</string></value>
          </member>${termsXml}${dateXml}
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
    const body = await req.json() as PublishRequest;
    const url = normalizeBaseUrl(body.url || "");
    const username = String(body.username || "").trim();
    const password = String(body.password || "");
    const postType = String(body.postType || "posts").trim() || "posts";
    const title = String(body.title || "");
    const content = String(body.content || "");
    const excerpt = String(body.excerpt || "");
    const status = String(body.status || "publish").trim() || "publish";
    const taxonomy = body.taxonomy ? String(body.taxonomy).trim() : undefined;
    const termIds = Array.isArray(body.termIds) ? body.termIds.filter((id) => Number.isInteger(id)) : undefined;
    const postDateGmt = body.postDateGmt ? String(body.postDateGmt).trim() : undefined;

    if (!url || !username || !password || !title) {
      return new Response(JSON.stringify({ error: "Missing required fields" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const xml = buildXmlRpcNewPostBody({
      username,
      password,
      postType,
      title,
      content,
      excerpt,
      status,
      taxonomy,
      termIds,
      postDateGmt,
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

    const postIdMatch = responseText.match(/<param>\s*<value>\s*<string>([\s\S]*?)<\/string>/i);
    const postId = postIdMatch?.[1]?.trim();
    if (!postId) {
      return new Response(JSON.stringify({
        error: "XML-RPC response did not contain a post ID",
        body: safeBody,
      }), {
        status: 502,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({ success: true, postId }), {
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
