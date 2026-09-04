import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';

const corsHeaders = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type', 'Access-Control-Allow-Methods': 'POST, OPTIONS' };
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  try {
    const url = Deno.env.get('SUPABASE_URL')!;
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const auth = request.headers.get('Authorization');
    if (!auth) return json({ error: 'ChatWork設定の変更にはログインが必要です' }, 401);
    const callerClient = createClient(url, serviceKey, { global: { headers: { Authorization: auth } }, auth: { persistSession: false } });
    const { data: { user } } = await callerClient.auth.getUser();
    if (!user) return json({ error: 'ChatWork設定の変更にはログインが必要です' }, 401);
    const admin = createClient(url, serviceKey, { auth: { persistSession: false } });
    const body = await request.json();
    if (body.action === 'get') {
      const { data, error } = await admin.from('chatwork_settings').select('api_token,updated_at').eq('id', true).maybeSingle();
      if (error) throw error;
      return json({ configured: Boolean(data?.api_token), updatedAt: data?.updated_at || null });
    }
    if (body.action === 'save') {
      const token = String(body.apiToken || '').trim();
      if (!token) return json({ error: 'ChatWork APIトークンを入力してください' }, 400);
      const { error } = await admin.from('chatwork_settings').upsert({ id: true, api_token: token, updated_at: new Date().toISOString(), updated_by: user.id });
      if (error) throw error;
      return json({ configured: true });
    }
    return json({ error: '未対応の操作です' }, 400);
  } catch (error) {
    console.error('chatwork-settings:', error);
    return json({ error: error instanceof Error ? error.message : 'ChatWork設定の処理に失敗しました' }, 500);
  }
});
