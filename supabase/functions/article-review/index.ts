import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

type Permission = 'view' | 'comment' | 'edit';
const encoder = new TextEncoder();
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
const sha256 = async (value: string) => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(value)))).map(byte => byte.toString(16).padStart(2, '0')).join('');
const newToken = () => Array.from(crypto.getRandomValues(new Uint8Array(32))).map(byte => byte.toString(16).padStart(2, '0')).join('');

serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  try {
    const body = await request.json();
    const url = Deno.env.get('SUPABASE_URL')!;
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    if (!serviceKey) return json({ error: 'SUPABASE_SERVICE_ROLE_KEY が設定されていません' }, 500);
    const admin = createClient(url, serviceKey, { auth: { persistSession: false } });
    const action = body.action as string;

    if (action === 'get-review' || action === 'create-comment' || action === 'resolve-comment' || action === 'update-article') {
      const link = await validLink(admin, body.token, body.password);
      if (!link) return json({ error: 'この共有リンクは利用できません' }, 404);
      if (action === 'get-review') return getReview(admin, link);
      if (action === 'create-comment') return createComment(admin, link, body.comment);
      if (action === 'resolve-comment') return resolveComment(admin, link, body.commentId, body.authorName, body.status);
      return updateArticle(admin, link, body.article, body.authorName, body.expectedUpdatedAt);
    }

    // 共有リンクの管理は所有者のSupabase Authセッションを必須とする。
    const caller = await getUser(request, url, serviceKey);
    if (!caller) return json({ error: '共有リンクの管理にはログインが必要です' }, 401);
    if (action === 'create-link') return createLink(admin, caller.id, body);
    if (action === 'list-links') return listLinks(admin, body.articleId, caller.id);
    if (action === 'revoke-link') return revokeLink(admin, body.linkId, caller.id);
    return json({ error: '未対応の操作です' }, 400);
  } catch (error) {
    console.error('article-review:', error);
    return json({ error: error instanceof Error ? error.message : 'レビュー処理に失敗しました' }, 500);
  }
});

async function getUser(request: Request, url: string, serviceKey: string) {
  const auth = request.headers.get('Authorization');
  if (!auth) return null;
  const client = createClient(url, serviceKey, { global: { headers: { Authorization: auth } }, auth: { persistSession: false } });
  const { data } = await client.auth.getUser();
  return data.user;
}

async function validLink(admin: any, token: string, password?: string) {
  if (!token || token.length < 32) return null;
  const { data: link } = await admin.from('article_review_links').select('*').eq('token_hash', await sha256(token)).maybeSingle();
  if (!link || link.revoked_at || (link.expires_at && new Date(link.expires_at) <= new Date())) return null;
  if (link.password_hash && (!password || await sha256(password) !== link.password_hash)) throw new Error('パスワードが正しくありません');
  await admin.from('article_review_links').update({ last_accessed_at: new Date().toISOString() }).eq('id', link.id);
  return link;
}

async function createLink(admin: any, userId: string, body: any) {
  if (!['view', 'comment', 'edit'].includes(body.permission)) return json({ error: '共有権限が不正です' }, 400);
  const { data: article } = await admin.from('articles').select('id').eq('id', body.articleId).maybeSingle();
  if (!article) return json({ error: '記事が見つかりません' }, 404);
  const token = newToken();
  const expiresAt = body.expiresAt ? new Date(body.expiresAt).toISOString() : null;
  if (expiresAt && new Date(expiresAt) <= new Date()) return json({ error: '有効期限は未来の日時にしてください' }, 400);
  const { data, error } = await admin.from('article_review_links').insert({ article_id: article.id, token_hash: await sha256(token), permission: body.permission, password_hash: body.password ? await sha256(body.password) : null, expires_at: expiresAt, created_by: userId }).select().single();
  if (error) throw error;
  return json({ link: mapLink(data), token });
}

async function listLinks(admin: any, articleId: string, userId: string) {
  const { data, error } = await admin.from('article_review_links').select('*').eq('article_id', articleId).eq('created_by', userId).order('created_at', { ascending: false });
  if (error) throw error;
  return json({ links: (data || []).map(mapLink) });
}

async function revokeLink(admin: any, linkId: string, userId: string) {
  const { data, error } = await admin.from('article_review_links').update({ revoked_at: new Date().toISOString() }).eq('id', linkId).eq('created_by', userId).select('id').maybeSingle();
  if (error) throw error;
  if (!data) return json({ error: '共有リンクが見つからないか、操作権限がありません' }, 404);
  return json({});
}

