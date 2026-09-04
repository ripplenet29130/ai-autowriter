import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const encoder = new TextEncoder();
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
const sha256 = async (value: string) => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(value)))).map((byte) => byte.toString(16).padStart(2, '0')).join('');

serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  try {
    const { token, status } = await request.json();
    if (!token || !['draft', 'publish'].includes(status)) return json({ error: '投稿内容が不正です' }, 400);

    const url = Deno.env.get('SUPABASE_URL')!;
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    if (!serviceKey) return json({ error: 'SUPABASE_SERVICE_ROLE_KEY が設定されていません' }, 500);
    const admin = createClient(url, serviceKey, { auth: { persistSession: false } });
    const { data: link } = await admin.from('article_review_links').select('id,article_id,permission,expires_at,revoked_at')
      .eq('token_hash', await sha256(token)).maybeSingle();
    if (!link || link.revoked_at || (link.expires_at && new Date(link.expires_at) <= new Date())) return json({ error: 'この共有リンクは利用できません' }, 404);
    if (link.permission !== 'edit') return json({ error: 'WordPressへ投稿する権限がありません' }, 403);

    const { data: article, error: articleError } = await admin.from('articles')
      .select('id,title,content,wordpress_config_id,wordpress_post_id')
      .eq('id', link.article_id).single();
    if (articleError || !article?.wordpress_config_id) return json({ error: '投稿先WordPress設定が見つかりません' }, 404);

    const { data: config, error: configError } = await admin.from('wordpress_configs')
      .select('id,url,username,password,post_type').eq('id', article.wordpress_config_id).single();
    if (configError || !config) return json({ error: 'WordPress設定が見つかりません' }, 404);

    const postType = config.post_type || 'posts';
    const endpoint = `${String(config.url).replace(/\/$/, '')}/wp-json/wp/v2/${postType}${article.wordpress_post_id ? `/${article.wordpress_post_id}` : ''}`;
    const auth = btoa(`${config.username}:${config.password}`);
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Basic ${auth}` },
      body: JSON.stringify({ title: article.title, content: article.content, status }),
    });
    const responseBody = await response.text();
    if (!response.ok) return json({ error: `WordPress投稿に失敗しました (${response.status}): ${responseBody.slice(0, 500)}` }, 502);
    const post = JSON.parse(responseBody);
    const isPublished = status === 'publish';
    const { error: updateError } = await admin.from('articles').update({
      wordpress_post_id: String(post.id), wordpress_url: post.link || null,
      status: isPublished ? 'published' : 'draft', is_published: isPublished,
      published_at: isPublished ? new Date().toISOString() : null,
    }).eq('id', article.id);
    if (updateError) throw updateError;
    return json({ postId: String(post.id), url: post.link || null, status });
  } catch (error) {
    console.error('review-wordpress-publish:', error);
    return json({ error: error instanceof Error ? error.message : 'WordPress投稿に失敗しました' }, 500);
  }
});
