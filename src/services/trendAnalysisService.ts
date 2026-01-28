import axios from 'axios';
import { TrendAnalysisResult, CompetitorArticle, GeographicTrend, KeywordSuggestion } from '../types';

export class TrendAnalysisService {
  private apiKey: string | null = null;

  constructor(apiKey?: string) {
    this.apiKey = apiKey || null;
  }

  async analyzeTrends(keyword: string, options?: {
    region?: string;
    timeframe?: string;
    category?: number;
  }): Promise<TrendAnalysisResult> {
    try {
      console.log(`トレンド分析を開始: ${keyword}`);
      
      // 並行してデータを取得
      const [
        trendData,
        relatedKeywords,
        competitorData,
        seoAnalysis,
        userInterestData
      ] = await Promise.all([
        this.getGoogleTrendsData(keyword, options),
        this.getRelatedKeywords(keyword),
        this.analyzeCompetitors(keyword),
        this.analyzeSEODifficulty(keyword),
        this.getUserInterestData(keyword)
      ]);

      const result: TrendAnalysisResult = {
        keyword,
        trendScore: trendData.interest || 0,
        searchVolume: this.estimateSearchVolume(trendData.interest || 0),
        competition: this.determineCompetition(competitorData.topArticles.length),
        relatedKeywords,
        hotTopics: this.extractHotTopics(relatedKeywords, userInterestData.risingQueries),
        seoData: seoAnalysis,
        competitorAnalysis: competitorData,
        userInterest: userInterestData,
        timestamp: new Date()
      };

      console.log('トレンド分析完了:', result);
      return result;
    } catch (error) {
      console.error('トレンド分析エラー:', error);
      // フォールバック: モックデータを返す
      return this.generateMockTrendData(keyword);
    }
  }

  private async getGoogleTrendsData(keyword: string, options?: any): Promise<any> {
    try {
      // Google Trends APIの代替として、検索ボリューム推定を実装
      const searchVolume = await this.estimateSearchVolumeFromKeyword(keyword);
      const interest = Math.min(100, Math.max(0, searchVolume / 1000));
      
      return {
        interest,
        timelineData: this.generateTimelineData(interest),
        geoData: this.generateGeoData(keyword)
      };
    } catch (error) {
      console.error('Google Trendsデータ取得エラー:', error);
      return { interest: Math.floor(Math.random() * 100) };
    }
  }

  private async estimateSearchVolumeFromKeyword(keyword: string): Promise<number> {
    // キーワードの特徴に基づいて検索ボリュームを推定
    const keywordFactors = {
      'AI': 50000,
      '人工知能': 30000,
      '機械学習': 25000,
      'ChatGPT': 80000,
      'AGA': 40000,
      '薄毛': 35000,
      '自伝': 15000,
      'ビジネス': 60000,
      'テクノロジー': 45000,
      '健康': 70000
    };

    let baseVolume = 10000; // デフォルト値
    
    // キーワードに含まれる要素で推定
    Object.entries(keywordFactors).forEach(([term, volume]) => {
      if (keyword.includes(term)) {
        baseVolume = Math.max(baseVolume, volume);
      }
    });

    // ランダム要素を追加（±30%）
    const randomFactor = 0.7 + Math.random() * 0.6;
    return Math.floor(baseVolume * randomFactor);
  }

  private generateTimelineData(interest: number): any[] {
    const data = [];
    const now = new Date();
    
    for (let i = 11; i >= 0; i--) {
      const date = new Date(now);
      date.setMonth(date.getMonth() - i);
      
      const variation = (Math.random() - 0.5) * 20;
      const value = Math.max(0, Math.min(100, interest + variation));
      
      data.push({
        date: date.toISOString().slice(0, 7),
        value: Math.round(value)
      });
    }
    
    return data;
  }

  private generateGeoData(keyword: string): GeographicTrend[] {
    const regions = [
      { region: '東京', baseValue: 100 },
      { region: '大阪', baseValue: 85 },
      { region: '愛知', baseValue: 75 },
      { region: '神奈川', baseValue: 90 },
      { region: '福岡', baseValue: 70 },
      { region: '北海道', baseValue: 65 },
      { region: '宮城', baseValue: 60 },
      { region: '広島', baseValue: 55 }
    ];

    return regions.map(({ region, baseValue }) => {
      const variation = (Math.random() - 0.5) * 30;
      const value = Math.max(0, Math.min(100, baseValue + variation));
      
      return {
        region,
        value: Math.round(value),
        formattedValue: `${Math.round(value)}%`
      };
    });
  }

