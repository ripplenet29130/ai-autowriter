import { supabase } from './supabaseClient';
import { GenerationPrompt } from '../types';

export interface GenerationPromptRecord {
  id: string;
  articleId: string | null;
  topic: string;
  keywords: string[];
  tone: string;
  length: string;
  includeIntroduction: boolean;
  includeConclusion: boolean;
  includeSources: boolean;
  useTrendData: boolean;
  trendAnalysis: any;
  createdAt: string;
}

export const generationPromptsService = {
  async createPrompt(articleId: string | null, prompt: GenerationPrompt): Promise<GenerationPromptRecord | null> {
    try {
      if (!supabase) return null;
      const { data, error } = await supabase
        .from('generation_prompts')
        .insert([{
          article_id: articleId,
          topic: prompt.topic,
          keywords: prompt.keywords || [],
          tone: prompt.tone || 'professional',
          length: prompt.length || 'medium',
          include_introduction: prompt.includeIntroduction ?? true,
          include_conclusion: prompt.includeConclusion ?? true,
          include_sources: prompt.includeSources ?? true,
          use_trend_data: prompt.useTrendData ?? false,
          trend_analysis: prompt.trendData || {}
        }])
        .select()
        .single();

      if (error) {
        console.error('繝励Ο繝ｳ繝励ヨ縺ｮ菫晏ｭ倥↓螟ｱ謨励＠縺ｾ縺励◆:', error);
        return null;
      }

      return this.mapFromDatabase(data);
    } catch (err) {
      console.error('繝励Ο繝ｳ繝励ヨ菫晏ｭ倥お繝ｩ繝ｼ:', err);
      return null;
    }
  },

  async getPromptsByArticle(articleId: string): Promise<GenerationPromptRecord[]> {
    try {
      if (!supabase) return [];
      const { data, error } = await supabase
        .from('generation_prompts')
        .select('*')
        .eq('article_id', articleId)
        .order('created_at', { ascending: false });

      if (error) {
        console.error('險倅ｺ九・繝励Ο繝ｳ繝励ヨ蜿門ｾ励↓螟ｱ謨励＠縺ｾ縺励◆:', error);
        return [];
      }

      return data.map((item: any) => this.mapFromDatabase(item));
    } catch (err) {
      console.error('繝励Ο繝ｳ繝励ヨ蜿門ｾ励お繝ｩ繝ｼ:', err);
      return [];
    }
  },

  async getRecentPrompts(limit: number = 20): Promise<GenerationPromptRecord[]> {
    try {
      if (!supabase) return [];
      const { data, error } = await supabase
        .from('generation_prompts')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(limit);

      if (error) {
        console.error('譛霑代・繝励Ο繝ｳ繝励ヨ蜿門ｾ励↓螟ｱ謨励＠縺ｾ縺励◆:', error);
        return [];
      }

      return data.map((item: any) => this.mapFromDatabase(item));
    } catch (err) {
      console.error('繝励Ο繝ｳ繝励ヨ蜿門ｾ励お繝ｩ繝ｼ:', err);
      return [];
    }
  },

  mapFromDatabase(data: any): GenerationPromptRecord {
    return {
      id: data.id,
      articleId: data.article_id,
      topic: data.topic,
      keywords: data.keywords || [],
      tone: data.tone,
      length: data.length,
      includeIntroduction: data.include_introduction,
      includeConclusion: data.include_conclusion,
      includeSources: data.include_sources,
      useTrendData: data.use_trend_data,
      trendAnalysis: data.trend_analysis || {},
      createdAt: data.created_at
    };
  }
};

