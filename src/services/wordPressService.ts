import axios from 'axios';
import { Article, ScheduleSettings } from '../types';
import { supabase } from './supabaseClient';
import { convertToGutenbergBlocks } from '../utils/markdownToHtml';

export interface WordPressConfig {
  id: string;
  name: string;
  url: string;
  username: string;
  applicationPassword: string;
  isActive: boolean;
  defaultCategory?: string;
  postType?: string;
  scheduleSettings?: ScheduleSettings;
}

export class WordPressService {
  private config: WordPressConfig | null = null;

  constructor(config?: WordPressConfig) {
    if (config) {
      this.config = config;
    }
  }


  async loadActiveConfig(): Promise<void> {
    if (!supabase) {
      throw new Error("Supabase client is not initialized");
    }
    const { data, error } = await supabase
      .from("wordpress_configs")
      .select("*")
      .eq("is_active", true)
      .limit(1);

    if (error || !data || data.length === 0) {
      console.error("WordPress設定の取得に失敗しました:", error?.message);
      throw new Error("WordPress設定が見つかりません。");
    }

    const configData = data[0];

    this.config = {
      id: configData.id,
      name: configData.name,
      url: configData.url,
      username: configData.username,
      applicationPassword: configData.password, // Supabase側が「password」カラムの場合
      isActive: configData.is_active,
      defaultCategory: configData.default_category || "",
    };
  }

  async testConnection(): Promise<boolean> {
    if (!this.config) {
      await this.loadActiveConfig();
    }
    if (!this.config) {
      return false;
    }
    try {
      const response = await axios.get(`${this.config.url}/wp-json/wp/v2/posts`, {
        headers: this.getAuthHeaders(),
        params: { per_page: 1 }
      });
      return response.status === 200;
    } catch (error) {
      console.error('WordPress接続テストエラー:', error);
      return false;
    }
  }

  /**
   * Base64画像をWordPress Media Libraryにアップロード
   */
  async uploadImageToWordPress(
    base64Data: string,
    mimeType: string,
    filename: string
  ): Promise<{ success: boolean; mediaId?: number; url?: string; error?: string }> {
    if (!this.config) {
      await this.loadActiveConfig();
    }
    if (!this.config) {
      return { success: false, error: 'WordPress設定が見つかりません' };
    }

    try {
      // Base64をBlobに変換
      const byteCharacters = atob(base64Data);
      const byteNumbers = new Array(byteCharacters.length);
      for (let i = 0; i < byteCharacters.length; i++) {
        byteNumbers[i] = byteCharacters.charCodeAt(i);
      }
      const byteArray = new Uint8Array(byteNumbers);
      const blob = new Blob([byteArray], { type: mimeType });

      // FormDataを作成
      const formData = new FormData();
      formData.append('file', blob, filename);

      // WordPressにアップロード
      const response = await axios.post(
        `${this.config.url}/wp-json/wp/v2/media`,
        formData,
        {
          headers: {
            ...this.getAuthHeaders(),
            'Content-Disposition': `attachment; filename="${filename}"`
          }
        }
      );

      if (response.status === 201) {
        console.log(`画像をWordPressにアップロードしました: ${filename} (ID: ${response.data.id})`);
        return {
          success: true,
          mediaId: response.data.id,
          url: response.data.source_url
        };
      }

      return { success: false, error: 'アップロードに失敗しました' };
    } catch (error: any) {
      console.error('WordPress画像アップロードエラー:', error);
      return {
        success: false,
        error: error.response?.data?.message || '画像アップロードでエラーが発生しました'
      };
    }
  }