  private async getRelatedKeywords(keyword: string): Promise<string[]> {
    try {
      // キーワード拡張ロジック
      const relatedTerms = this.generateRelatedTerms(keyword);
      
      // 実際のAPIを使用する場合はここで外部APIを呼び出し
      // const response = await this.callKeywordAPI(keyword);
      
      return relatedTerms.slice(0, 10);
    } catch (error) {
      console.error('関連キーワード取得エラー:', error);
      return this.generateRelatedTerms(keyword);
    }
  }

  private generateRelatedTerms(keyword: string): string[] {
    const termExpansions: { [key: string]: string[] } = {
      'AI': [
        '人工知能', '機械学習', 'ディープラーニング', 'ChatGPT', 'AI技術',
        'AI活用', 'AI導入', 'AI開発', 'AI業界', 'AI未来'
      ],
      '人工知能': [
        'AI', '機械学習', 'ニューラルネットワーク', 'AI技術', 'AI応用',
        '知能システム', 'AI研究', 'AI発展', 'AI社会', 'AI革命'
      ],
      'AGA': [
        '男性型脱毛症', '薄毛治療', 'フィナステリド', 'ミノキシジル', '発毛',
        '育毛', '薄毛対策', 'ヘアケア', '植毛', '薄毛予防'
      ],
      '薄毛': [
        'AGA', '脱毛症', '育毛剤', 'ヘアケア', '発毛治療',
        '薄毛対策', '頭皮ケア', '毛髪再生', '薄毛予防', 'ヘアロス'
      ],
      '自伝': [
        'ライフストーリー', '人生記録', '回想録', 'メモワール', '自分史',
        '人生体験', '家族史', '人生の記録', 'ライフヒストリー', '人生物語'
      ],
      'ビジネス': [
        '経営', '起業', 'マネジメント', 'リーダーシップ', 'ビジネス戦略',
        '事業', '企業', 'ビジネスモデル', '経営戦略', 'ビジネス成功'
      ]
    };

    // キーワードに最も関連する拡張語群を選択
    for (const [baseKeyword, expansions] of Object.entries(termExpansions)) {
      if (keyword.includes(baseKeyword)) {
        return expansions;
      }
    }

    // デフォルトの関連語を生成
    return [
      `${keyword} 方法`,
      `${keyword} 効果`,
      `${keyword} 比較`,
      `${keyword} おすすめ`,
      `${keyword} 最新`,
      `${keyword} 2024`,
      `${keyword} 解説`,
      `${keyword} 入門`,
      `${keyword} 専門`,
      `${keyword} 実践`
    ];
  }

  private async analyzeCompetitors(keyword: string): Promise<{
    topArticles: CompetitorArticle[];
    averageLength: number;
    commonTopics: string[];
  }> {
    try {
      // 実際の実装では検索エンジンAPIを使用
      const mockArticles = this.generateMockCompetitorArticles(keyword);
      
      return {
        topArticles: mockArticles,
        averageLength: mockArticles.reduce((sum, article) => sum + article.wordCount, 0) / mockArticles.length,
        commonTopics: this.extractCommonTopics(mockArticles)
      };
    } catch (error) {
      console.error('競合分析エラー:', error);
      return {
        topArticles: [],
        averageLength: 3000,
        commonTopics: []
      };
    }
  }

  private generateMockCompetitorArticles(keyword: string): CompetitorArticle[] {
    const domains = [
      'example.com', 'blog.example.org', 'news.example.net',
      'tech.example.jp', 'info.example.co.jp'
    ];

    return domains.map((domain, index) => ({
      title: `${keyword}について詳しく解説 - ${index + 1}`,
      url: `https://${domain}/article-${index + 1}`,
      domain,
      wordCount: 2000 + Math.floor(Math.random() * 3000),
      headings: [
        `${keyword}とは`,
        `${keyword}の特徴`,
        `${keyword}の活用方法`,
        `${keyword}の将来性`
      ],
      metaDescription: `${keyword}について専門家が詳しく解説します。`,
      publishDate: new Date(Date.now() - Math.random() * 30 * 24 * 60 * 60 * 1000)
    }));
  }

