import { CompetitorArticle, TrendAnalysisResult } from '../types';
import { apiKeyManager } from './apiKeyManager';
import { competitorResearchService } from './competitorResearchService';
import { trendAnalysisService } from './trendAnalysisService';

export class RealTrendAnalysisService {
  private serpApiKey = '';
  private customSearchApiKey = '';
  private customSearchEngineId = '';

  constructor() {
    this.refreshApiKeys();
  }

  private refreshApiKeys() {
    this.serpApiKey = apiKeyManager.getApiKey('serpapi') || '';
    this.customSearchApiKey = apiKeyManager.getApiKey('google_custom_search') || '';
    this.customSearchEngineId = apiKeyManager.getApiKey('google_custom_search_engine_id') || '';
  }

  async analyzeTrends(
    keyword: string,
    options?: {
      region?: string;
      timeframe?: string;
      category?: number;
      limit?: number;
    }
  ): Promise<TrendAnalysisResult> {
    this.refreshApiKeys();

    try {
      const competitorResearch = await this.loadCompetitorResearch(keyword, options?.limit || 5);
      const relatedKeywords = await this.loadRelatedKeywords(keyword, competitorResearch);

      return {
        keyword,
        trendScore: Math.min(100, Math.max(20, competitorResearch.articles.length * 18)),
        searchVolume: Math.max(1000, competitorResearch.averageLength * 2 || keyword.length * 1500),
        competition: this.determineCompetition(competitorResearch.articles.length),
        relatedKeywords,
        hotTopics: competitorResearch.commonTopics.slice(0, 5),
        competitorAnalysis: {
          topArticles: competitorResearch.articles,
          averageLength: competitorResearch.averageLength,
          commonTopics: competitorResearch.commonTopics,
        },
        userInterest: {
          risingQueries: relatedKeywords.slice(0, 5),
          breakoutQueries: relatedKeywords.slice(5, 8),
          geographicData: [],
        },
        timestamp: new Date(),
      };
    } catch (error) {
      console.warn('Real trend analysis failed, falling back to mock service:', error);
      return trendAnalysisService.analyzeTrends(keyword, options);
    }
  }

  private async loadCompetitorResearch(keyword: string, limit: number) {
    try {
      return await competitorResearchService.conductResearch(keyword, limit, this.serpApiKey || undefined);
    } catch (error) {
      console.warn('Competitor research service failed:', error);
      return {
        keyword,
        articles: this.buildFallbackArticles(keyword, limit),
        averageLength: 2400,
        commonTopics: this.extractKeywordsFromText(keyword, keyword),
      };
    }
  }

  private async loadRelatedKeywords(keyword: string, competitorResearch: { articles: CompetitorArticle[]; commonTopics: string[]; }) {
    if (competitorResearch.commonTopics.length > 0) {
      return competitorResearch.commonTopics.slice(0, 10);
    }

    const textBlob = competitorResearch.articles
      .map((article) => `${article.title} ${article.metaDescription} ${(article.headings || []).join(' ')}`)
      .join(' ');
    const extracted = this.extractKeywordsFromText(textBlob, keyword);
    if (extracted.length > 0) {
      return extracted.slice(0, 10);
    }

    const fallback = await trendAnalysisService.getKeywordSuggestions(keyword, 10);
    return fallback.map((item) => item.keyword);
  }

  private extractKeywordsFromText(text: string, seed: string): string[] {
    const tokens = String(text || '')
      .match(/[A-Za-z0-9ぁ-んァ-ン一-龠]{2,}/g) || [];
    const normalizedSeed = String(seed || '').toLowerCase();
    const stopWords = new Set(['こと', 'ため', 'よう', 'もの', 'これ', 'それ', '記事']);
    const counts = new Map<string, number>();

    tokens.forEach((token) => {
      const normalized = token.toLowerCase();
      if (normalized === normalizedSeed || stopWords.has(normalized)) return;
      counts.set(token, (counts.get(token) || 0) + 1);
    });

    return Array.from(counts.entries())
      .sort((a, b) => b[1] - a[1])
      .map(([token]) => token)
      .slice(0, 10);
  }

  private buildFallbackArticles(keyword: string, limit: number): CompetitorArticle[] {
    return Array.from({ length: Math.max(1, limit) }, (_, index) => ({
      title: `${keyword}の参考記事 ${index + 1}`,
      url: `https://example.com/${encodeURIComponent(keyword)}/${index + 1}`,
      domain: 'example.com',
      wordCount: 2200 + index * 120,
      headings: [`${keyword}の概要`, `${keyword}の活用方法`, `${keyword}の注意点`],
      metaDescription: `${keyword}に関する参考記事 ${index + 1}`,
    }));
  }

  private determineCompetition(articleCount: number): 'low' | 'medium' | 'high' {
    if (articleCount >= 8) return 'high';
    if (articleCount >= 4) return 'medium';
    return 'low';
  }
}

export const realTrendAnalysisService = new RealTrendAnalysisService();
