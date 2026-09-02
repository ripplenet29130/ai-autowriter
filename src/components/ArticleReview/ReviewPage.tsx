import React, { useEffect, useMemo, useRef, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Check, Loader2, MessageSquare, Send, X } from 'lucide-react';
import { ArticleComment, ReviewArticlePayload } from '../../types';
import { articleReviewService } from '../../services/articleReviewService';

interface Selection { text: string; start: number; end: number; }

function selectedOffsets(root: HTMLElement): Selection | null {
  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0 || selection.isCollapsed) return null;
  const range = selection.getRangeAt(0);
  if (!root.contains(range.commonAncestorContainer)) return null;
  const text = selection.toString().trim();
  if (!text) return null;
  const before = range.cloneRange();
  before.selectNodeContents(root);
  before.setEnd(range.startContainer, range.startOffset);
  return { text, start: before.toString().length, end: before.toString().length + text.length };
}

export const ReviewPage: React.FC<{ token: string }> = ({ token }) => {
  const [review, setReview] = useState<ReviewArticlePayload | null>(null);
  const [password, setPassword] = useState('');
  const [authorName, setAuthorName] = useState(() => localStorage.getItem(`reviewer:${token}`) || '');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [selection, setSelection] = useState<Selection | null>(null);
  const [commentBody, setCommentBody] = useState('');
  const [saving, setSaving] = useState(false);
  const articleRef = useRef<HTMLDivElement>(null);

  const load = async (providedPassword?: string) => {
    setLoading(true); setError('');
    try { setReview(await articleReviewService.getReview(token, providedPassword)); }
    catch (e) { setError(e instanceof Error ? e.message : 'レビューを読み込めませんでした'); }
    finally { setLoading(false); }
  };
  useEffect(() => { load(); }, [token]); // eslint-disable-line react-hooks/exhaustive-deps

  const canComment = review?.permission === 'comment' || review?.permission === 'edit';
  const canEdit = review?.permission === 'edit';
  const comments = useMemo(() => review?.comments.filter(c => !c.parentId) || [], [review]);

  const addComment = async () => {
    if (!selection || !commentBody.trim() || !authorName.trim()) return;
    setSaving(true);
    try {
      const { comment } = await articleReviewService.createComment(token, { field: 'content', selectedText: selection.text, startOffset: selection.start, endOffset: selection.end, body: commentBody.trim(), authorName: authorName.trim() });
      localStorage.setItem(`reviewer:${token}`, authorName.trim());
      setReview(current => current ? { ...current, comments: [comment, ...current.comments] } : current);
      setSelection(null); setCommentBody(''); window.getSelection()?.removeAllRanges();
    } catch (e) { setError(e instanceof Error ? e.message : 'コメントを保存できませんでした'); }
    finally { setSaving(false); }
  };

  const resolve = async (comment: ArticleComment) => {
    if (!authorName.trim()) { setError('コメントを解決するには表示名を入力してください'); return; }
    try {
      const status = comment.status === 'open' ? 'resolved' : 'open';
      const { comment: updated } = await articleReviewService.resolveComment(token, comment.id, authorName, status);
      setReview(current => current ? { ...current, comments: current.comments.map(c => c.id === updated.id ? { ...c, ...updated } : c) } : current);
    } catch (e) { setError(e instanceof Error ? e.message : 'コメントを更新できませんでした'); }
  };

  const saveArticle = async (article: ReviewArticlePayload['article']) => {
    if (!authorName.trim()) { setError('編集前に表示名を入力してください'); return; }
    setSaving(true);
    try {
      const updatedAt = review?.article.updatedAt;
      const expectedUpdatedAt = updatedAt instanceof Date ? updatedAt.toISOString() : updatedAt;
      const result = await articleReviewService.updateArticle(token, authorName, article, expectedUpdatedAt);
      setReview(current => current ? { ...current, article: result.article, revisionId: result.revisionId } : current);
      localStorage.setItem(`reviewer:${token}`, authorName.trim());
    } catch (e) { setError(e instanceof Error ? e.message : '保存できませんでした'); }
    finally { setSaving(false); }
  };

  if (loading) return <div className="min-h-screen grid place-items-center text-gray-600"><Loader2 className="w-6 h-6 animate-spin" /></div>;
  if (!review) return <main className="min-h-screen bg-gray-50 grid place-items-center p-4"><section className="w-full max-w-md bg-white rounded-xl shadow p-6 space-y-4"><h1 className="text-xl font-bold">レビューを開けません</h1><p className="text-gray-600 text-sm">{error || '共有リンクを確認してください。'}</p><input type="password" placeholder="パスワードが必要な場合" value={password} onChange={e => setPassword(e.target.value)} className="input-field" /><button onClick={() => load(password)} className="btn-primary w-full">再試行</button></section></main>;

  return <main className="min-h-screen bg-gray-100 text-gray-900">
    <header className="sticky top-0 z-20 bg-white border-b border-gray-200"><div className="max-w-7xl mx-auto px-4 py-3 flex items-center justify-between"><span className="font-semibold">記事レビュー</span><span className="text-xs rounded-full bg-blue-50 text-blue-700 px-3 py-1">{review.permission === 'view' ? '閲覧のみ' : review.permission === 'comment' ? 'コメント可' : '編集可'}</span></div></header>
    <div className="max-w-7xl mx-auto grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_340px] gap-6 p-4 lg:p-8">
      <article className="bg-white border border-gray-200 rounded-xl p-6 lg:p-10 shadow-sm">
        <div className="mb-8 flex flex-col sm:flex-row gap-3 sm:items-end sm:justify-between"><div><label className="block text-xs font-medium text-gray-500 mb-1">レビュー参加者名</label><input value={authorName} onChange={e => setAuthorName(e.target.value)} placeholder="例：山田 花子" className="input-field max-w-xs" /></div>{saving && <span className="text-sm text-blue-600">保存中…</span>}</div>
        {canEdit ? <EditableArticle article={review.article} onSave={saveArticle} saving={saving} /> : <ReadArticle article={review.article} rootRef={articleRef} commentTexts={comments.map(comment => comment.selectedText).filter((text): text is string => Boolean(text))} onSelect={() => { const value = articleRef.current && selectedOffsets(articleRef.current); if (value) setSelection(value); }} />}
        {canComment && !canEdit && <div className="fixed inset-x-0 bottom-0 z-30 border-t border-blue-200 bg-white/95 p-4 shadow-[0_-8px_24px_rgba(15,23,42,0.12)] backdrop-blur"><div className="mx-auto max-w-3xl rounded-xl border border-blue-200 bg-blue-50 p-4"><div className="flex justify-end"><button onClick={() => { setSelection(null); setCommentBody(''); window.getSelection()?.removeAllRanges(); }} className="rounded p-1 text-blue-700 hover:bg-blue-100" title="選択を解除"><X className="w-4 h-4" /></button></div><div className="flex flex-col gap-3 sm:flex-row sm:items-end"><textarea value={commentBody} onChange={e => setCommentBody(e.target.value)} placeholder={selection ? 'コメントを入力' : '本文を選択してからコメントを入力'} rows={2} className="input-field flex-1" disabled={!selection} /><button onClick={addComment} disabled={saving || !selection || !commentBody.trim() || !authorName.trim()} className="btn-primary shrink-0 flex items-center justify-center gap-2 disabled:opacity-50"><Send className="w-4 h-4" />コメントを投稿</button></div></div></div>}
      </article>
      <aside className="bg-white border border-gray-200 rounded-xl shadow-sm h-fit lg:sticky lg:top-20"><div className="p-4 border-b font-semibold flex gap-2"><MessageSquare className="w-5 h-5 text-blue-600" />コメント ({comments.length})</div><div className="max-h-[70vh] overflow-y-auto divide-y divide-gray-100">{comments.length ? comments.map(comment => <CommentCard key={comment.id} comment={comment} canResolve={canComment} onResolve={() => resolve(comment)} />) : <p className="p-5 text-sm text-gray-500">コメントはまだありません。</p>}</div></aside>
    </div>
    {error && <div className="fixed bottom-4 left-1/2 -translate-x-1/2 max-w-lg bg-red-600 text-white px-4 py-3 rounded-lg shadow">{error}</div>}
  </main>;
};

