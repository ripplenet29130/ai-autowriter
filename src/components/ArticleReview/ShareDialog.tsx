import { useState } from 'react';
import { Link2, X } from 'lucide-react';
import toast from 'react-hot-toast';
import type { ReviewPermission } from '../../types';
import { articleReviewService } from '../../services/articleReviewService';
export function ShareDialog({ articleId, onClose }: { articleId: string; onClose: () => void }) {
  const [permission, setPermission] = useState<ReviewPermission>('comment'); const [url, setUrl] = useState(''); const [loading, setLoading] = useState(false);
  const create = async () => { setLoading(true); try { const { token } = await articleReviewService.createLink(articleId, permission); setUrl(`${location.origin}/review/${token}`); } catch (e) { toast.error(e instanceof Error ? e.message : '共有リンクを作成できませんでした'); } finally { setLoading(false); } };
  return <div className="fixed inset-0 z-[70] grid place-items-center bg-black/50 p-4"><div className="w-full max-w-lg rounded-2xl bg-white shadow-2xl"><div className="flex items-center justify-between border-b p-5"><div><h2 className="font-bold">レビューを共有</h2><p className="text-sm text-gray-500">リンクを知っている人だけに記事を共有します</p></div><button onClick={onClose}><X /></button></div><div className="space-y-5 p-5">{url ? <><input className="input-field" readOnly value={url}/><div className="flex justify-center"><button className="btn-primary" onClick={async()=>{await navigator.clipboard.writeText(url);toast.success('コピーしました');}}>リンクをコピー</button></div></> : <><div className="grid grid-cols-3 gap-2">{([['view','閲覧のみ'],['comment','コメント可'],['edit','編集可']] as [ReviewPermission,string][]).map(([v,l])=><button key={v} onClick={()=>setPermission(v)} className={`rounded-lg border p-3 text-sm ${permission===v?'border-blue-600 bg-blue-50 text-blue-700':'border-gray-200'}`}>{l}</button>)}</div><button className="btn-primary flex w-full justify-center gap-2" disabled={loading} onClick={create}><Link2 className="w-4"/>共有リンクを作成</button></>}</div></div></div>;
}
