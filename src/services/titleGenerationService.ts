import { TrendAnalysisResult, TitleSuggestion, CompetitorArticle } from '../types';
import { aiService } from './aiService';
import { v4 as uuidv4 } from 'uuid';
import { generateTitleSuggestionsWithSharedCore } from '../shared/titleGenerationCore';

/**
 * タイトル生成サービス
 */
export class TitleGenerationService {
  /**
   * トレンド分析結果を基にタイトル案を生成
   */
  async generateTitleSuggestions(trendAnalysis: TrendAnalysisResult, count: number = 3, keywordPreferences?: Record<string, import('../types').KeywordPreference>): Promise<TitleSuggestion[]> {
    const keyword = trendAnalysis.keyword;
    const competitors = trendAnalysis.competitorAnalysis.topArticles;

    return this.generateViaAI(keyword, trendAnalysis, competitors, count, keywordPreferences);
  }

  /**
   * AIを使用してタイトル案を生成
   */
  private async generateViaAI(
    keyword: string,
    trendAnalysis: TrendAnalysisResult,
    competitors: CompetitorArticle[],
    count: number,
    keywordPreferences?: Record<string, import('../types').KeywordPreference>
  ): Promise<TitleSuggestion[]> {
    try {
      if (!aiService.getActiveConfig()) {
        await aiService.loadActiveConfig();
      }

      // NGキーワードを除外した関連キーワードリストを作成
      const ngKeywords = keywordPreferences
        ? Object.entries(keywordPreferences)
          .filter(([_, pref]) => pref === 'ng')
          .map(([kw]) => kw)
        : [];

      const essentialKeywords = keywordPreferences
        ? Object.entries(keywordPreferences)
          .filter(([_, pref]) => pref === 'essential')
          .map(([kw]) => kw)
        : [];

      const filteredRelatedKeywords = trendAnalysis.relatedKeywords.filter(kw => !ngKeywords.includes(kw));
      const filteredHotTopics = trendAnalysis.hotTopics.filter(topic => !ngKeywords.some(ng => topic.includes(ng)));
      const aiTitles = await generateTitleSuggestionsWithSharedCore({
        keyword,
        relatedKeywords: filteredRelatedKeywords,
        hotTopics: filteredHotTopics,
        competitors: competitors.map((c) => ({ title: c.title, headings: c.headings })),
        count,
        essentialKeywords,
        ngKeywords,
        callAI: (prompt, maxTokens) => aiService.generateRawText(prompt, maxTokens),
      });

      return aiTitles.map((item) => ({
        id: uuidv4(),
        title: item.title || '',
        keyword: keyword,
        description: item.reason || 'SEOに配慮した魅力的なタイトルです。',
        trendScore: trendAnalysis.trendScore,
        searchVolume: trendAnalysis.searchVolume,
        competition: trendAnalysis.competition,
        targetAudience: '情報収集層',
        contentAngle: '解説型',
        relatedKeywords: trendAnalysis.relatedKeywords.slice(0, 3)
      }));
    } catch (error) {
      console.error('AI Title Generation Error:', error);
      throw error;
    }
  }
}

export const titleGenerationService = new TitleGenerationService();
