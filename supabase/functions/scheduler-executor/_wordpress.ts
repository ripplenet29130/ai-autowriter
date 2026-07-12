// WordPress への投稿（REST / XML-RPC）とタクソノミー解決
import { fetchWithTimeout, type WordPressConfig } from './_shared.ts';
import { extractExcerpt, formatContentForWordPress } from './_content-format.ts';

export async function getTermIdBySlugOrName(
  config: WordPressConfig,
  restBase: string,
  categoryIdentifier: string
): Promise<number | null> {
  const auth = btoa(`${config.username}:${config.password}`);

  try {
    // 驍ｵ・ｺ繝ｻ・ｾ驍ｵ・ｺ陞｢・ｹ邵ｺ蟶ｷ・ｹ譎｢・ｽ・ｩ驛｢譏ｴ繝ｻ邵ｺ蝣､・ｸ・ｺ繝ｻ・ｧ髫ｶﾂ隲帙・・ｽ・ｴ繝ｻ・｢
    let response = await fetch(
      `${config.url}/wp-json/wp/v2/${restBase}?slug=${encodeURIComponent(categoryIdentifier)}`,
      { headers: { 'Authorization': `Basic ${auth}` } }
    );

    if (response.ok) {
      const data = await response.json();
      if (data.length > 0) {
        console.log(`Found category by slug "${categoryIdentifier}": ID ${data[0].id}`);
        return data[0].id;
      }
    }

    // 驛｢・ｧ繝ｻ・ｹ驛｢譎｢・ｽ・ｩ驛｢譏ｴ繝ｻ邵ｺ蝣､・ｸ・ｺ繝ｻ・ｧ鬮ｫ遨ゑｽｹ譏ｶ蜻ｽ驍ｵ・ｺ闕ｵ譎｢・ｽ閾･・ｸ・ｺ繝ｻ・ｪ驍ｵ・ｺ闔会ｽ｣繝ｻ讙趣ｽｸ・ｺ繝ｻ・ｰ髯ｷ・ｷ隶朱｡披・驍ｵ・ｺ繝ｻ・ｧ髫ｶﾂ隲帙・・ｽ・ｴ繝ｻ・｢
    response = await fetch(
      `${config.url}/wp-json/wp/v2/${restBase}?search=${encodeURIComponent(categoryIdentifier)}`,
      { headers: { 'Authorization': `Basic ${auth}` } }
    );

    if (response.ok) {
      const data = await response.json();
      // 髯橸ｽｳ隰疲ｺ倥・髣包ｽｳ・つ鬮｢・ｾ繝ｻ・ｴ驛｢・ｧ陷ｻ閧ｲ邊滄し・ｺ郢晢ｽｻ
      const exactMatch = data.find((cat: any) =>
        cat.name.toLowerCase() === categoryIdentifier.toLowerCase()
      );
      if (exactMatch) {
        console.log(`Found category by name "${categoryIdentifier}": ID ${exactMatch.id}`);
        return exactMatch.id;
      }
      // 髯橸ｽｳ隰疲ｺ倥・髣包ｽｳ・つ鬮｢・ｾ繝ｻ・ｴ驍ｵ・ｺ陟募ｨｯ繝ｻ驍ｵ・ｺ闔会ｽ｣繝ｻ讙趣ｽｸ・ｺ繝ｻ・ｰ髫ｴ蟠｢ﾂ髯具ｽｻ隴擾ｽｴ郢晢ｽｻ鬩搾ｽｨ陷亥沺・｣・｡驛｢・ｧ陞ｳ螟ｲ・ｽ・ｿ隴∫ｵｶ繝ｻ
      if (data.length > 0) {
        console.log(`Found category by partial match "${categoryIdentifier}": ID ${data[0].id}`);
        return data[0].id;
      }
    }

    console.warn(`Category "${categoryIdentifier}" not found`);
    return null;
  } catch (error) {
    console.error(`Error searching for category "${categoryIdentifier}":`, error);
    return null;
  }
}

// WordPress髫ｰ螢ｽ繝ｻ繝ｻ・ｨ繝ｻ・ｿ

export function escapeXmlRpcValue(value: string | number): string {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}