const ReadArticle: React.FC<{ article: ReviewArticlePayload['article']; rootRef: React.RefObject<HTMLDivElement>; commentTexts: string[]; onSelect: () => void }> = ({ article, rootRef, commentTexts, onSelect }) => {
  const highlightKey = commentTexts.join('\u0000');
  useEffect(() => {
    const root = rootRef.current;
    if (!root || !commentTexts.length) return;
    const phrases = [...new Set(commentTexts.filter(Boolean))];
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    const textNodes: Text[] = [];
    while (walker.nextNode()) textNodes.push(walker.currentNode as Text);
    textNodes.forEach(node => {
      const source = node.textContent || '';
      const phrase = phrases.find(item => source.includes(item));
      if (!phrase || !node.parentElement) return;
      const fragment = document.createDocumentFragment();
      let remaining = source;
      while (remaining.includes(phrase)) {
        const index = remaining.indexOf(phrase);
        fragment.append(remaining.slice(0, index));
        const mark = document.createElement('mark');
        mark.dataset.reviewHighlight = 'true';
        mark.className = 'bg-yellow-200 text-inherit rounded-sm px-0.5';
        mark.textContent = phrase;
        fragment.append(mark);
        remaining = remaining.slice(index + phrase.length);
      }
      fragment.append(remaining);
      node.replaceWith(fragment);
    });
  }, [highlightKey, rootRef]);
  return <><h1 className="text-3xl font-bold mb-6">{article.title}</h1>{article.excerpt && <p className="p-4 bg-gray-50 border-l-4 border-gray-300 italic text-gray-600 mb-8">{article.excerpt}</p>}<div ref={rootRef} onMouseUp={onSelect} className="article-prose select-text"><ReactMarkdown key={highlightKey} remarkPlugins={[remarkGfm]}>{article.content}</ReactMarkdown></div></>;
};

