import { supabase } from './supabaseClient';
import { Article, ArticleComment, ArticleReviewLink, ReviewArticlePayload, ReviewPermission } from '../types';

type ReviewAction =
  | 'create-link'
  | 'list-links'
  | 'revoke-link'
  | 'get-review'
  | 'create-comment'
  | 'resolve-comment'
  | 'update-article';

async function invoke<T>(action: ReviewAction, payload: Record<string, unknown>): Promise<T> {
  if (!supabase) throw new Error('データベース接続が設定されていません');
  const { data, error } = await supabase.functions.invoke('article-review', { body: { action, ...payload } });
  if (error) throw new Error(error.message || 'レビュー機能の処理に失敗しました');
  if (data?.error) throw new Error(data.error);
  return data as T;
}

export const articleReviewService = {
  async createLink(articleId: string, permission: ReviewPermission, expiresAt?: string, password?: string) {
    return invoke<{ link: ArticleReviewLink; token: string }>('create-link', { articleId, permission, expiresAt, password });
  },

  async listLinks(articleId: string) {
    return invoke<{ links: ArticleReviewLink[] }>('list-links', { articleId });
  },

  async revokeLink(linkId: string) {
    return invoke<void>('revoke-link', { linkId });
  },

  async getReview(token: string, password?: string) {
    return invoke<ReviewArticlePayload>('get-review', { token, password });
  },

  async createComment(token: string, comment: Pick<ArticleComment, 'field' | 'selectedText' | 'startOffset' | 'endOffset' | 'body' | 'authorName'>) {
    return invoke<{ comment: ArticleComment }>('create-comment', { token, comment });
  },

  async resolveComment(token: string, commentId: string, authorName: string, status: 'open' | 'resolved') {
    return invoke<{ comment: ArticleComment }>('resolve-comment', { token, commentId, authorName, status });
  },

  async updateArticle(token: string, authorName: string, article: Pick<Article, 'title' | 'excerpt' | 'content'>, expectedUpdatedAt?: string) {
    return invoke<{ article: ReviewArticlePayload['article']; revisionId: string }>('update-article', {
      token, authorName, article, expectedUpdatedAt
    });
  }
};
