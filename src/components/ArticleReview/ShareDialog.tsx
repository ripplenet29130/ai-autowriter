import React, { useState } from 'react';
import { Check, Copy, Link2, Loader2, X } from 'lucide-react';
import toast from 'react-hot-toast';
import { ReviewPermission } from '../../types';
import { articleReviewService } from '../../services/articleReviewService';
import { ReviewAdminAuth } from './ReviewAdminAuth';

interface Props { articleId: string; onClose: () => void; }

export const ShareDialog: React.FC<Props> = ({ articleId, onClose }) => {
  const [permission, setPermission] = useState<ReviewPermission>('comment');
  const [expiresAt, setExpiresAt] = useState('');
  const [password, setPassword] = useState('');
  const [isCreating, setIsCreating] = useState(false);
  const [url, setUrl] = useState('');
  const [isAuthenticated, setIsAuthenticated] = useState(false);

  const createLink = async () => {
    setIsCreating(true);
    try {
      const { token } = await articleReviewService.createLink(articleId, permission, expiresAt || undefined, password || undefined);
      setUrl(`${window.location.origin}/review/${token}`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '共有リンクを作成できませんでした');
    } finally { setIsCreating(false); }
  };

  const copy = async () => {
    await navigator.clipboard.writeText(url);
    toast.success('共有リンクをコピーしました');
  };

  return <div className="fixed inset-0 z-[70] bg-black/50 p-4 flex items-center justify-center">
    <div className="w-full max-w-lg rounded-xl bg-white shadow-2xl">
      <div className="flex items-center justify-between border-b border-gray-200 px-6 py-4">
        <div><h2 className="font-bold text-gray-900">レビューを共有</h2><p className="text-sm text-gray-500 mt-1">リンクを知っている人だけに記事を共有します</p></div>
        <button onClick={onClose} className="p-2 text-gray-500 hover:bg-gray-100 rounded"><X className="w-5 h-5" /></button>
      </div>
      <div className="p-6 space-y-5">
        {!url ? <>
          <ReviewAdminAuth onAuthenticated={setIsAuthenticated} />
          <label className="block text-sm font-medium text-gray-700">共有する権限</label>
          <div className="grid grid-cols-3 gap-2">
            {([['view', '閲覧のみ'], ['comment', 'コメント可'], ['edit', '編集可']] as [ReviewPermission, string][]).map(([value, label]) =>
              <button key={value} onClick={() => setPermission(value)} className={`rounded-lg border px-3 py-3 text-sm font-medium ${permission === value ? 'border-blue-600 bg-blue-50 text-blue-700' : 'border-gray-200 text-gray-600'}`}>{label}</button>
            )}
          </div>
          <div><label className="block text-sm font-medium text-gray-700 mb-1">有効期限（任意）</label><input type="datetime-local" value={expiresAt} onChange={e => setExpiresAt(e.target.value)} className="input-field" /></div>
          <div><label className="block text-sm font-medium text-gray-700 mb-1">パスワード（任意）</label><input type="password" value={password} onChange={e => setPassword(e.target.value)} className="input-field" placeholder="設定しない場合は空欄" /></div>
          <button onClick={createLink} disabled={isCreating || !isAuthenticated} className="btn-primary w-full flex items-center justify-center gap-2 disabled:opacity-50">{isCreating ? <Loader2 className="w-4 h-4 animate-spin" /> : <Link2 className="w-4 h-4" />}共有リンクを作成</button>
        </> : <>
          <div className="rounded-lg border border-green-200 bg-green-50 p-4 flex gap-3"><Check className="w-5 h-5 text-green-600 shrink-0" /><p className="text-sm text-green-800">共有リンクを作成しました。必要に応じて、記事一覧からいつでも無効化できます。</p></div>
          <div className="flex gap-2"><input readOnly value={url} className="input-field text-sm" /><button onClick={copy} className="btn-secondary shrink-0" title="コピー"><Copy className="w-4 h-4" /></button></div>
          <button onClick={onClose} className="btn-primary w-full">完了</button>
        </>}
      </div>
    </div>
  </div>;
};