const EditableArticle: React.FC<{ article: ReviewArticlePayload['article']; onSave: (article: ReviewArticlePayload['article']) => void; saving: boolean }> = ({ article, onSave, saving }) => {
  const [draft, setDraft] = useState(article);
  useEffect(() => setDraft(article), [article]);
  return <div className="space-y-4"><input value={draft.title} onChange={e => setDraft({ ...draft, title: e.target.value })} className="input-field text-2xl font-bold" /><textarea value={draft.excerpt || ''} onChange={e => setDraft({ ...draft, excerpt: e.target.value })} rows={3} className="input-field" placeholder="抜粋" /><textarea value={draft.content} onChange={e => setDraft({ ...draft, content: e.target.value })} rows={24} className="input-field font-mono text-sm" /><button onClick={() => onSave(draft)} disabled={saving} className="btn-primary flex items-center gap-2"><Check className="w-4 h-4" />変更を保存</button></div>;
};

const CommentCard: React.FC<{ comment: ArticleComment; canResolve: boolean; onResolve: () => void }> = ({ comment, canResolve, onResolve }) => <div className="p-4 space-y-2"><div className="flex justify-between gap-2"><span className="font-medium text-sm">{comment.authorName}</span><span className={`text-xs ${comment.status === 'resolved' ? 'text-green-600' : 'text-amber-600'}`}>{comment.status === 'resolved' ? '解決済み' : '未解決'}</span></div>{comment.selectedText && <blockquote className="border-l-2 border-blue-300 pl-2 text-xs text-gray-500 line-clamp-3">{comment.selectedText}</blockquote>}<p className="text-sm whitespace-pre-wrap">{comment.body}</p>{canResolve && <div className="flex justify-end"><button onClick={onResolve} className="rounded-md border border-blue-200 bg-white px-3 py-1.5 text-xs font-medium text-blue-700 hover:bg-blue-50">{comment.status === 'open' ? '解決にする' : '再オープン'}</button></div>}</div>;