export function isPermissionRelatedWpError(status: number, text: string): boolean {
  if (status === 401) return true;
  const normalized = text.toLowerCase();
  return normalized.includes('rest_cannot_create')
    || normalized.includes('rest_not_logged_in')
    || normalized.includes('rest_cannot_edit')
    || normalized.includes('rest_forbidden');
}


export function buildXmlRpcNewPostBody(params: {
  username: string;
  password: string;
  postType: string;
  title: string;
  content: string;
  excerpt: string;
  status: string;
  termsTaxonomy?: string;
  termIds?: number[];
}): string {
  const termsXml = params.termsTaxonomy && params.termIds && params.termIds.length > 0
    ? `
          <member>
            <name>terms</name>
            <value>
              <struct>
                <member>
                  <name>${escapeXmlRpcValue(params.termsTaxonomy)}</name>
                  <value>
                    <array>
                      <data>
                        ${params.termIds.map((id) => `<value><int>${id}</int></value>`).join('')}
                      </data>
                    </array>
                  </value>
                </member>
              </struct>
            </value>
          </member>`
    : '';

  return `<?xml version="1.0" encoding="UTF-8"?>
<methodCall>
  <methodName>wp.newPost</methodName>
  <params>
    <param><value><int>0</int></value></param>
    <param><value><string>${escapeXmlRpcValue(params.username)}</string></value></param>
    <param><value><string>${escapeXmlRpcValue(params.password)}</string></value></param>
    <param>
      <value>
        <struct>
          <member>
            <name>post_type</name>
            <value><string>${escapeXmlRpcValue(params.postType)}</string></value>
          </member>
          <member>
            <name>post_status</name>
            <value><string>${escapeXmlRpcValue(params.status)}</string></value>
          </member>
          <member>
            <name>post_title</name>
            <value><string>${escapeXmlRpcValue(params.title)}</string></value>
          </member>
          <member>
            <name>post_content</name>
            <value><string><![CDATA[${params.content}]]></string></value>
          </member>
          <member>
            <name>post_excerpt</name>
            <value><string>${escapeXmlRpcValue(params.excerpt)}</string></value>
          </member>${termsXml}
        </struct>
      </value>
    </param>
  </params>
</methodCall>`;
}

/**
 * REST APIがAuthorizationヘッダーを認識しないホスト（ロリポップ等のCGI/FastCGI環境で
 * ヘッダーが破棄される場合）向けに、XML-RPC (wp.newPost) で投稿作成をリトライする。
 * XML-RPCは認証情報をHTTPヘッダーではなくリクエスト本文で送るため、この制限を受けない。
 */

export async function publishViaXmlRpc(
  config: WordPressConfig,
  postType: string,
  title: string,
  content: string,
  status: string,
  termAssignment: { field: string; ids: number[] } | null
): Promise<string | null> {
  const termsTaxonomy = termAssignment
    ? (postType === 'posts' && termAssignment.field === 'categories' ? 'category' : termAssignment.field)
    : undefined;

  const body = buildXmlRpcNewPostBody({
    username: config.username,
    password: config.password,
    postType,
    title,
    content: formatContentForWordPress(content),
    excerpt: extractExcerpt(content),
    status,
    termsTaxonomy,
    termIds: termAssignment?.ids,
  });

  try {
    const response = await fetch(`${config.url}/xmlrpc.php`, {
      method: 'POST',
      headers: { 'Content-Type': 'text/xml' },
      body,
    });
    const responseText = await response.text();
    const faultMatch = responseText.match(/<name>faultString<\/name>\s*<value>\s*<string>([\s\S]*?)<\/string>/i);

    if (!response.ok || faultMatch?.[1]) {
      console.error('XML-RPC post creation failed:', faultMatch?.[1] || `HTTP ${response.status}: ${responseText.slice(0, 500)}`);
      return null;
    }

    const postIdMatch = responseText.match(/<param>\s*<value>\s*<string>([\s\S]*?)<\/string>/i);
    return postIdMatch?.[1]?.trim() || null;
  } catch (error) {
    console.error('XML-RPC post creation request failed:', error);
    return null;
  }
}


