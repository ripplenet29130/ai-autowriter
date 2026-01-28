import { TrendAnalysisResult } from '../types';
import { realTrendAnalysisService } from './realTrendAnalysisService';
import { trendAnalysisService } from './trendAnalysisService';
import { apiKeyManager } from './apiKeyManager';

export class HybridTrendAnalysisService {
  async analyzeTrends(keyword: string, options?: {
    region?: string;
    timeframe?: string;
    category?: number;
  }): Promise<TrendAnalysisResult> {
    const validation = apiKeyManager.validateConfiguration();
    
    if (validation.isValid) {
      console.log('Using real API services for trend analysis');
      try {
        return await realTrendAnalysisService.analyzeTrends(keyword, options);
      } catch (error) {
        console.warn('Real API failed, falling back to mock data:', error);
        return await trendAnalysisService.analyzeTrends(keyword, options);
      }
    } else {
      console.log('API keys not configured, using mock data');
      return await trendAnalysisService.analyzeTrends(keyword, options);
    }
  }

  async getKeywordSuggestions(seedKeyword: string, count: number = 20) {
    const validation = apiKeyManager.validateConfiguration();
    
    if (validation.isValid) {
      try {
        // 実際のAPIを使用してキーワード提案を取得
        return await trendAnalysisService.getKeywordSuggestions(seedKeyword, count);
      } catch (error) {
        console.warn('Real API failed for keyword suggestions:', error);
        return await trendAnalysisService.getKeywordSuggestions(seedKeyword, count);
      }
    } else {
      return await trendAnalysisService.getKeywordSuggestions(seedKeyword, count);
    }
  }

  getApiStatus() {
    const validation = apiKeyManager.validateConfiguration();
    return {
      isConfigured: validation.isValid,
      availableServices: validation.availableServices,
      missingServices: validation.missingServices,
      usingMockData: !validation.isValid
    };
  }
}

export const hybridTrendAnalysisService = new HybridTrendAnalysisService();