  async publishArticle(article: Article, publishStatus: 'publish' | 'draft' | 'future' = 'publish', publishDate?: Date) {
    if (!this.config) {
      await this.loadActiveConfig();
    }
    if (!this.config) {
      return { success: false, error: 'WordPress設定が見つかりません' };
    }

    try {
      // Convert to Gutenberg blocks format
      const processedContent = convertToGutenbergBlocks(article.content);

      console.log('=== WordPress投稿デバッグ ===');
      console.log('元のコンテンツ:', article.content.substring(0, 200));
      console.log('変換後のコンテンツ:', processedContent.substring(0, 500));

      // Get category IDs - only use existing categories, don't create new ones
      const categoryIds = await this.getExistingCategoryIds(article.category);

      // Get or create tags
      const tagIds = await this.getOrCreateTags(article.keywords);

      const postData: any = {
        title: article.title,
        content: processedContent,
        excerpt: article.excerpt,
        status: publishStatus,
        categories: categoryIds,
        tags: tagIds,
        meta: {
          _yoast_wpseo_focuskw: article.keywords.join(', '),
          _yoast_wpseo_metadesc: article.excerpt,
          _yoast_wpseo_title: article.title
        }
      };

      if (publishDate) {
        postData.date = publishDate.toISOString();
      }

      const postType = this.config.postType || 'posts';
      console.log(`WordPress投稿タイプ: ${postType}`);

      const response = await axios.post(
        `${this.config.url}/wp-json/wp/v2/${postType}`,
        postData,
        { headers: this.getAuthHeaders() }
      );

      if (response.status === 201) {
        return {
          success: true,
          wordPressId: response.data.id,
          url: response.data.link
        };
      }

      return {
        success: false,
        error: 'WordPress投稿に失敗しました'
      };
    } catch (error: any) {
      console.error('WordPress投稿エラー:', error);
      return {
        success: false,
        error: error.response?.data?.message || 'WordPress投稿でエラーが発生しました'
      };
    }
  }

  async scheduleArticle(article: Article, publishDate: Date): Promise<{ success: boolean; wordPressId?: number; error?: string }> {
    if (!this.config) {
      await this.loadActiveConfig();
    }
    if (!this.config) {
      return { success: false, error: 'WordPress設定が見つかりません' };
    }
    try {
      // Convert to Gutenberg blocks format
      const processedContent = convertToGutenbergBlocks(article.content);

      // Get category IDs - only use existing categories, don't create new ones
      const categoryIds = await this.getExistingCategoryIds(article.category);

      // Get or create tags
      const tagIds = await this.getOrCreateTags(article.keywords);

      const postData = {
        title: article.title,
        content: processedContent,
        excerpt: article.excerpt,
        status: 'future',
        date: publishDate.toISOString(),
        categories: categoryIds,
        tags: tagIds,
        meta: {
          _yoast_wpseo_focuskw: article.keywords.join(', '),
          _yoast_wpseo_metadesc: article.excerpt,
          _yoast_wpseo_title: article.title
        }
      };

      const response = await axios.post(
        `${this.config.url}/wp-json/wp/v2/posts`,
        postData,
        { headers: this.getAuthHeaders() }
      );

      if (response.status === 201) {
        return {
          success: true,
          wordPressId: response.data.id
        };
      }

      return {
        success: false,
        error: 'WordPress予約投稿に失敗しました'
      };
    } catch (error: any) {
      console.error('WordPress予約投稿エラー:', error);
      return {
        success: false,
        error: error.response?.data?.message || 'WordPress予約投稿でエラーが発生しました'
      };
    }
  }

  async getRecentPosts(limit: number = 10): Promise<any[]> {
    if (!this.config) return [];
    try {
      const response = await axios.get(`${this.config.url}/wp-json/wp/v2/posts`, {
        headers: this.getAuthHeaders(),
        params: {
          per_page: limit,
          orderby: 'date',
          order: 'desc'
        }
      });
      return response.data;
    } catch (error) {
      console.error('WordPress記事取得エラー:', error);
      return [];
    }
  }