  private extractCommonTopics(articles: CompetitorArticle[]): string[] {
    const allHeadings = articles.flatMap(article => article.headings);
    const topicCounts: { [key: string]: number } = {};

    allHeadings.forEach(heading => {
      const words = heading.split(/\s+/);
      words.forEach(word => {
        if (word.length > 2) {
          topicCounts[word] = (topicCounts[word] || 0) + 1;
        }
      });
    });

    return Object.entries(topicCounts)
      .sort(([, a], [, b]) => b - a)
      .slice(0, 10)
      .map(([topic]) => topic);
  }

  private async analyzeSEODifficulty(keyword: string): Promise<{
    difficulty: number;
    opportunity: number;
    suggestions: string[];
  }> {
    try {
      // SEO難易度の計算ロジック
      const difficulty = this.calculateSEODifficulty(keyword);
      const opportunity = 100 - difficulty;
      const suggestions = this.generateSEOSuggestions(keyword, difficulty);

      return {
        difficulty,
        opportunity,
        suggestions
      };
    } catch (error) {
      console.error('SEO分析エラー:', error);
      return {
        difficulty: 50,
        opportunity: 50,
        suggestions: ['キーワード密度を最適化する', 'メタディスクリプションを改善する']
      };
    }
  }

  private calculateSEODifficulty(keyword: string): number {
    // キーワードの特徴に基づいてSEO難易度を計算
    let difficulty = 50; // ベース値

    // 競合性の高いキーワード
    const highCompetitionKeywords = ['AI', 'ビジネス', '投資', '保険', 'クレジットカード'];
    const mediumCompetitionKeywords = ['健康', '美容', '教育', 'テクノロジー'];
    const lowCompetitionKeywords = ['自伝', '趣味', 'ライフスタイル'];

    if (highCompetitionKeywords.some(term => keyword.includes(term))) {
      difficulty += 30;
    } else if (mediumCompetitionKeywords.some(term => keyword.includes(term))) {
      difficulty += 15;
    } else if (lowCompetitionKeywords.some(term => keyword.includes(term))) {
      difficulty -= 15;
    }

    // キーワードの長さ（ロングテールキーワードは難易度が低い）
    const wordCount = keyword.split(/\s+/).length;
    if (wordCount >= 3) {
      difficulty -= 10;
    } else if (wordCount === 1) {
      difficulty += 20;
    }

    return Math.max(0, Math.min(100, difficulty));
  }

  private generateSEOSuggestions(keyword: string, difficulty: number): string[] {
    const suggestions = [];

    if (difficulty > 70) {
      suggestions.push('ロングテールキーワードを活用する');
      suggestions.push('ニッチな角度からアプローチする');
      suggestions.push('専門性を高めてE-A-Tを向上させる');
    } else if (difficulty > 40) {
      suggestions.push('関連キーワードを組み合わせる');
      suggestions.push('ユーザーの検索意図を深く分析する');
      suggestions.push('競合記事より詳細な内容を作成する');
    } else {
      suggestions.push('基本的なSEO対策を徹底する');
      suggestions.push('内部リンクを最適化する');
      suggestions.push('定期的なコンテンツ更新を行う');
    }

    // 共通の提案
    suggestions.push('タイトルタグにキーワードを含める');
    suggestions.push('見出し構造を最適化する');
    suggestions.push('画像のalt属性を設定する');

    return suggestions;
  }

  private async getUserInterestData(keyword: string): Promise<{
    risingQueries: string[];
    breakoutQueries: string[];
    geographicData: GeographicTrend[];
  }> {
    try {
      return {
        risingQueries: this.generateRisingQueries(keyword),
        breakoutQueries: this.generateBreakoutQueries(keyword),
        geographicData: this.generateGeoData(keyword)
      };
    } catch (error) {
      console.error('ユーザー関心データ取得エラー:', error);
      return {
        risingQueries: [],
        breakoutQueries: [],
        geographicData: []
      };
    }
  }

