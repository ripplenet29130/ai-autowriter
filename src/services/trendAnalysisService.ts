import {
  CompetitorArticle,
  GeographicTrend,
  KeywordSuggestion,
  TrendAnalysisResult,
} from '../types';

export class TrendAnalysisService {
  async analyzeTrends(
    keyword: string,
    _options?: {
      region?: string;
      timeframe?: string;
      category?: number;
    }
  ): Promise<TrendAnalysisResult> {
    const normalizedKeyword = String(keyword || '').trim();
    const relatedKeywords = this.generateRelatedTerms(normalizedKeyword).slice(0, 10);
    const topArticles = this.generateMockCompetitorArticles(normalizedKeyword);

    return {
      keyword: normalizedKeyword,
      trendScore: 55,
      searchVolume: this.estimateSearchVolumeFromKeyword(normalizedKeyword),
      competition: this.determineCompetition(topArticles.length),
      relatedKeywords,
      hotTopics: relatedKeywords.slice(0, 5),
      competitorAnalysis: {
        topArticles,
        averageLength: Math.round(
          topArticles.reduce((sum, article) => sum + article.wordCount, 0) / Math.max(1, topArticles.length)
        ),
        commonTopics: this.extractCommonTopics(topArticles),
      },
      userInterest: {
        risingQueries: relatedKeywords.slice(0, 5),
        breakoutQueries: relatedKeywords.slice(5, 8),
        geographicData: this.generateGeoData(),
      },
      timestamp: new Date(),
    };
  }

  async getKeywordSuggestions(seedKeyword: string, count = 20): Promise<KeywordSuggestion[]> {
    const baseTerms = this.generateRelatedTerms(seedKeyword).slice(0, count);
    return baseTerms.map((term, index) => ({
      keyword: term,
      searchVolume: Math.max(100, this.estimateSearchVolumeFromKeyword(term) - index * 300),
      competition: index < 4 ? 'high' : index < 10 ? 'medium' : 'low',
      cpc: Number((0.3 + index * 0.08).toFixed(2)),
      trend: index < 5 ? 'rising' : index < 12 ? 'stable' : 'declining',
    }));
  }

  private estimateSearchVolumeFromKeyword(keyword: string): number {
    const base = Math.max(1500, String(keyword || '').length * 1800);
    return Math.round(base);
  }

  private determineCompetition(articleCount: number): 'low' | 'medium' | 'high' {
    if (articleCount >= 8) return 'high';
    if (articleCount >= 4) return 'medium';
    return 'low';
  }

  private generateGeoData(): GeographicTrend[] {
    const regions = [
      ['東京', 100],
      ['大阪', 86],
      ['愛知', 74],
      ['福岡', 69],
      ['北海道', 61],
    ] as const;

    return regions.map(([region, value]) => ({
      region,
      value,
      formattedValue: `${value}%`,
    }));
  }

  private generateRelatedTerms(keyword: string): string[] {
    const base = String(keyword || '').trim() || 'キーワード';
    return [
      `${base} とは`,
      `${base} メリット`,
      `${base} デメリット`,
      `${base} 比較`,
      `${base} おすすめ`,
      `${base} 使い方`,
      `${base} 選び方`,
      `${base} 注意点`,
      `${base} 事例`,
      `${base} 最新`,
      `${base} 初心者`,
      `${base} コツ`,
    ];
  }

  private generateMockCompetitorArticles(keyword: string): CompetitorArticle[] {
    const base = String(keyword || '').trim() || 'キーワード';
    return Array.from({ length: 5 }, (_, index) => ({
      title: `${base}に関する競合記事 ${index + 1}`,
      url: `https://example.com/${encodeURIComponent(base)}/${index + 1}`,
      domain: 'example.com',
      wordCount: 2200 + index * 180,
      headings: [
        `${base}の概要`,
        `${base}のメリット`,
        `${base}の注意点`,
      ],
      metaDescription: `${base}について解説する競合記事 ${index + 1}`,
    }));
  }

  private extractCommonTopics(articles: CompetitorArticle[]): string[] {
    const topics = new Set<string>();
    articles.forEach((article) => {
      article.headings.forEach((heading) => topics.add(heading));
    });
    return Array.from(topics).slice(0, 6);
  }
}

export const trendAnalysisService = new TrendAnalysisService();
