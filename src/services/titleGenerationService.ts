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
  async generateTitleSuggestions(trendAnalysis: TrendAnalysisResult, count: number = 5, keywordPreferences?: Record<string, import('../types').KeywordPreference>): Promise<TitleSuggestion[]> {
    const keyword = trendAnalysis.keyword;
    const competitors = trendAnalysis.competitorAnalysis.topArticles;

    try {
      // AIを使用してタイトル案を生成
      const suggestions = await this.generateViaAI(keyword, trendAnalysis, competitors, count, keywordPreferences);
      return suggestions;
    } catch (error) {
      console.warn('AIでのタイトル生成に失敗しました。ルールベースで生成します:', error);
      return this.generateRuleBased(keyword, trendAnalysis, count);
    }
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
        seoScore: Math.floor(Math.random() * 20) + 80,
        clickPotential: Math.floor(Math.random() * 20) + 80,
        targetAudience: '情報収集層',
        contentAngle: '解説型',
        relatedKeywords: trendAnalysis.relatedKeywords.slice(0, 3)
      }));
    } catch (error) {
      console.error('AI Title Generation Error:', error);
      throw error;
    }
  }

  /**
   * ルールベースでタイトル案を提示（AI失敗時のフォールバック）
   */
  private generateRuleBased(keyword: string, trendAnalysis: TrendAnalysisResult, count: number): TitleSuggestion[] {
    const year = new Date().getFullYear();
    const templates = [
      `${year}年版 ${keyword}の選び方｜失敗しない比較ポイント`,
      `${keyword}の基礎知識と注意点をわかりやすく解説`,
      `${keyword}の費用・効果・継続のコツを整理`,
      `${keyword}で後悔しないための判断基準`,
      `${keyword}の比較ポイントを初心者向けに解説`,
    ];
    const descriptions = [
      '比較軸を先に示し、検討段階での意思決定をしやすくする狙いです。',
      '基礎情報を先に押さえたい読者向けに、理解負荷を下げる構成です。',
      '費用と効果を同時に確認したい層の検索意図に合わせています。',
      '失敗回避ニーズに応える切り口で、クリック動機を高めます。',
      '初学者が選定時に迷いやすい点を補う意図で設計しています。',
    ];

    return templates.slice(0, count).map((title, index) => ({
      id: uuidv4(),
      title,
      keyword: keyword,
      description: descriptions[index] || '検索意図に沿った切り口でクリック率向上を狙います。',
      trendScore: trendAnalysis.trendScore,
      searchVolume: trendAnalysis.searchVolume,
      competition: trendAnalysis.competition,
      seoScore: 85,
      clickPotential: 80,
      targetAudience: '全般',
      contentAngle: 'ガイド',
      relatedKeywords: trendAnalysis.relatedKeywords.slice(0, 3)
    }));
  }
}

export const titleGenerationService = new TitleGenerationService();