  private generateRisingQueries(keyword: string): string[] {
    const risingPatterns = [
      `${keyword} 2024`,
      `${keyword} 最新`,
      `${keyword} トレンド`,
      `${keyword} 比較`,
      `${keyword} おすすめ`,
      `${keyword} 効果`,
      `${keyword} 方法`,
      `${keyword} 解説`
    ];

    return risingPatterns.slice(0, 5);
  }

  private generateBreakoutQueries(keyword: string): string[] {
    const breakoutPatterns = [
      `${keyword} AI`,
      `${keyword} 自動化`,
      `${keyword} DX`,
      `${keyword} 革新`,
      `${keyword} 未来`
    ];

    return breakoutPatterns.slice(0, 3);
  }

  private extractHotTopics(relatedKeywords: string[], risingQueries: string[]): string[] {
    const allTopics = [...relatedKeywords, ...risingQueries];
    const uniqueTopics = Array.from(new Set(allTopics));
    
    // 話題性の高いトピックを選出
    return uniqueTopics
      .filter(topic => topic.includes('2024') || topic.includes('最新') || topic.includes('トレンド'))
      .slice(0, 5);
  }

  private determineCompetition(competitorCount: number): 'low' | 'medium' | 'high' {
    if (competitorCount < 3) return 'low';
    if (competitorCount < 7) return 'medium';
    return 'high';
  }

  private estimateSearchVolume(interest: number): number {
    // トレンドスコアから検索ボリュームを推定
    return Math.floor(interest * 1000 + Math.random() * 5000);
  }

  private generateMockTrendData(keyword: string): TrendAnalysisResult {
    return {
      keyword,
      trendScore: Math.floor(Math.random() * 100),
      searchVolume: Math.floor(Math.random() * 50000) + 10000,
      competition: ['low', 'medium', 'high'][Math.floor(Math.random() * 3)] as any,
      relatedKeywords: this.generateRelatedTerms(keyword).slice(0, 8),
      hotTopics: [`${keyword} 2024`, `${keyword} 最新`, `${keyword} トレンド`],
      seoData: {
        difficulty: Math.floor(Math.random() * 100),
        opportunity: Math.floor(Math.random() * 100),
        suggestions: [
          'キーワード密度を最適化する',
          'メタディスクリプションを改善する',
          '内部リンクを強化する'
        ]
      },
      competitorAnalysis: {
        topArticles: this.generateMockCompetitorArticles(keyword).slice(0, 3),
        averageLength: 3500,
        commonTopics: ['基本', '応用', '実践', '効果']
      },
      userInterest: {
        risingQueries: this.generateRisingQueries(keyword),
        breakoutQueries: this.generateBreakoutQueries(keyword),
        geographicData: this.generateGeoData(keyword)
      },
      timestamp: new Date()
    };
  }

  async getKeywordSuggestions(seedKeyword: string, count: number = 20): Promise<KeywordSuggestion[]> {
    try {
      const suggestions: KeywordSuggestion[] = [];
      const relatedTerms = this.generateRelatedTerms(seedKeyword);

      for (let i = 0; i < Math.min(count, relatedTerms.length); i++) {
        const keyword = relatedTerms[i];
        suggestions.push({
          keyword,
          searchVolume: Math.floor(Math.random() * 10000) + 1000,
          competition: ['low', 'medium', 'high'][Math.floor(Math.random() * 3)] as any,
          cpc: Math.floor(Math.random() * 500) + 50,
          trend: ['rising', 'stable', 'declining'][Math.floor(Math.random() * 3)] as any
        });
      }

      return suggestions.sort((a, b) => b.searchVolume - a.searchVolume);
    } catch (error) {
      console.error('キーワード提案取得エラー:', error);
      return [];
    }
  }

  async getCompetitorAnalysis(keyword: string, urls: string[] = []): Promise<CompetitorArticle[]> {
    try {
      // 実際の実装では指定されたURLをスクレイピング
      return this.generateMockCompetitorArticles(keyword);
    } catch (error) {
      console.error('競合分析エラー:', error);
      return [];
    }
  }
}

export const trendAnalysisService = new TrendAnalysisService();