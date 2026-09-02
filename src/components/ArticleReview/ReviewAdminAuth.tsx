import React, { useEffect, useState } from 'react';
import { LogIn, LogOut, Mail, UserRoundPlus } from 'lucide-react';
import toast from 'react-hot-toast';
import { supabase } from '../../services/supabaseClient';

interface Props { onAuthenticated: (isAuthenticated: boolean) => void; }

export const ReviewAdminAuth: React.FC<Props> = ({ onAuthenticated }) => {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [mode, setMode] = useState<'signIn' | 'signUp'>('signIn');
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [userEmail, setUserEmail] = useState<string | null>(null);

  const refresh = async () => {
    if (!supabase) { setLoading(false); return; }
    const { data } = await supabase.auth.getSession();
    setUserEmail(data.session?.user.email ?? null);
    onAuthenticated(Boolean(data.session));
    setLoading(false);
  };
  useEffect(() => { refresh(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!supabase) { toast.error('Supabase接続が設定されていません'); return; }
    setSubmitting(true);
    try {
      if (mode === 'signIn') {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
        toast.success('管理者としてログインしました');
      } else {
        const { data, error } = await supabase.auth.signUp({ email, password });
        if (error) throw error;
        toast.success(data.session ? 'アカウントを作成しました' : '確認メールを送信しました。メール内のリンクを開いてください。');
      }
      await refresh();
    } catch (error) { toast.error(error instanceof Error ? error.message : 'ログインに失敗しました'); }
    finally { setSubmitting(false); }
  };

  if (loading) return <div className="text-sm text-gray-500">ログイン状態を確認中…</div>;
  if (userEmail) return <div className="rounded-lg bg-gray-50 border border-gray-200 p-3 flex items-center justify-between gap-3"><div><p className="text-xs text-gray-500">管理者としてログイン中</p><p className="text-sm font-medium text-gray-800">{userEmail}</p></div><button onClick={async () => { await supabase?.auth.signOut(); await refresh(); }} className="text-xs text-gray-600 hover:text-red-600 flex gap-1 items-center"><LogOut className="w-3 h-3" />ログアウト</button></div>;

  return <form onSubmit={submit} className="space-y-3 rounded-lg border border-blue-100 bg-blue-50/50 p-4"><div className="flex items-center justify-between"><p className="text-sm font-semibold text-blue-950">共有リンクを発行するにはログイン</p><button type="button" onClick={() => setMode(mode === 'signIn' ? 'signUp' : 'signIn')} className="text-xs text-blue-700 hover:underline">{mode === 'signIn' ? '初回登録はこちら' : 'ログインはこちら'}</button></div><input type="email" required value={email} onChange={e => setEmail(e.target.value)} placeholder="メールアドレス" className="input-field" /><input type="password" required minLength={6} value={password} onChange={e => setPassword(e.target.value)} placeholder="パスワード（6文字以上）" className="input-field" /><button disabled={submitting} className="btn-secondary w-full flex justify-center items-center gap-2 disabled:opacity-50">{mode === 'signIn' ? <LogIn className="w-4 h-4" /> : <UserRoundPlus className="w-4 h-4" />}{submitting ? '処理中…' : mode === 'signIn' ? 'ログイン' : 'アカウントを作成'}</button><p className="text-xs text-blue-800 flex gap-1"><Mail className="w-3 h-3 mt-0.5 shrink-0" />登録時に確認メールが届く設定の場合は、メール内の確認を完了してください。</p></form>;
};