  async getAllPosts(params?: {
    status?: string;
    per_page?: number;
    page?: number;
    search?: string;
    orderby?: string;
    order?: string;
  }): Promise<{ posts: any[]; total: number; totalPages: number }> {
    if (!this.config) {
      await this.loadActiveConfig();
    }

    try {
      const queryParams: any = {
        per_page: params?.per_page || 100,
        page: params?.page || 1,
        orderby: params?.orderby || 'date',
        order: params?.order || 'desc',
        status: params?.status || 'any'
      };

      if (params?.search) {
        queryParams.search = params.search;
      }

      if (!this.config) return { posts: [], total: 0, totalPages: 0 };
      const response = await axios.get(`${this.config.url}/wp-json/wp/v2/posts`, {
        headers: this.getAuthHeaders(),
        params: queryParams
      });

      const total = parseInt(response.headers['x-wp-total'] || '0');
      const totalPages = parseInt(response.headers['x-wp-totalpages'] || '0');

      return {
        posts: response.data,
        total,
        totalPages
      };
    } catch (error) {
      console.error('WordPress記事一覧取得エラー:', error);
      return { posts: [], total: 0, totalPages: 0 };
    }
  }

  async getPostById(postId: string | number): Promise<any | null> {
    if (!this.config) {
      await this.loadActiveConfig();
    }
    if (!this.config) return null;

    try {
      const response = await axios.get(
        `${this.config.url}/wp-json/wp/v2/posts/${postId}`,
        { headers: this.getAuthHeaders() }
      );
      return response.data;
    } catch (error) {
      console.error('WordPress記事取得エラー:', error);
      return null;
    }
  }

  async deletePost(postId: string | number): Promise<boolean> {
    if (!this.config) {
      await this.loadActiveConfig();
    }
    if (!this.config) return false;

    try {
      const response = await axios.delete(
        `${this.config.url}/wp-json/wp/v2/posts/${postId}`,
        { headers: this.getAuthHeaders() }
      );
      return response.status === 200;
    } catch (error) {
      console.error('WordPress記事削除エラー:', error);
      return false;
    }
  }

  async getExistingCategories(): Promise<{ id: number; name: string; slug: string }[]> {
    if (!this.config) return [];
    try {
      const response = await axios.get(`${this.config.url}/wp-json/wp/v2/categories`, {
        headers: this.getAuthHeaders(),
        params: { per_page: 100 } // 最大100個のカテゴリを取得
      });

      return response.data.map((category: any) => ({
        id: category.id,
        name: category.name,
        slug: category.slug
      }));
    } catch (error) {
      console.error('既存カテゴリ取得エラー:', error);
      return [];
    }
  }

  private getAuthHeaders() {
    if (!this.config) throw new Error('WordPress設定が見つかりません');
    const credentials = btoa(`${this.config.username}:${this.config.applicationPassword}`);
    return {
      'Authorization': `Basic ${credentials}`,
      'Content-Type': 'application/json'
    };
  }

  private async getExistingCategoryIds(articleCategory: string): Promise<number[]> {
    if (!this.config) return [];
    try {
      const categoryIds: number[] = [];

      // First, try to add the default category from WordPress config (if it exists)
      if (this.config.defaultCategory) {
        const defaultCategoryId = await this.findExistingCategoryBySlugOrName(this.config.defaultCategory);
        if (defaultCategoryId) {
          categoryIds.push(defaultCategoryId);
          console.log(`デフォルトカテゴリ「${this.config.defaultCategory}」を使用: ID ${defaultCategoryId}`);
        } else {
          console.warn(`デフォルトカテゴリ「${this.config.defaultCategory}」が見つかりません`);
        }
      }

      // Then, try to add the article category if it's different from default and exists
      if (articleCategory && articleCategory !== this.config.defaultCategory) {
        const articleCategoryId = await this.findExistingCategoryBySlugOrName(articleCategory);
        if (articleCategoryId && !categoryIds.includes(articleCategoryId)) {
          categoryIds.push(articleCategoryId);
          console.log(`記事カテゴリ「${articleCategory}」を使用: ID ${articleCategoryId}`);
        } else {
          console.warn(`記事カテゴリ「${articleCategory}」が見つかりません`);
        }
      }

      // If no categories found, try to use the "Uncategorized" category (ID: 1)
      if (categoryIds.length === 0) {
        const uncategorizedId = await this.findExistingCategoryBySlugOrName('uncategorized');
        if (uncategorizedId) {
          categoryIds.push(uncategorizedId);
          console.log('「未分類」カテゴリを使用: ID 1');
        } else {
          console.warn('カテゴリが見つからないため、WordPressのデフォルトカテゴリを使用します');
          // Return empty array to let WordPress use its default category
        }
      }

      return categoryIds;
    } catch (error) {
      console.error('既存カテゴリID取得エラー:', error);
      return [];
    }
  }

