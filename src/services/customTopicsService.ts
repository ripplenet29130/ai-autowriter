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
      if (!supabase) return null;
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
        console.error('繝医ヴ繝・け縺ｮ菴懈・縺ｫ螟ｱ謨励＠縺ｾ縺励◆:', error);
        return null;
      }

      return this.mapFromDatabase(data);
    } catch (err) {
      console.error('繝医ヴ繝・け菴懈・繧ｨ繝ｩ繝ｼ:', err);
      return null;
    }
  },

  async updateTopic(id: string, updates: Partial<CustomTopic>): Promise<CustomTopic | null> {
    try {
      if (!supabase) return null;
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
        console.error('繝医ヴ繝・け縺ｮ譖ｴ譁ｰ縺ｫ螟ｱ謨励＠縺ｾ縺励◆:', error);
        return null;
      }

      return this.mapFromDatabase(data);
    } catch (err) {
      console.error('繝医ヴ繝・け譖ｴ譁ｰ繧ｨ繝ｩ繝ｼ:', err);
      return null;
    }
  },

  async deleteTopic(id: string): Promise<boolean> {
    try {
      if (!supabase) return false;
      const { error } = await supabase
        .from('custom_topics')
        .delete()
        .eq('id', id);

      if (error) {
        console.error('繝医ヴ繝・け縺ｮ蜑企勁縺ｫ螟ｱ謨励＠縺ｾ縺励◆:', error);
        return false;
      }

      return true;
    } catch (err) {
      console.error('繝医ヴ繝・け蜑企勁繧ｨ繝ｩ繝ｼ:', err);
      return false;
    }
  },

  async getTopic(id: string): Promise<CustomTopic | null> {
    try {
      if (!supabase) return null;
      const { data, error } = await supabase
        .from('custom_topics')
        .select('*')
        .eq('id', id)
        .single();

      if (error) {
        console.error('繝医ヴ繝・け縺ｮ蜿門ｾ励↓螟ｱ謨励＠縺ｾ縺励◆:', error);
        return null;
      }

      return this.mapFromDatabase(data);
    } catch (err) {
      console.error('繝医ヴ繝・け蜿門ｾ励お繝ｩ繝ｼ:', err);
      return null;
    }
  },

  async getAllTopics(sortBy: 'recent' | 'frequent' | 'favorite' = 'recent', limit: number = 50): Promise<CustomTopic[]> {
    try {
      if (!supabase) return [];
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
        console.error('繝医ヴ繝・け荳隕ｧ縺ｮ蜿門ｾ励↓螟ｱ謨励＠縺ｾ縺励◆:', error);
        return [];
      }

      return data.map((item: any) => this.mapFromDatabase(item));
    } catch (err) {
      console.error('繝医ヴ繝・け荳隕ｧ蜿門ｾ励お繝ｩ繝ｼ:', err);
      return [];
    }
  },

  async getFavoriteTopics(): Promise<CustomTopic[]> {
    return this.getAllTopics('favorite');
  },

  async getTopicByName(topicName: string): Promise<CustomTopic | null> {
    try {
      if (!supabase) return null;
      const { data, error } = await supabase
        .from('custom_topics')
        .select('*')
        .eq('topic_name', topicName)
        .maybeSingle();

      if (error) {
        console.error('繝医ヴ繝・け蜷阪〒縺ｮ蜿門ｾ励↓螟ｱ謨励＠縺ｾ縺励◆:', error);
        return null;
      }

      return data ? this.mapFromDatabase(data) : null;
    } catch (err) {
      console.error('繝医ヴ繝・け蜷榊叙蠕励お繝ｩ繝ｼ:', err);
      return null;
    }
  },

  async incrementUseCount(id: string): Promise<boolean> {
    try {
      if (!supabase) return false;
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
      console.error('縺頑ｰ励↓蜈･繧雁・譖ｿ繧ｨ繝ｩ繝ｼ:', err);
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

