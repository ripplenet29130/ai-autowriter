import { supabase } from './supabaseClient';
import type { Article, ArticleComment, ReviewArticlePayload, ReviewPermission } from '../types';

async function invoke<T>(action: string, payload: Record<string, unknown>): Promise<T> {
  if (!supabase) throw new Error('データベース接続が設定されていません');
  const { data, error } = await supabase.functions.invoke('article-review', { body: { action, ...payload } });
  if (error) {
    const response = error.context as Response | undefined;
    const detail = response ? await response.clone().json().catch(() => undefined) as { error?: string } | undefined : undefined;
    throw new Error(detail?.error || error.message);
  }
  if (data?.error) throw new Error(data.error);
  return data as T;
}
export const articleReviewService = {
  createLink: (articleId: string, permission: ReviewPermission, expiresAt?: string, password?: string) => invoke<{ token: string }>('create-link', { articleId, permission, expiresAt, password }),
  listLinks: (articleId: string) => invoke<{ links: Array<{ id: string; permission: ReviewPermission; expiresAt?: string | null; revokedAt?: string | null; createdAt: string }> }>('list-links', { articleId }),
  revokeLink: (linkId: string) => invoke<void>('revoke-link', { linkId }),
  getReview: (token: string, password?: string) => invoke<ReviewArticlePayload>('get-review', { token, password }),
  createComment: (token: string, comment: Pick<ArticleComment, 'field' | 'selectedText' | 'startOffset' | 'endOffset' | 'body' | 'authorName'>) => invoke<{ comment: ArticleComment }>('create-comment', { token, comment }),
  resolveComment: (token: string, commentId: string, authorName: string, status: 'open' | 'resolved') => invoke<{ comment: ArticleComment }>('resolve-comment', { token, commentId, authorName, status }),
  deleteComment: (token: string, commentId: string) => invoke<void>('delete-comment', { token, commentId }),
  updateArticle: (token: string, authorName: string, article: Pick<Article, 'title' | 'excerpt' | 'content'>, expectedUpdatedAt?: string) => invoke<{ article: ReviewArticlePayload['article'] }>('update-article', { token, authorName, article, expectedUpdatedAt }),
  publishToWordPress: (token: string, status: 'draft' | 'publish') => {
    if (!supabase) throw new Error('データベース接続が設定されていません');
    return supabase.functions.invoke<{ postId: string; url?: string | null; status: 'draft' | 'publish' }>('review-wordpress-publish', { body: { token, status } })
      .then(({ data, error }) => { if (error) throw error; if (!data) throw new Error('WordPress投稿結果を取得できません'); return data; });
  },
};
