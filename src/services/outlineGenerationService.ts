import { v4 as uuidv4 } from 'uuid';
import {
  ArticleOutline,
  OutlineGenerationRequest,
  OutlineSection,
} from '../types';
import { aiService } from './aiService';
import { generateOutlineWithAutoModeStyle } from '../shared/articleGenerationCore';

function safeWordCountTarget(total?: number, fallback = 300): number {
  if (!total || Number.isNaN(total) || total <= 0) return fallback;
  return total;
}

function resolveMinimumSectionCount(targetWordCount: number): number {
  if (targetWordCount <= 1200) return 5;
  if (targetWordCount <= 2500) return 5;
  if (targetWordCount <= 3500) return 6;
  return 7;
}

function isSummaryTitle(title: string): boolean {
  const normalized = String(title || '').trim().toLowerCase();
  return (
    normalized.includes('まとめ') ||
    normalized.includes('結論') ||
    normalized.includes('総括') ||
    normalized.includes('おわりに') ||
    normalized.includes('最後に') ||
    normalized.includes('summary') ||
    normalized.includes('conclusion')
  );
}

function normalizeTitleKey(title: string): string {
  return String(title || '')
    .replace(/[ 　\t]/g, '')
    .replace(/[!！?？:：・]/g, '')
    .toLowerCase();
}

function inferSubjectTerm(mainKeyword: string, selectedTitle?: string): string {
  const text = `${selectedTitle || ''} ${mainKeyword || ''}`;
  const subjectMatch = text.match(/[A-Za-z0-9ぁ-んァ-ン一-龠]{2,12}(?:倉庫|工場|店舗|施設|設備|機械|システム|サービス|ツール|会社|業者)/);
  if (subjectMatch) return subjectMatch[0].trim();

  const firstToken = String(mainKeyword || '')
    .split(/[、,｜|/／\s]+/)
    .map((item) => item.trim())
    .find((item) => item.length >= 2 && item.length <= 12);

  return firstToken || '';
}