export async function publishToWordPress(
  config: WordPressConfig,
  title: string,
  content: string,
  status: string
): Promise<string> {
  const auth = btoa(`${config.username}:${config.password}`);

  // 驛｢・ｧ繝ｻ・ｫ驛｢・ｧ繝ｻ・ｹ驛｢・ｧ繝ｻ・ｿ驛｢譎｢・｣・ｰ髫ｰ螢ｽ繝ｻ繝ｻ・ｨ繝ｻ・ｿ驛｢・ｧ繝ｻ・ｿ驛｢・ｧ繝ｻ・､驛｢譎丞ｹｲ遶頑･｢豎槭・・ｾ髯滂ｽ｢隲帛･・ｽｼ・ｰ驍ｵ・ｺ雋・･笙驛｢譎｢・ｽ・ｳ驛｢譎擾ｽｳ・ｨ郢晢ｽｻ驛｢・ｧ繝ｻ・､驛｢譎｢・ｽ・ｳ驛｢譎冗樟繝ｻ螳夲ｽｮ蝣､霍昴・・ｯ郢晢ｽｻ
  const postType = config.post_type || 'posts';
  const wpApiUrl = `${config.url}/wp-json/wp/v2/${postType}`;
  console.log(`Publishing to WordPress: ${wpApiUrl}`);

  const termAssignment = config.category
    ? await resolveTermAssignmentForPostType(config, postType, config.category)
    : null;

  if (config.category && !termAssignment) {
    throw new Error(
      `Configured category "${config.category}" was not found for post type "${postType}". ` +
      'Check that the taxonomy is exposed through the WordPress REST API.'
    );
  }

  const postPayload: Record<string, any> = {
    title,
    content: formatContentForWordPress(content),
    status,
  };
  if (termAssignment) {
    postPayload[termAssignment.field] = termAssignment.ids;
    console.log(`Using taxonomy field "${termAssignment.field}" for "${config.category}": ${termAssignment.ids.join(', ')}`);
  }
  const requestBody = JSON.stringify(postPayload);

  const postWithEndpoint = async (
    endpoint: string
  ): Promise<{ ok: true; postId: string } | { ok: false; status: number; text: string }> => {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Basic ${auth}`
      },
      body: requestBody
    });

    if (!response.ok) {
      const text = await response.text();
      return { ok: false, status: response.status, text };
    }

    const data = await response.json();
    return { ok: true, postId: String(data.id) };
  };

  const primary = await postWithEndpoint(wpApiUrl);
  if (primary.ok) {
    return primary.postId;
  }

  if (isPermissionRelatedWpError(primary.status, primary.text)) {
    console.warn(`REST API post creation was denied (status ${primary.status}). Retrying via XML-RPC.`);
    const xmlRpcPostId = await publishViaXmlRpc(config, postType, title, content, status, termAssignment);
    if (xmlRpcPostId) {
      console.log(`Published via XML-RPC fallback: Post ID ${xmlRpcPostId}`);
      return xmlRpcPostId;
    }
  }

  throw new Error(
    `WordPress post type "${postType}" rejected the post (${primary.status}): ${primary.text}. ` +
    'The post was not redirected to the default posts endpoint.'
  );
}



export async function getCategoryIdBySlugOrName(
  config: WordPressConfig,
  categoryIdentifier: string
): Promise<number | null> {
  return getTermIdBySlugOrName(config, 'categories', categoryIdentifier);
}


export async function getTaxonomyCandidatesForPostType(
  config: WordPressConfig,
  postType: string
): Promise<Array<{ field: string; restBase: string }>> {
  const candidates: Array<{ field: string; restBase: string }> = [];
  const addCandidate = (field: string, restBase: string) => {
    if (!field || !restBase) return;
    if (candidates.some((item) => item.field === field || item.restBase === restBase)) return;
    candidates.push({ field, restBase });
  };

  if (postType === 'posts') {
    addCandidate('categories', 'categories');
    return candidates;
  }

  const normalizedPostType = String(postType || '').trim();
  const auth = btoa(`${config.username}:${config.password}`);
  try {
    const optionsResponse = await fetch(
      `${config.url}/wp-json/wp/v2/${postType}`,
      {
        method: 'OPTIONS',
        headers: { 'Authorization': `Basic ${auth}` }
      }
    );
    if (optionsResponse.ok) {
      const schema = await optionsResponse.json();
      const properties = schema?.schema?.properties || schema?.endpoints?.[0]?.schema?.properties || {};
      const ignoredFields = new Set([
        'id', 'date', 'date_gmt', 'guid', 'modified', 'modified_gmt', 'slug', 'status',
        'type', 'link', 'title', 'content', 'excerpt', 'author', 'featured_media',
        'comment_status', 'ping_status', 'template', 'meta', 'permalink_template',
        'generated_slug', 'tags'
      ]);

      for (const [fieldName, definition] of Object.entries(properties)) {
        if (ignoredFields.has(fieldName)) continue;
        const item = definition as any;
        const itemType = item?.items?.type || item?.items?.[0]?.type;
        if (item?.type === 'array' && (itemType === 'integer' || itemType === 'number')) {
          addCandidate(fieldName, fieldName);
        }
      }
    }
  } catch (error) {
    console.warn(`Failed to inspect REST schema for post type "${postType}":`, error);
  }

  try {
    const response = await fetch(
      `${config.url}/wp-json/wp/v2/taxonomies?type=${encodeURIComponent(postType)}`,
      { headers: { 'Authorization': `Basic ${auth}` } }
    );
    if (!response.ok) return candidates;

    const taxonomies = await response.json();
    for (const [taxonomyName, taxonomy] of Object.entries(taxonomies || {})) {
      const item = taxonomy as any;
      if (item?.visibility?.show_in_rest === false) continue;
      if (item?.hierarchical === false) continue;
      const restBase = String(item?.rest_base || taxonomyName || '').trim();
      const field = restBase;
      addCandidate(field, restBase);
      addCandidate(String(taxonomyName), restBase);
    }
  } catch (error) {
    console.warn(`Failed to fetch taxonomies for post type "${postType}":`, error);
  }

  try {
    const response = await fetch(
      `${config.url}/wp-json/wp/v2/taxonomies`,
      { headers: { 'Authorization': `Basic ${auth}` } }
    );
    if (response.ok) {
      const taxonomies = await response.json();
      for (const [taxonomyName, taxonomy] of Object.entries(taxonomies || {})) {
        const item = taxonomy as any;
        if (item?.visibility?.show_in_rest === false) continue;
        if (item?.hierarchical === false) continue;
        const types = Array.isArray(item?.types) ? item.types.map(String) : [];
        if (!types.includes(postType)) continue;
        const restBase = String(item?.rest_base || taxonomyName || '').trim();
        addCandidate(restBase, restBase);
        addCandidate(String(taxonomyName), restBase);
      }
    }
  } catch (error) {
    console.warn(`Failed to match all taxonomies for post type "${postType}":`, error);
  }

  [
    `${normalizedPostType}_category`,
    `${normalizedPostType}_cat`,
    `${normalizedPostType}-category`,
    `${normalizedPostType}-cat`,
    `${normalizedPostType}_categories`,
    `${normalizedPostType}-categories`,
  ].forEach((candidate) => addCandidate(candidate, candidate));

  if (candidates.length === 0) {
    addCandidate('categories', 'categories');
  }
  console.log(`Taxonomy candidates for post type "${postType}":`, candidates);
  return candidates;
}


export async function resolveTermAssignmentForPostType(
  config: WordPressConfig,
  postType: string,
  categoryIdentifier: string
): Promise<{ field: string; ids: number[] } | null> {
  const trimmed = String(categoryIdentifier || '').trim();
  if (!trimmed) return null;

  const candidates = await getTaxonomyCandidatesForPostType(config, postType);
  const explicitMatch = trimmed.match(/^([A-Za-z0-9_-]+)\s*[:：]\s*(.+)$/);
  if (explicitMatch) {
    const explicitField = explicitMatch[1].trim();
    const explicitTerm = explicitMatch[2].trim();
    const explicitId = await getTermIdBySlugOrName(config, explicitField, explicitTerm);
    if (explicitId) {
      return { field: explicitField, ids: [explicitId] };
    }
    console.warn(`Explicit taxonomy "${explicitField}" did not contain term "${explicitTerm}"`);
  }

  const parsed = parseInt(trimmed, 10);
  if (!isNaN(parsed)) {
    return { field: candidates[0]?.field || 'categories', ids: [parsed] };
  }

  for (const candidate of candidates) {
    const termId = await getTermIdBySlugOrName(config, candidate.restBase, trimmed);
    if (termId) {
      return { field: candidate.field, ids: [termId] };
    }
  }

  return null;
}

