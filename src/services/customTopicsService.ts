import { supabase } from './supabaseClient';

export interface CustomTopic {
  id: string;
  topicName: string;
  keywords: string[];
  tone: string;
  length: string;
  category: string;
  useCount: number;
  lastUsedAt: string;
  isFavorite: boolean;
  createdAt: string;
  updatedAt: string;
}

export const customTopicsService = {
  async createTopic(topic: Partial<CustomTopic>): Promise<CustomTopic | null> {
    try {
      const { data, error } = await supabase
        .from('custom_topics')
        .insert([{
          topic_name: topic.topicName,
          keywords: topic.keywords || [],
          tone: topic.tone || 'professional',
          length: topic.length || 'medium',
          category: topic.category || '',
          use_count: topic.useCount || 0,
          last_used_at: topic.lastUsedAt || new Date().toISOString(),
          is_favorite: topic.isFavorite || false
        }])
        .select()
        .single();

      if (error) {
        console.error('トピックの作成に失敗しました:', error);
        return null;
      }

      return this.mapFromDatabase(data);
    } catch (err) {
      console.error('トピック作成エラー:', err);
      return null;
    }
  },

  async updateTopic(id: string, updates: Partial<CustomTopic>): Promise<CustomTopic | null> {
    try {
      const updateData: any = {};

      if (updates.topicName !== undefined) updateData.topic_name = updates.topicName;
      if (updates.keywords !== undefined) updateData.keywords = updates.keywords;
      if (updates.tone !== undefined) updateData.tone = updates.tone;
      if (updates.length !== undefined) updateData.length = updates.length;
      if (updates.category !== undefined) updateData.category = updates.category;
      if (updates.useCount !== undefined) updateData.use_count = updates.useCount;
      if (updates.lastUsedAt !== undefined) updateData.last_used_at = updates.lastUsedAt;
      if (updates.isFavorite !== undefined) updateData.is_favorite = updates.isFavorite;

      const { data, error } = await supabase
        .from('custom_topics')
        .update(updateData)
        .eq('id', id)
        .select()
        .single();

      if (error) {
        console.error('トピックの更新に失敗しました:', error);
        return null;
      }

      return this.mapFromDatabase(data);
    } catch (err) {
      console.error('トピック更新エラー:', err);
      return null;
    }
  },

  async deleteTopic(id: string): Promise<boolean> {
    try {
      const { error } = await supabase
        .from('custom_topics')
        .delete()
        .eq('id', id);

      if (error) {
        console.error('トピックの削除に失敗しました:', error);
        return false;
      }

      return true;
    } catch (err) {
      console.error('トピック削除エラー:', err);
      return false;
    }
  },

  async getTopic(id: string): Promise<CustomTopic | null> {
    try {
      const { data, error } = await supabase
        .from('custom_topics')
        .select('*')
        .eq('id', id)
        .single();

      if (error) {
        console.error('トピックの取得に失敗しました:', error);
        return null;
      }

      return this.mapFromDatabase(data);
    } catch (err) {
      console.error('トピック取得エラー:', err);
      return null;
    }
  },

  async getAllTopics(sortBy: 'recent' | 'frequent' | 'favorite' = 'recent', limit: number = 50): Promise<CustomTopic[]> {
    try {
      let query = supabase.from('custom_topics').select('*');

      switch (sortBy) {
        case 'frequent':
          query = query.order('use_count', { ascending: false });
          break;
        case 'favorite':
          query = query.eq('is_favorite', true).order('last_used_at', { ascending: false });
          break;
        case 'recent':
        default:
          query = query.order('last_used_at', { ascending: false });
          break;
      }

      query = query.limit(limit);

      const { data, error } = await query;

      if (error) {
        console.error('トピック一覧の取得に失敗しました:', error);
        return [];
      }

      return data.map((item: any) => this.mapFromDatabase(item));
    } catch (err) {
      console.error('トピック一覧取得エラー:', err);
      return [];
    }
  },

  async getFavoriteTopics(): Promise<CustomTopic[]> {
    return this.getAllTopics('favorite');
  },

  async getTopicByName(topicName: string): Promise<CustomTopic | null> {
    try {
      const { data, error } = await supabase
        .from('custom_topics')
        .select('*')
        .eq('topic_name', topicName)
        .maybeSingle();

      if (error) {
        console.error('トピック名での取得に失敗しました:', error);
        return null;
      }

      return data ? this.mapFromDatabase(data) : null;
    } catch (err) {
      console.error('トピック名取得エラー:', err);
      return null;
    }
  },

  async incrementUseCount(id: string): Promise<boolean> {
    try {
      const { error } = await supabase.rpc('increment_topic_use_count', { topic_id: id });

      if (error) {
        const topic = await this.getTopic(id);
        if (topic) {
          await this.updateTopic(id, {
            useCount: topic.useCount + 1,
            lastUsedAt: new Date().toISOString()
          });
        }
      }

      return true;
    } catch (err) {
      const topic = await this.getTopic(id);
      if (topic) {
        await this.updateTopic(id, {
          useCount: topic.useCount + 1,
          lastUsedAt: new Date().toISOString()
        });
      }
      return true;
    }
  },

  async toggleFavorite(id: string): Promise<boolean> {
    try {
      const topic = await this.getTopic(id);
      if (!topic) return false;

      await this.updateTopic(id, { isFavorite: !topic.isFavorite });
      return true;
    } catch (err) {
      console.error('お気に入り切替エラー:', err);
      return false;
    }
  },

  async findOrCreateTopic(topicName: string, defaultValues?: Partial<CustomTopic>): Promise<CustomTopic | null> {
    const existing = await this.getTopicByName(topicName);

    if (existing) {
      await this.incrementUseCount(existing.id);
      return existing;
    }

    return this.createTopic({
      topicName,
      ...defaultValues,
      useCount: 1
    });
  },

  mapFromDatabase(data: any): CustomTopic {
    return {
      id: data.id,
      topicName: data.topic_name,
      keywords: data.keywords || [],
      tone: data.tone || 'professional',
      length: data.length || 'medium',
      category: data.category || '',
      useCount: data.use_count || 0,
      lastUsedAt: data.last_used_at,
      isFavorite: data.is_favorite || false,
      createdAt: data.created_at,
      updatedAt: data.updated_at
    };
  }
};
