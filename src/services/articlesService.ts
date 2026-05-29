import { supabase } from './supabaseClient';
import { Article } from '../types';
import { getCurrentAccountId, getRequiredAccountId } from './accountScope';

export interface ArticleFilters {
  status?: string;
  postState?: 'published' | 'unpublished' | 'failed';
  category?: string;
  dateFrom?: string;
  dateTo?: string;
  publishedDateFrom?: string;
  publishedDateTo?: string;
  searchTerm?: string;
}

export interface ArticleSortOptions {
  field: 'created_at' | 'updated_at' | 'title';
  ascending?: boolean;
}

export const articlesService = {
  async createArticle(article: Partial<Article>): Promise<Article | null> {
    try {
      if (!supabase) {
        console.warn('Database disabled: supabase client is null');
        return null;
      }
      const accountId = getRequiredAccountId();
      const { data, error } = await supabase
        .from('articles')
        .insert([{
          account_id: accountId,
          title: article.title,
          content: article.content,
          excerpt: article.excerpt || '',
          keywords: article.keywords || [],
          category: article.category || '',
          status: article.status || 'draft',
          tone: article.tone || 'professional',
          length: article.length || 'medium',
          ai_provider: article.aiProvider || '',
          ai_model: article.aiModel || '',
          scheduled_at: article.scheduledAt,
          published_at: article.publishedAt,
          wordpress_post_id: article.wordPressPostId || '',
          wordpress_config_id: article.wordPressConfigId,
          is_published: article.isPublished || false,
          wordpress_url: article.wordPressUrl || null,
          reading_time: article.readingTime || 0,
          word_count: article.wordCount || 0,
          trend_data: article.trendData || {}
        }])
        .select()
        .single();

      if (error) {
        console.error('險倅ｺ九・菴懈・縺ｫ螟ｱ謨励＠縺ｾ縺励◆:', error);
        return null;
      }

      return this.mapFromDatabase(data);
    } catch (err) {
      console.error('險倅ｺ倶ｽ懈・繧ｨ繝ｩ繝ｼ:', err);
      return null;
    }
  },

  async updateArticle(id: string, updates: Partial<Article>): Promise<Article | null> {
    try {
      if (!supabase) {
        console.warn('Database disabled: supabase client is null');
        return null;
      }
      const updateData: any = {};

      if (updates.title !== undefined) updateData.title = updates.title;
      if (updates.content !== undefined) updateData.content = updates.content;
      if (updates.excerpt !== undefined) updateData.excerpt = updates.excerpt;
      if (updates.keywords !== undefined) updateData.keywords = updates.keywords;
      if (updates.category !== undefined) updateData.category = updates.category;
      if (updates.status !== undefined) updateData.status = updates.status;
      if (updates.tone !== undefined) updateData.tone = updates.tone;
      if (updates.length !== undefined) updateData.length = updates.length;
      if (updates.aiProvider !== undefined) updateData.ai_provider = updates.aiProvider;
      if (updates.aiModel !== undefined) updateData.ai_model = updates.aiModel;
      if (updates.scheduledAt !== undefined) updateData.scheduled_at = updates.scheduledAt;
      if (updates.publishedAt !== undefined) updateData.published_at = updates.publishedAt;
      if (updates.wordPressPostId !== undefined) updateData.wordpress_post_id = updates.wordPressPostId;
      if (updates.wordPressConfigId !== undefined) updateData.wordpress_config_id = updates.wordPressConfigId;
      if (updates.isPublished !== undefined) updateData.is_published = updates.isPublished;
      if (updates.wordPressUrl !== undefined) updateData.wordpress_url = updates.wordPressUrl;
      if (updates.readingTime !== undefined) updateData.reading_time = updates.readingTime;
      if (updates.wordCount !== undefined) updateData.word_count = updates.wordCount;
      if (updates.trendData !== undefined) updateData.trend_data = updates.trendData;

      const { data, error } = await supabase
        .from('articles')
        .update(updateData)
        .eq('id', id)
        .eq('account_id', getRequiredAccountId())
        .select()
        .single();

      if (error) {
        console.error('險倅ｺ九・譖ｴ譁ｰ縺ｫ螟ｱ謨励＠縺ｾ縺励◆:', error);
        return null;
      }

      return this.mapFromDatabase(data);
    } catch (err) {
      console.error('險倅ｺ区峩譁ｰ繧ｨ繝ｩ繝ｼ:', err);
      return null;
    }
  },

  async deleteArticle(id: string, options?: { unpublishedOnly?: boolean }): Promise<boolean> {
    try {
      if (!supabase) return false;
      const accountId = getRequiredAccountId();
      if (options?.unpublishedOnly) {
        const { data: existing, error: fetchError } = await supabase
          .from('articles')
          .select('status, is_published, wordpress_post_id, wordpress_url')
          .eq('id', id)
          .eq('account_id', accountId)
          .single();

        if (fetchError || !existing) {
          console.error('削除対象の記事確認に失敗しました:', fetchError);
          return false;
        }

        const hasWordPressPost = Boolean(
          existing.is_published ||
          existing.status === 'published' ||
          existing.wordpress_post_id ||
          existing.wordpress_url
        );

        if (hasWordPressPost) {
          console.warn('投稿済みの記事削除をブロックしました:', id);
          return false;
        }
      }

      let query = supabase
        .from('articles')
        .delete()
        .eq('id', id)
        .eq('account_id', accountId);

      const { error } = await query;

      if (error) {
        console.error('險倅ｺ九・蜑企勁縺ｫ螟ｱ謨励＠縺ｾ縺励◆:', error);
        return false;
      }

      return true;
    } catch (err) {
      console.error('險倅ｺ句炎髯､繧ｨ繝ｩ繝ｼ:', err);
      return false;
    }
  },

  async getArticle(id: string): Promise<Article | null> {
    try {
      if (!supabase) {
        console.warn('Database disabled: supabase client is null');
        return null;
      }
      const { data, error } = await supabase
        .from('articles')
        .select('*')
        .eq('id', id)
        .eq('account_id', getRequiredAccountId())
        .single();

      if (error) {
        console.error('險倅ｺ九・蜿門ｾ励↓螟ｱ謨励＠縺ｾ縺励◆:', error);
        return null;
      }

      return this.mapFromDatabase(data);
    } catch (err) {
      console.error('險倅ｺ句叙蠕励お繝ｩ繝ｼ:', err);
      return null;
    }
  },

  async getAllArticles(
    filters?: ArticleFilters,
    sort?: ArticleSortOptions,
    limit: number = 50,
    offset: number = 0
  ): Promise<Article[]> {
    try {
      if (!supabase) {
        console.warn('Database disabled: skip fetching articles');
        return [];
      }
      const accountId = getCurrentAccountId();
      let query = supabase.from('articles').select('*');

      if (accountId) {
        query = query.eq('account_id', accountId);
      }

      if (filters?.status) {
        query = query.eq('status', filters.status);
      }

      if (filters?.postState === 'failed') {
        query = query.eq('status', 'failed');
      } else if (filters?.postState === 'published') {
        query = query.or('is_published.eq.true,status.eq.published,wordpress_post_id.not.is.null,wordpress_url.not.is.null');
      } else if (filters?.postState === 'unpublished') {
        query = query
          .neq('status', 'published')
          .neq('status', 'failed')
          .or('is_published.is.null,is_published.eq.false')
          .is('wordpress_post_id', null)
          .is('wordpress_url', null);
      }

      if (filters?.category) {
        query = query.eq('category', filters.category);
      }

      if (filters?.dateFrom) {
        query = query.gte('created_at', filters.dateFrom);
      }

      if (filters?.dateTo) {
        query = query.lte('created_at', filters.dateTo);
      }

      if (filters?.publishedDateFrom) {
        query = query.gte('published_at', filters.publishedDateFrom);
      }

      if (filters?.publishedDateTo) {
        query = query.lte('published_at', filters.publishedDateTo);
      }

      if (filters?.searchTerm) {
        query = query.or(`title.ilike.%${filters.searchTerm}%,content.ilike.%${filters.searchTerm}%`);
      }

      if (sort) {
        query = query.order(sort.field, { ascending: sort.ascending ?? false });
      } else {
        query = query.order('created_at', { ascending: false });
      }

      query = query.range(offset, offset + limit - 1);

      const { data, error } = await query;

      if (error) {
        console.error('險倅ｺ倶ｸ隕ｧ縺ｮ蜿門ｾ励↓螟ｱ謨励＠縺ｾ縺励◆:', error);
        return [];
      }

      return data.map((item: any) => this.mapFromDatabase(item));
    } catch (err) {
      console.error('險倅ｺ倶ｸ隕ｧ蜿門ｾ励お繝ｩ繝ｼ:', err);
      return [];
    }
  },

  async getArticleCount(filters?: ArticleFilters): Promise<number> {
    try {
      if (!supabase) {
        console.warn('Database disabled: supabase client is null');
        return 0;
      }
      const accountId = getCurrentAccountId();
      let query = supabase.from('articles').select('*', { count: 'exact', head: true });

      if (accountId) {
        query = query.eq('account_id', accountId);
      }

      if (filters?.status) {
        query = query.eq('status', filters.status);
      }

      if (filters?.postState === 'failed') {
        query = query.eq('status', 'failed');
      } else if (filters?.postState === 'published') {
        query = query.or('is_published.eq.true,status.eq.published,wordpress_post_id.not.is.null,wordpress_url.not.is.null');
      } else if (filters?.postState === 'unpublished') {
        query = query
          .neq('status', 'published')
          .neq('status', 'failed')
          .or('is_published.is.null,is_published.eq.false')
          .is('wordpress_post_id', null)
          .is('wordpress_url', null);
      }

      if (filters?.category) {
        query = query.eq('category', filters.category);
      }

      if (filters?.dateFrom) {
        query = query.gte('created_at', filters.dateFrom);
      }

      if (filters?.dateTo) {
        query = query.lte('created_at', filters.dateTo);
      }

      if (filters?.publishedDateFrom) {
        query = query.gte('published_at', filters.publishedDateFrom);
      }

      if (filters?.publishedDateTo) {
        query = query.lte('published_at', filters.publishedDateTo);
      }

      if (filters?.searchTerm) {
        query = query.or(`title.ilike.%${filters.searchTerm}%,content.ilike.%${filters.searchTerm}%`);
      }

      const { count, error } = await query;

      if (error) {
        console.error('險倅ｺ区焚縺ｮ蜿門ｾ励↓螟ｱ謨励＠縺ｾ縺励◆:', error);
        return 0;
      }

      return count || 0;
    } catch (err) {
      console.error('險倅ｺ区焚蜿門ｾ励お繝ｩ繝ｼ:', err);
      return 0;
    }
  },

  async getArticlesByStatus(status: string): Promise<Article[]> {
    return this.getAllArticles({ status });
  },

  async getRecentArticles(limit: number = 10): Promise<Article[]> {
    return this.getAllArticles(undefined, { field: 'created_at', ascending: false }, limit);
  },

  mapFromDatabase(data: any): Article {
    return {
      id: data.id,
      title: data.title,
      content: data.content,
      excerpt: data.excerpt || '',
      keywords: data.keywords || [],
      category: data.category || '',
      status: data.status || 'draft',
      tone: data.tone || 'professional',
      length: data.length || 'medium',
      aiProvider: data.ai_provider || '',
      aiModel: data.ai_model || '',
      scheduledAt: data.scheduled_at,
      publishedAt: data.published_at,
      wordPressPostId: data.wordpress_post_id || '',
      wordPressConfigId: data.wordpress_config_id,
      isPublished: data.is_published || false,
      wordPressUrl: data.wordpress_url || '',
      readingTime: data.reading_time || 0,
      wordCount: data.word_count || 0,
      trendData: data.trend_data || {},
      generatedAt: data.created_at,
      updatedAt: data.updated_at
    };
  }
};