  private async findExistingCategoryBySlugOrName(categoryIdentifier: string): Promise<number | null> {
    if (!this.config) return null;
    try {
      // First, try to find by slug
      let searchResponse = await axios.get(`${this.config.url}/wp-json/wp/v2/categories`, {
        headers: this.getAuthHeaders(),
        params: { slug: categoryIdentifier }
      });

      if (searchResponse.data.length > 0) {
        return searchResponse.data[0].id;
      }

      // If not found by slug, try to find by name
      searchResponse = await axios.get(`${this.config.url}/wp-json/wp/v2/categories`, {
        headers: this.getAuthHeaders(),
        params: { search: categoryIdentifier }
      });

      if (searchResponse.data.length > 0) {
        // Find exact match by name
        const exactMatch = searchResponse.data.find((cat: any) =>
          cat.name.toLowerCase() === categoryIdentifier.toLowerCase()
        );
        if (exactMatch) {
          return exactMatch.id;
        }
        // If no exact match, return the first result
        return searchResponse.data[0].id;
      }

      // Category not found - DO NOT CREATE NEW CATEGORY
      console.warn(`カテゴリ「${categoryIdentifier}」が見つかりません。新しいカテゴリは作成しません。`);
      return null;
    } catch (error) {
      console.error(`カテゴリ検索エラー (${categoryIdentifier}):`, error);
      return null;
    }
  }

  // Legacy method for backward compatibility
  private async getCategoryId(categoryName: string): Promise<number[]> {
    const categoryId = await this.findExistingCategoryBySlugOrName(categoryName);
    return categoryId ? [categoryId] : [];
  }

  /**
   * Get or create tags from keywords
   */
  private async getOrCreateTags(keywords: string[]): Promise<number[]> {
    if (!this.config || !keywords || keywords.length === 0) return [];

    try {
      const tagIds: number[] = [];

      for (const keyword of keywords) {
        if (!keyword.trim()) continue;

        // Search for existing tag
        const searchResponse = await axios.get(`${this.config.url}/wp-json/wp/v2/tags`, {
          headers: this.getAuthHeaders(),
          params: { search: keyword.trim() }
        });

        let tagId: number;

        if (searchResponse.data.length > 0) {
          // Find exact match
          const exactMatch = searchResponse.data.find((tag: any) =>
            tag.name.toLowerCase() === keyword.trim().toLowerCase()
          );
          tagId = exactMatch ? exactMatch.id : searchResponse.data[0].id;
        } else {
          // Create new tag
          const createResponse = await axios.post(
            `${this.config.url}/wp-json/wp/v2/tags`,
            { name: keyword.trim() },
            { headers: this.getAuthHeaders() }
          );
          tagId = createResponse.data.id;
          console.log(`新しいタグを作成: ${keyword.trim()} (ID: ${tagId})`);
        }

        tagIds.push(tagId);
      }

      return tagIds;
    } catch (error) {
      console.error('タグの取得/作成エラー:', error);
      return [];
    }
  }
}

export async function saveWordPressConfig(
  name: string,
  wp_url: string,
  wp_username: string,
  wp_app_password: string,
  wp_category: string
): Promise<any> {
  if (!supabase) {
    throw new Error('Supabase is not initialized');
  }

  const { data, error } = await supabase
    .from('wordpress_configs')
    .insert({
      name,
      url: wp_url,
      username: wp_username,
      password: wp_app_password,
      category: wp_category,
      is_active: true
    })
    .select()
    .single();

  if (error) {
    console.error('Error saving WordPress config:', error);
    throw new Error(`WordPress設定の保存に失敗しました: ${error.message}`);
  }

  return data;
}