function normalizeRelatedKeywordForOutline(keyword: string, subjectTerm: string): string {
  let normalized = String(keyword || '').trim();
  if (!normalized) return '';

  if (subjectTerm) {
    normalized = normalized
      .replace(new RegExp(subjectTerm.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'), ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  return normalized
    .replace(/^[\s・、,／/｜|]+|[\s・、,／/｜|]+$/g, '')
    .trim();
}

function rebalanceSectionWordCounts(
  sections: OutlineSection[],
  targetWordCount: number
): OutlineSection[] {
  if (!sections.length || !Number.isFinite(targetWordCount) || targetWordCount <= 0) return sections;

  const minPerSection = 120;
  const weights = sections.map((section) => Math.max(1, section.estimatedWordCount || 1));
  const weightSum = weights.reduce((sum, w) => sum + w, 0);

  const adjusted = sections.map((section, index) => ({
    ...section,
    estimatedWordCount: Math.max(
      minPerSection,
      Math.round(targetWordCount * (weightSum > 0 ? weights[index] / weightSum : 1 / sections.length))
    ),
  }));

  let diff = targetWordCount - adjusted.reduce((sum, section) => sum + section.estimatedWordCount, 0);
  const order = adjusted
    .map((section, index) => ({ index, weight: section.isLead || isSummaryTitle(section.title) ? 0 : section.estimatedWordCount }))
    .sort((a, b) => b.weight - a.weight)
    .map((x) => x.index);

  let guard = 0;
  while (diff !== 0 && guard < 5000) {
    let moved = false;
    for (const index of order) {
      if (diff === 0) break;
      if (diff > 0) {
        adjusted[index].estimatedWordCount += 1;
        diff -= 1;
        moved = true;
      } else if (adjusted[index].estimatedWordCount > minPerSection) {
        adjusted[index].estimatedWordCount -= 1;
        diff += 1;
        moved = true;
      }
    }
    if (!moved) break;
    guard += 1;
  }

  return adjusted;
}

function flattenHeadingLevelsForMediumLength(
  sections: OutlineSection[],
  targetWordCount: number
): OutlineSection[] {
  if (!Array.isArray(sections) || sections.length === 0) return sections;
  if (!Number.isFinite(targetWordCount) || targetWordCount <= 0) return sections;
  if (targetWordCount > 1200) return sections;
  return sections.map((section) => ({ ...section, level: 2 }));
}

function enforceMinimumSections(
  sections: OutlineSection[],
  keyword: string,
  targetWordCount: number
): OutlineSection[] {
  const minimum = resolveMinimumSectionCount(targetWordCount);
  if (!sections.length) return sections;

  let normalized = sections.map((section) => ({ ...section }));

  const leadIndex = normalized.findIndex((section) => section.isLead || /^(導入|リード)$/i.test(String(section.title || '').trim()));
  if (leadIndex === -1) {
    normalized.unshift({
      id: uuidv4(),
      title: '導入',
      level: 2,
      description: '記事の導入',
      estimatedWordCount: Math.max(180, Math.floor(targetWordCount * 0.15)),
      order: 0,
      isGenerated: false,
      isLead: true,
    });
  } else if (leadIndex > 0) {
    const [lead] = normalized.splice(leadIndex, 1);
    normalized.unshift({ ...lead, title: '導入', isLead: true, level: 2 });
  } else {
    normalized[0] = { ...normalized[0], title: '導入', isLead: true, level: 2 };
  }

  for (let i = 1; i < normalized.length; i += 1) {
    if (normalized[i].isLead) normalized[i] = { ...normalized[i], isLead: false };
  }

  const summaryIndex = normalized.findIndex((section, index) => index > 0 && isSummaryTitle(section.title));
  if (summaryIndex === -1) {
    normalized.push({
      id: uuidv4(),
      title: 'まとめ',
      level: 2,
      description: '記事全体の要点を振り返る',
      estimatedWordCount: Math.max(180, Math.floor(targetWordCount * 0.15)),
      order: normalized.length,
      isGenerated: false,
      isLead: false,
    });
  } else if (summaryIndex !== normalized.length - 1) {
    const [summary] = normalized.splice(summaryIndex, 1);
    normalized.push({ ...summary, title: 'まとめ', isLead: false, level: 2 });
  } else {
    normalized[normalized.length - 1] = {
      ...normalized[normalized.length - 1],
      title: 'まとめ',
      isLead: false,
      level: 2,
    };
  }

  normalized = rebalanceSectionWordCounts(normalized, targetWordCount)
    .map((section, index) => ({ ...section, order: index }));

  normalized = flattenHeadingLevelsForMediumLength(normalized, targetWordCount)
    .map((section, index) => ({ ...section, order: index }));

  return normalized;
}


export class OutlineGenerationService {
  async generateOutline(request: OutlineGenerationRequest): Promise<ArticleOutline> {
    const mainKeyword = request.keywords[0] || request.selectedTitle || '記事テーマ';
    const targetWordCount = safeWordCountTarget(
      request.targetWordCount,
      request.targetLength === 'short' ? 1200 : request.targetLength === 'long' ? 3000 : 2000,
    );

    let sections: OutlineSection[] = [];
    let resolvedTitle = request.selectedTitle || `${mainKeyword}の完全ガイド`;

    try {
      await aiService.loadActiveConfig();

      const competitorArticles = (request.trendData?.competitorAnalysis?.topArticles || [])
        .filter((a) => a?.title)
        .slice(0, 3)
        .map((a) => {
          const headings = (a.headings || [])
            .map((h) => String(h || '').trim())
            .filter((h) => h.length > 0)
            .slice(0, 6);
          const excerpt = String(
            (a as any).excerpt ||
            (a as any).metaDescription ||
            ''
          ).trim();

          return {
            title: String(a.title || '').trim(),
            headings,
            excerpt: excerpt.slice(0, 400),
          };
        })
        .filter((a) => a.title && (a.excerpt.length > 0 || a.headings.length > 0));

      if (competitorArticles.length === 0) {
        throw new Error('競合記事の見出しまたは本文抜粋が取得できていません。キーワード検索を再実行してください。');
      }

      const competitorHeadings = competitorArticles
        .flatMap((article) => article.headings)
        .filter((heading) => heading.length > 0)
        .slice(0, 15);

      const subjectTerm = inferSubjectTerm(mainKeyword, request.selectedTitle);
      const relatedKeywords = Array.from(new Set([
        ...(request.keywords || []).slice(1),
        ...((request.trendData?.relatedKeywords || [])
          .map((k) => String(k || '').trim())
          .filter((k) => k.length > 0)
          .slice(0, 12))
      ]
        .map((keyword) => normalizeRelatedKeywordForOutline(keyword, subjectTerm))
        .filter((keyword) => keyword.length > 0 && normalizeTitleKey(keyword) !== normalizeTitleKey(subjectTerm))
      )).slice(0, 12);

      const outline = await generateOutlineWithAutoModeStyle({
        keyword: mainKeyword,
        targetWordCount,
        fixedTitle: request.selectedTitle || null,
        customInstructions: request.customInstructions,
        articleStructureType: request.articleStructureType,
        relatedKeywords,
        tone: request.tone,
        competitorHeadings,
        competitorArticles,
        callAI: (prompt, maxTokens) => aiService.generateRawText(prompt, maxTokens),
      });

      resolvedTitle = outline.title || resolvedTitle;
      sections = outline.sections.map((item, index) => ({
        id: uuidv4(),
        title: item.title,
        level: item.level === 3 ? 3 : 2,
        description: item.description || '',
        estimatedWordCount: item.estimatedWordCount || Math.max(180, Math.floor(targetWordCount / 5)),
        order: index,
        isGenerated: false,
        isLead: Boolean(item.isLead) || index === 0,
      }));
      sections = enforceMinimumSections(sections, mainKeyword, targetWordCount);
    } catch (error) {
      throw error;
    }

    sections = enforceMinimumSections(sections, mainKeyword, targetWordCount);

    const estimatedWordCount = sections.reduce((sum, section) => sum + section.estimatedWordCount, 0);

    return {
      id: uuidv4(),
      title: resolvedTitle,
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
