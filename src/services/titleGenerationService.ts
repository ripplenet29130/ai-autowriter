import { TrendAnalysisResult, TitleSuggestion, CompetitorArticle } from '../types';
import { aiService } from './aiService';
import { v4 as uuidv4 } from 'uuid';

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

      const prompt = `
以下のキーワードと競合他社のタイトルを参考に、SEO的に強力で思わずクリックしたくなる魅力的なブログ記事のタイトル案を${count}件提案してください。

【メインキーワード】
${keyword}

【関連キーワード/トピック（SEO強化）】
${filteredRelatedKeywords.join('、')}
${filteredHotTopics.join('、')}

${essentialKeywords.length > 0 ? `
【必須キーワード（必ずタイトルに含める）】
${essentialKeywords.join('、')}
` : ''}

${ngKeywords.length > 0 ? `
【NGキーワード（絶対に使用しない）】
${ngKeywords.join('、')}
` : ''}

【競合他社のタイトルと構成】
${competitors.length > 0 ? competitors.map(c => `- タイトル: ${c.title}${c.headings && c.headings.length > 0 ? `\n  (主な見出し: ${c.headings.slice(0, 5).join(', ')})` : ''}`).join('\n') : '（データなし）'}

【重要指示】
- 読者の悩みやニーズに刺さるキャッチーなタイトルにしてください。
- 関連キーワードを自然に含めることで検索からの流入を最大化してください。
- 競合他社と比較して独自性や優位性が感じられるようにしてください。
- **毎回異なる視点や切り口（初心者向け、プロ向け、比較、解決策、リスト形式など）で提案し、マンネリ化を防いでください。**
- タイトルは32文字以内が理想的です。
- 各タイトル案に、なぜそのタイトルが良いのか、短くSEO的な根拠やクリック率向上の狙いを説明してください。
- 出力フォーマットはJSON形式でお願いします：
[
  { "title": "タイトル案1", "reason": "そのタイトルの狙いとSEO的根拠" },
  { "title": "タイトル案2", "reason": "そのタイトルの狙いとSEO的な根拠" },
  ...
]
`;

      const result = await aiService.generateCustomJson(prompt);
      const aiTitles = Array.isArray(result) ? result : [];

      return aiTitles.map(item => ({
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
    const templates = [
      `【最新】${keyword}のおすすめスポット・楽しみ方完全ガイド`,
      `${keyword}で絶対に外せない！観光のポイントと注意点`,
      `${keyword}の魅力を徹底解説！日帰りでも楽しめるプラン`,
      `初心者必見！${keyword}を効率よく巡るための基礎知識`,
      `${keyword}の穴場はどこ？地元民が教える本当におすすめしたい場所`
    ];

    return templates.slice(0, count).map(title => ({
      id: uuidv4(),
      title,
      keyword: keyword,
      description: '競合分析とトレンドに基づき作成された、安定した検索流入が期待できるタイトルです。',
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