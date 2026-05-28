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
  styleReferenceUrl?: string;
  scheduleSettings?: ScheduleSettings;
}

export class WordPressService {
  private config: WordPressConfig | null = null;
  private normalizeWordPressUrl(url: string): string {
    return url.replace(/\/+$/, '');
  }

  private formatWordPressLocalDate(date: Date): string {
    const pad = (value: number) => String(value).padStart(2, '0');
    return [
      date.getFullYear(),
      pad(date.getMonth() + 1),
      pad(date.getDate())
    ].join('-') + `T${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
  }

  constructor(config?: WordPressConfig) {
    if (config) {
      this.config = {
        ...config,
        url: this.normalizeWordPressUrl(config.url)
      };
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
      url: this.normalizeWordPressUrl(configData.url),
      username: configData.username,
      applicationPassword: configData.password, // Supabase側が「password」カラムの場合
      isActive: configData.is_active,
      defaultCategory: configData.default_category || "",
      postType: configData.post_type || 'posts',
      styleReferenceUrl: configData.style_reference_url || '',
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
            Authorization: this.getAuthHeaders().Authorization
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
      if (error?.response?.data) {
        console.error('WordPress画像アップロード詳細:', error.response.data);
      }
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

      // Get or create tags
      const tagIds = await this.getOrCreateTags(article.keywords);
      const postType = this.config.postType || 'posts';
      console.log(`WordPress投稿タイプ: ${postType}`);
      const taxonomyAssignments = await this.getExistingTaxonomyAssignments(article.category, postType);

      const postData: any = {
        title: article.title,
        content: processedContent,
        excerpt: article.excerpt,
        status: publishStatus,
        tags: tagIds,
        ...taxonomyAssignments,
        meta: {
          _yoast_wpseo_focuskw: article.keywords.join(', '),
          _yoast_wpseo_metadesc: article.excerpt,
          _yoast_wpseo_title: article.title
        }
      };

      if (publishDate) {
        postData.date = this.formatWordPressLocalDate(publishDate);
      }

      const response = await axios.post(
        `${this.config.url}/wp-json/wp/v2/${postType}`,
        postData,
        { headers: this.getAuthHeaders() }
      );

      if (response.status === 201) {
        const fallbackResult = await this.assignCategoryViaXmlRpcIfNeeded(
          response.data.id,
          postType,
          article.category,
          taxonomyAssignments
        );
        if (!fallbackResult.success) {
          return {
            success: false,
            error: fallbackResult.error || 'WordPress投稿後のカテゴリー設定に失敗しました'
          };
        }

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

      // Get or create tags
      const tagIds = await this.getOrCreateTags(article.keywords);
      const postType = this.config.postType || 'posts';
      console.log(`WordPress予約投稿タイプ: ${postType}`);
      const taxonomyAssignments = await this.getExistingTaxonomyAssignments(article.category, postType);

      const postData = {
        title: article.title,
        content: processedContent,
        excerpt: article.excerpt,
        status: 'future',
        date: this.formatWordPressLocalDate(publishDate),
        tags: tagIds,
        ...taxonomyAssignments,
        meta: {
          _yoast_wpseo_focuskw: article.keywords.join(', '),
          _yoast_wpseo_metadesc: article.excerpt,
          _yoast_wpseo_title: article.title
        }
      };

      const response = await axios.post(
        `${this.config.url}/wp-json/wp/v2/${postType}`,
        postData,
        { headers: this.getAuthHeaders() }
      );

      if (response.status === 201) {
        const fallbackResult = await this.assignCategoryViaXmlRpcIfNeeded(
          response.data.id,
          postType,
          article.category,
          taxonomyAssignments
        );
        if (!fallbackResult.success) {
          return {
            success: false,
            error: fallbackResult.error || 'WordPress予約投稿後のカテゴリー設定に失敗しました'
          };
        }

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

  private async getTaxonomyCandidatesForPostType(postType: string): Promise<Array<{ field: string; restBase: string }>> {
    if (!this.config) return [];

    const candidates: Array<{ field: string; restBase: string }> = [];
    const addCandidate = (field: string, restBase: string) => {
      if (!field || !restBase) return;
      if (candidates.some((item) => item.field === field || item.restBase === restBase)) return;
      candidates.push({ field, restBase });
    };

    if (postType === 'posts') {
      addCandidate('categories', 'categories');
      return candidates;
    }

    const normalizedPostType = String(postType || '').trim();

    try {
      const optionsResponse = await axios.options(`${this.config.url}/wp-json/wp/v2/${postType}`, {
        headers: this.getAuthHeaders(),
      });
      const properties = optionsResponse.data?.schema?.properties
        || optionsResponse.data?.endpoints?.[0]?.schema?.properties
        || {};
      const ignoredFields = new Set([
        'id', 'date', 'date_gmt', 'guid', 'modified', 'modified_gmt', 'slug', 'status',
        'type', 'link', 'title', 'content', 'excerpt', 'author', 'featured_media',
        'comment_status', 'ping_status', 'template', 'meta', 'permalink_template',
        'generated_slug', 'tags',
      ]);

      Object.entries(properties).forEach(([fieldName, definition]: [string, any]) => {
        if (ignoredFields.has(fieldName)) return;
        const itemType = definition?.items?.type || definition?.items?.[0]?.type;
        if (definition?.type === 'array' && (itemType === 'integer' || itemType === 'number')) {
          addCandidate(fieldName, fieldName);
        }
      });
    } catch (error) {
      console.warn(`投稿タイプ「${postType}」のRESTスキーマ取得に失敗しました`, error);
    }

    try {
      const response = await axios.get(`${this.config.url}/wp-json/wp/v2/taxonomies`, {
        headers: this.getAuthHeaders(),
        params: { type: postType },
      });

      Object.entries(response.data || {}).forEach(([taxonomyName, taxonomy]: [string, any]) => {
        if (taxonomy?.visibility?.show_in_rest === false) return;
        if (taxonomy?.hierarchical === false) return;
        const restBase = String(taxonomy?.rest_base || taxonomyName || '').trim();
        addCandidate(restBase, restBase);
        addCandidate(taxonomyName, restBase);
      });
    } catch (error) {
      console.warn(`投稿タイプ「${postType}」のtaxonomy取得に失敗しました`, error);
    }

    try {
      const response = await axios.get(`${this.config.url}/wp-json/wp/v2/taxonomies`, {
        headers: this.getAuthHeaders(),
      });

      Object.entries(response.data || {}).forEach(([taxonomyName, taxonomy]: [string, any]) => {
        if (taxonomy?.visibility?.show_in_rest === false) return;
        if (taxonomy?.hierarchical === false) return;
        const types = Array.isArray(taxonomy?.types) ? taxonomy.types.map(String) : [];
        if (!types.includes(postType)) return;
        const restBase = String(taxonomy?.rest_base || taxonomyName || '').trim();
        addCandidate(restBase, restBase);
        addCandidate(taxonomyName, restBase);
      });
    } catch (error) {
      console.warn(`投稿タイプ「${postType}」の全taxonomy照合に失敗しました`, error);
    }

    [
      `${normalizedPostType}_category`,
      `${normalizedPostType}_cat`,
      `${normalizedPostType}-category`,
      `${normalizedPostType}-cat`,
      `${normalizedPostType}_categories`,
      `${normalizedPostType}-categories`,
    ].forEach((candidate) => addCandidate(candidate, candidate));

    if (candidates.length === 0) {
      addCandidate('categories', 'categories');
    }
    console.log(`投稿タイプ「${postType}」のtaxonomy候補:`, candidates);
    return candidates;
  }

  private async findExistingTermBySlugOrName(restBase: string, termIdentifier: string): Promise<number | null> {
    if (!this.config) return null;
    try {
      let searchResponse = await axios.get(`${this.config.url}/wp-json/wp/v2/${restBase}`, {
        headers: this.getAuthHeaders(),
        params: { slug: termIdentifier }
      });

      if (searchResponse.data.length > 0) {
        return searchResponse.data[0].id;
      }

      searchResponse = await axios.get(`${this.config.url}/wp-json/wp/v2/${restBase}`, {
        headers: this.getAuthHeaders(),
        params: { search: termIdentifier }
      });

      if (searchResponse.data.length > 0) {
        const exactMatch = searchResponse.data.find((term: any) =>
          term.name.toLowerCase() === termIdentifier.toLowerCase()
        );
        return exactMatch ? exactMatch.id : searchResponse.data[0].id;
      }

      return null;
    } catch (error) {
      console.error(`ターム検索エラー (${restBase}: ${termIdentifier}):`, error);
      return null;
    }
  }

  private escapeXml(value: string | number): string {
    return String(value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&apos;');
  }

  private resolveXmlRpcTaxonomyAndTerm(articleCategory: string, postType: string): { taxonomy: string; term: string } | null {
    if (!this.config) return null;
    const category = String(articleCategory || this.config.defaultCategory || '').trim();
    if (!category || postType === 'posts') return null;

    const explicitMatch = category.match(/^([A-Za-z0-9_-]+)\s*[:：]\s*(.+)$/);
    if (explicitMatch) {
      return {
        taxonomy: explicitMatch[1].trim(),
        term: explicitMatch[2].trim(),
      };
    }

    return {
      taxonomy: `${postType}_category`,
      term: category,
    };
  }

  private async assignCategoryViaXmlRpcIfNeeded(
    postId: number | string,
    postType: string,
    articleCategory: string,
    restAssignments: Record<string, number[]>
  ): Promise<{ success: boolean; error?: string }> {
    if (!this.config?.defaultCategory && !articleCategory) return { success: true };
    if (Object.keys(restAssignments).length > 0) return { success: true };

    const target = this.resolveXmlRpcTaxonomyAndTerm(articleCategory, postType);
    if (!target) return { success: true };
    const config = this.config;
    if (!config) return { success: true };

    try {
      console.log(`Edge Function経由でカテゴリー設定: post=${postId}, taxonomy=${target.taxonomy}, term=${target.term}`);
      if (!supabase) {
        return {
          success: false,
          error: 'Supabaseが初期化されていないためカテゴリー設定を実行できませんでした',
        };
      }

      const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
      const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;
      const response = await fetch(`${supabaseUrl}/functions/v1/wp-taxonomy-assign`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${supabaseAnonKey}`,
        },
        body: JSON.stringify({
          url: config.url,
          username: config.username,
          password: config.applicationPassword,
          postId,
          postType,
          taxonomy: target.taxonomy,
          term: target.term,
        }),
      });
      const data = await response.json().catch(() => ({}));

      if (!response.ok || data?.error) {
        console.error('カテゴリー設定Edge Functionレスポンス:', data);
        return {
          success: false,
          error: data?.error || `WordPressカテゴリー設定に失敗しました (${response.status})`,
        };
      }

      return { success: true };
    } catch (error: any) {
      console.error('カテゴリー設定Edge Functionエラー:', error);
      return {
        success: false,
        error: 'WordPressカテゴリー設定に失敗しました',
      };
    }
  }

  private async getExistingTaxonomyAssignments(articleCategory: string, postType: string): Promise<Record<string, number[]>> {
    if (!this.config) return {};

    const assignments: Record<string, number[]> = {};
    const candidates = await this.getTaxonomyCandidatesForPostType(postType);
    console.log('WordPress taxonomy assignment input:', {
      postType,
      defaultCategory: this.config.defaultCategory || '',
      articleCategory,
      candidates,
    });
    const addCategory = async (categoryIdentifier: string) => {
      const trimmed = String(categoryIdentifier || '').trim();
      if (!trimmed) return;

      const explicitMatch = trimmed.match(/^([A-Za-z0-9_-]+)\s*[:：]\s*(.+)$/);
      if (explicitMatch) {
        const explicitField = explicitMatch[1].trim();
        const explicitTerm = explicitMatch[2].trim();
        const explicitId = await this.findExistingTermBySlugOrName(explicitField, explicitTerm);
        if (explicitId) {
          assignments[explicitField] = Array.from(new Set([...(assignments[explicitField] || []), explicitId]));
          console.log(`カテゴリ「${explicitTerm}」を明示taxonomy ${explicitField} に設定: ID ${explicitId}`);
          return;
        }
        console.warn(`明示taxonomy「${explicitField}」でカテゴリ「${explicitTerm}」が見つかりません`);
      }

      const parsed = parseInt(trimmed, 10);
      if (!Number.isNaN(parsed)) {
        const field = candidates[0]?.field || 'categories';
        assignments[field] = Array.from(new Set([...(assignments[field] || []), parsed]));
        return;
      }

      for (const candidate of candidates) {
        const termId = await this.findExistingTermBySlugOrName(candidate.restBase, trimmed);
        if (termId) {
          assignments[candidate.field] = Array.from(new Set([...(assignments[candidate.field] || []), termId]));
          console.log(`カテゴリ「${trimmed}」を ${candidate.field} に設定: ID ${termId}`);
          return;
        }
      }

      console.warn(`カテゴリ「${trimmed}」が見つかりません`);
    };

    await addCategory(this.config.defaultCategory || '');
    if (articleCategory && articleCategory !== this.config.defaultCategory) {
      await addCategory(articleCategory);
    }

    if (Object.keys(assignments).length === 0 && postType === 'posts') {
      const uncategorizedId = await this.findExistingTermBySlugOrName('categories', 'uncategorized');
      if (uncategorizedId) assignments.categories = [uncategorizedId];
    }

    console.log('WordPress taxonomy assignments:', assignments);
    return assignments;
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
  wp_category: string,
  wp_post_type?: string,
  style_reference_url?: string
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
      post_type: wp_post_type || 'posts',
      style_reference_url: style_reference_url || null,
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


