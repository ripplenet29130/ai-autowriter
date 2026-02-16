import { v4 as uuidv4 } from 'uuid';
import {
  ArticleOutline,
  OutlineGenerationRequest,
  OutlineSection,
} from '../types';
import { aiService } from './aiService';

type OutlineSectionCandidate = {
  title?: string;
  description?: string;
  level?: 2 | 3;
  estimatedWordCount?: number;
  isLead?: boolean;
};

function safeWordCountTarget(total?: number, fallback = 300): number {
  if (!total || Number.isNaN(total) || total <= 0) return fallback;
  return total;
}

function toSections(
  candidates: OutlineSectionCandidate[],
  fallbackPerSection: number,
): OutlineSection[] {
  return candidates
    .filter((item) => !!item.title)
    .map((item, index) => ({
      id: uuidv4(),
      title: item.title as string,
      level: item.level ?? 2,
      description: item.description ?? '',
      estimatedWordCount: item.estimatedWordCount ?? fallbackPerSection,
      order: index,
      isGenerated: false,
      isLead: item.isLead ?? index === 0,
    }));
}

function buildFallbackSections(keyword: string, targetWordCount: number): OutlineSection[] {
  const sectionCount = targetWordCount >= 2500 ? 6 : targetWordCount >= 1500 ? 5 : 4;
  const perSection = Math.max(180, Math.floor(targetWordCount / sectionCount));

  const titles = [
    'リード',
    `${keyword}の基礎`,
    `${keyword}の重要ポイント`,
    `${keyword}の実践方法`,
    `${keyword}の注意点`,
    'まとめ',
  ].slice(0, sectionCount);

  return titles.map((title, index) => ({
    id: uuidv4(),
    title,
    level: 2,
    description: `${title}について解説します。`,
    estimatedWordCount: perSection,
    order: index,
    isGenerated: false,
    isLead: index === 0,
  }));
}

export class OutlineGenerationService {
  async generateOutline(request: OutlineGenerationRequest): Promise<ArticleOutline> {
    const mainKeyword = request.keywords[0] || request.selectedTitle || '記事テーマ';
    const targetWordCount = safeWordCountTarget(
      request.targetWordCount,
      request.targetLength === 'short' ? 1200 : request.targetLength === 'long' ? 3000 : 2000,
    );

    let sections: OutlineSection[] = [];

    try {
      await aiService.loadActiveConfig();

      const prompt = [
        '以下の条件で記事の見出し構成をJSON配列で作成してください。',
        `メインキーワード: ${mainKeyword}`,
        `関連キーワード: ${request.keywords.slice(1).join(', ') || 'なし'}`,
        `目標文字数: ${targetWordCount}`,
        `文体: ${request.tone}`,
        request.selectedTitle ? `固定タイトル: ${request.selectedTitle}` : '',
        request.customInstructions ? `追加指示: ${request.customInstructions}` : '',
        '',
        '返却形式（JSON配列のみ）:',
        '[{"title":"...","description":"...","level":2,"estimatedWordCount":300,"isLead":true}]',
      ]
        .filter(Boolean)
        .join('\n');

      const aiResult = await aiService.generateCustomJson(prompt);

      const perSection = Math.max(180, Math.floor(targetWordCount / 5));
      if (Array.isArray(aiResult)) {
        sections = toSections(aiResult as OutlineSectionCandidate[], perSection);
      }
    } catch (error) {
      console.warn('Outline generation fallback:', error);
    }

    if (sections.length === 0) {
      sections = buildFallbackSections(mainKeyword, targetWordCount);
    }

    const estimatedWordCount = sections.reduce((sum, section) => sum + section.estimatedWordCount, 0);

    return {
      id: uuidv4(),
      title: request.selectedTitle || `${mainKeyword}の完全ガイド`,
      keyword: mainKeyword,
      sections,
      trendData: request.trendData,
      estimatedWordCount,
      keywordPreferences: request.keywordPreferences,
      createdAt: new Date(),
    };
  }
}

export const outlineGenerationService = new OutlineGenerationService();