function mapLink(row: any) { return { id: row.id, articleId: row.article_id, permission: row.permission, expiresAt: row.expires_at, revokedAt: row.revoked_at, lastAccessedAt: row.last_accessed_at, createdAt: row.created_at }; }
function mapComment(row: any) { return { id: row.id, articleId: row.article_id, parentId: row.parent_id, field: row.field, selectedText: row.selected_text, startOffset: row.start_offset, endOffset: row.end_offset, body: row.body, authorName: row.author_name, status: row.status, createdAt: row.created_at, updatedAt: row.updated_at }; }

async function getReview(admin: any, link: any) {
  const [{ data: article, error }, { data: comments }] = await Promise.all([
    admin.from('articles').select('id,title,excerpt,content,updated_at').eq('id', link.article_id).single(),
    admin.from('article_comments').select('*').eq('article_id', link.article_id).order('created_at', { ascending: true })
  ]);
  if (error || !article) return json({ error: '記事が見つかりません' }, 404);
  const { data: latest } = await admin.from('article_revisions').select('id').eq('article_id', link.article_id).order('revision_number', { ascending: false }).limit(1).maybeSingle();
  return json({ article: { id: article.id, title: article.title, excerpt: article.excerpt || '', content: article.content, updatedAt: article.updated_at }, permission: link.permission, comments: (comments || []).map(mapComment), revisionId: latest?.id });
}

async function createComment(admin: any, link: any, comment: any) {
  if (!canComment(link.permission)) return json({ error: 'コメントを投稿する権限がありません' }, 403);
  if (!comment?.body?.trim() || !comment?.authorName?.trim()) return json({ error: 'コメント本文と表示名は必須です' }, 400);
  const { data: latest } = await admin.from('article_revisions').select('id').eq('article_id', link.article_id).order('revision_number', { ascending: false }).limit(1).maybeSingle();
  const { data, error } = await admin.from('article_comments').insert({ article_id: link.article_id, review_link_id: link.id, field: comment.field || 'content', selected_text: comment.selectedText || null, start_offset: Number.isInteger(comment.startOffset) ? comment.startOffset : null, end_offset: Number.isInteger(comment.endOffset) ? comment.endOffset : null, revision_id: latest?.id || null, body: comment.body.trim(), author_name: comment.authorName.trim() }).select().single();
  if (error) throw error;
  return json({ comment: mapComment(data) });
}

async function resolveComment(admin: any, link: any, commentId: string, authorName: string, status: 'open' | 'resolved') {
  if (!canComment(link.permission) || !['open', 'resolved'].includes(status) || !authorName?.trim()) return json({ error: 'コメントを更新する権限がありません' }, 403);
  const { data: original } = await admin.from('article_comments').select('*').eq('id', commentId).eq('article_id', link.article_id).maybeSingle();
  if (!original) return json({ error: 'コメントが見つかりません' }, 404);
  const { data, error } = await admin.from('article_comments').update({ status, resolved_at: status === 'resolved' ? new Date().toISOString() : null, resolved_by: status === 'resolved' ? authorName.trim() : null }).eq('id', commentId).select().single();
  if (error) throw error;
  return json({ comment: mapComment(data) });
}

async function updateArticle(admin: any, link: any, article: any, authorName: string, expectedUpdatedAt?: string) {
  if (link.permission !== 'edit') return json({ error: '記事を編集する権限がありません' }, 403);
  if (!authorName?.trim() || !article?.title?.trim() || !article?.content?.trim()) return json({ error: '表示名、タイトル、本文は必須です' }, 400);
  const { data: current } = await admin.from('articles').select('id,updated_at').eq('id', link.article_id).single();
  if (!current) return json({ error: '記事が見つかりません' }, 404);
  if (expectedUpdatedAt && current.updated_at !== expectedUpdatedAt) return json({ error: '他の変更があります。最新の内容を読み込んでから保存してください' }, 409);
  const { data: revision } = await admin.from('article_revisions').select('revision_number').eq('article_id', link.article_id).order('revision_number', { ascending: false }).limit(1).maybeSingle();
  const revisionNumber = (revision?.revision_number || 0) + 1;
  const { data: saved, error } = await admin.from('articles').update({ title: article.title.trim(), excerpt: article.excerpt || '', content: article.content }).eq('id', link.article_id).select('id,title,excerpt,content,updated_at').single();
  if (error) throw error;
  const { data: createdRevision, error: revisionError } = await admin.from('article_revisions').insert({ article_id: link.article_id, revision_number: revisionNumber, title: saved.title, excerpt: saved.excerpt || '', content: saved.content, change_source: 'reviewer', author_name: authorName.trim() }).select('id').single();
  if (revisionError) throw revisionError;
  return json({ article: { id: saved.id, title: saved.title, excerpt: saved.excerpt || '', content: saved.content, updatedAt: saved.updated_at }, revisionId: createdRevision.id });
}

function canComment(permission: Permission) { return permission === 'comment' || permission === 'edit'; }
