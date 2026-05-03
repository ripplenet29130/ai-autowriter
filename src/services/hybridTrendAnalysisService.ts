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
    
    if (!validation.isValid) {
      throw new Error(`APIキーが設定されていません。接続設定でSerpAPIキーを設定してください。不足: ${validation.missingServices.join(', ')}`);
    }
    return await realTrendAnalysisService.analyzeTrends(keyword, options);
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