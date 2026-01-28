import { supabase } from './supabaseClient';
import { Article } from '../types';

export interface ArticleFilters {
  status?: string;
  category?: string;
  dateFrom?: string;
  dateTo?: string;
  searchTerm?: string;
}

export interface ArticleSortOptions {
  field: 'created_at' | 'updated_at' | 'title' | 'seo_score';
  ascending?: boolean;
}

export const articlesService = {
  async createArticle(article: Partial<Article>): Promise<Article | null> {
    try {
      if (!supabase) {
        console.warn('Database disabled: supabase client is null');
        return null;
      }
      const { data, error } = await supabase
        .from('articles')
        .insert([{
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
          seo_score: article.seoScore || 0,
          reading_time: article.readingTime || 0,
          word_count: article.wordCount || 0,
          trend_data: article.trendData || {}
        }])
        .select()
        .single();

      if (error) {
        console.error('記事の作成に失敗しました:', error);
        return null;
      }

      return this.mapFromDatabase(data);
    } catch (err) {
      console.error('記事作成エラー:', err);
      return null;
    }
  },

  async updateArticle(id: string, updates: Partial<Article>): Promise<Article | null> {
    try {
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
      if (updates.seoScore !== undefined) updateData.seo_score = updates.seoScore;
      if (updates.readingTime !== undefined) updateData.reading_time = updates.readingTime;
      if (updates.wordCount !== undefined) updateData.word_count = updates.wordCount;
      if (updates.trendData !== undefined) updateData.trend_data = updates.trendData;

      const { data, error } = await supabase
        .from('articles')
        .update(updateData)
        .eq('id', id)
        .select()
        .single();

      if (error) {
        console.error('記事の更新に失敗しました:', error);
        return null;
      }

      return this.mapFromDatabase(data);
    } catch (err) {
      console.error('記事更新エラー:', err);
      return null;
    }
  },

  async deleteArticle(id: string): Promise<boolean> {
    try {
      if (!supabase) return false;
      const { error } = await supabase
        .from('articles')
        .delete()
        .eq('id', id);

      if (error) {
        console.error('記事の削除に失敗しました:', error);
        return false;
      }

      return true;
    } catch (err) {
      console.error('記事削除エラー:', err);
      return false;
    }
  },

  async getArticle(id: string): Promise<Article | null> {
    try {
      const { data, error } = await supabase
        .from('articles')
        .select('*')
        .eq('id', id)
        .single();

      if (error) {
        console.error('記事の取得に失敗しました:', error);
        return null;
      }

      return this.mapFromDatabase(data);
    } catch (err) {
      console.error('記事取得エラー:', err);
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
      let query = supabase.from('articles').select('*');

      if (filters?.status) {
        query = query.eq('status', filters.status);
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
        console.error('記事一覧の取得に失敗しました:', error);
        return [];
      }

      return data.map((item: any) => this.mapFromDatabase(item));
    } catch (err) {
      console.error('記事一覧取得エラー:', err);
      return [];
    }
  },

  async getArticleCount(filters?: ArticleFilters): Promise<number> {
    try {
      let query = supabase.from('articles').select('*', { count: 'exact', head: true });

      if (filters?.status) {
        query = query.eq('status', filters.status);
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

      if (filters?.searchTerm) {
        query = query.or(`title.ilike.%${filters.searchTerm}%,content.ilike.%${filters.searchTerm}%`);
      }

      const { count, error } = await query;

      if (error) {
        console.error('記事数の取得に失敗しました:', error);
        return 0;
      }

      return count || 0;
    } catch (err) {
      console.error('記事数取得エラー:', err);
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
      seoScore: data.seo_score || 0,
      readingTime: data.reading_time || 0,
      wordCount: data.word_count || 0,
      trendData: data.trend_data || {},
      generatedAt: data.created_at,
      updatedAt: data.updated_at
    };
  }
};
