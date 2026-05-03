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

    const competitorResearch = await this.loadCompetitorResearch(keyword, options?.limit || 5);
    console.debug('[trend debug] competitor research loaded', {
      keyword,
      articles: competitorResearch.articles.length,
      titles: competitorResearch.articles.map((article) => article.title).slice(0, 5),
      averageLength: competitorResearch.averageLength,
      commonTopics: competitorResearch.commonTopics.length,
    });
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
  }

  private async loadCompetitorResearch(keyword: string, limit: number) {
    return await competitorResearchService.conductResearch(keyword, limit, this.serpApiKey || undefined);
  }

  private async loadRelatedKeywords(keyword: string, competitorResearch: { articles: CompetitorArticle[]; commonTopics: string[]; }) {
    const extracted = this.extractSearchLikeKeywords(keyword, competitorResearch);
    if (extracted.length > 0) {
      return extracted.slice(0, 10);
    }

    const fallback = await trendAnalysisService.getKeywordSuggestions(keyword, 10);
    return fallback.map((item) => item.keyword);
  }

  private extractSearchLikeKeywords(
    seed: string,
    competitorResearch: { articles: CompetitorArticle[]; commonTopics: string[]; }
  ): string[] {
    const seedText = String(seed || '').trim();
    const seedParts = seedText.split(/[、,｜|/／\s]+/).map((part) => part.trim()).filter(Boolean);
    const subject = seedParts[0] || seedText;
    const seedKey = this.normalizeKeywordKey(seedText);
    const sourceText = [
      ...competitorResearch.commonTopics,
      ...competitorResearch.articles.flatMap((article) => [
        article.title,
        article.metaDescription,
        ...(article.headings || []),
      ]),
    ].join(' ');

    const candidateScores = new Map<string, number>();
    const addCandidate = (candidate: string, score: number) => {
      const cleaned = this.cleanRelatedKeyword(candidate, seedText, subject);
      if (!cleaned) return;
      const key = this.normalizeKeywordKey(cleaned);
      if (!key || key === seedKey || candidateScores.has(cleaned)) return;
      candidateScores.set(cleaned, score);
    };

    const intentTerms = [
      '暑さ対策',
      '熱中症対策',
      '換気',
      '遮熱',
      '断熱',
      '空調',
      'クーラー',
      'スポットクーラー',
      '温度管理',
      '夏対策',
      '日差し対策',
      '選び方',
      '注意点',
      '事例',
    ];

    for (const term of intentTerms) {
      if (term && sourceText.includes(term)) {
        addCandidate(`${subject} ${term}`, 100);
      }
    }

    const titleLikePhrases = sourceText
      .split(/[。！？\n\r]/)
      .flatMap((line) => line.split(/[?？!！｜|:：・、]/))
      .map((phrase) => phrase.trim())
      .filter((phrase) => phrase.length >= 4 && phrase.length <= 32);

    for (const phrase of titleLikePhrases) {
      if (!phrase.includes(subject) && !phrase.includes(seedText)) continue;
      addCandidate(phrase, 40);
    }

    const result = Array.from(candidateScores.entries())
      .sort((a, b) => b[1] - a[1])
      .map(([candidate]) => candidate)
      .slice(0, 10);

    console.debug('[trend debug] related keyword extraction', {
      seed: seedText,
      subject,
      candidates: result,
    });

    return result;
  }

  private cleanRelatedKeyword(candidate: string, seed: string, subject: string): string {
    let text = String(candidate || '')
      .replace(/<[^>]+>/g, ' ')
      .replace(/[「」『』【】\[\]()（）]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();

    text = text
      .replace(/^(?:対策\d+\.?|第\d+章|記事|解説|おすすめ|主な)\s*/i, '')
      .replace(/(?:です|ます|でしょう|してください|できます|可能です|について|とは)$/g, '')
      .replace(/(?:には|では|なら|から|まで|より|など|という場合|がおすすめ|を検討するといいでしょう).*$/g, '')
      .replace(/[、。！？!?]$/g, '')
      .trim();

    if (!text || text.length < 3 || text.length > 28) return '';
    if (/^(?:には|では|なら|から|まで|より|など|がおすすめ|は設置可能)/.test(text)) return '';
    if (this.normalizeKeywordKey(text) === this.normalizeKeywordKey(seed)) return '';

    if (!text.includes(subject) && text.length <= 12) {
      text = `${subject} ${text}`;
    }

    const terms = text.split(/\s+/).filter(Boolean);
    if (terms.length > 4) return '';
    return text;
  }

  private normalizeKeywordKey(value: string): string {
    return String(value || '')
      .replace(/\s+/g, '')
      .replace(/[　・、。！？!?「」『』【】\[\]()（）]/g, '')
      .toLowerCase();
  }

  private determineCompetition(articleCount: number): 'low' | 'medium' | 'high' {
    if (articleCount >= 8) return 'high';
    if (articleCount >= 4) return 'medium';
    return 'low';
  }
}

export const realTrendAnalysisService = new RealTrendAnalysisService();
