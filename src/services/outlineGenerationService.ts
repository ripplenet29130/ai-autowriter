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
  if (targetWordCount <= 1200) return 4;
  if (targetWordCount <= 2200) return 5;
  if (targetWordCount <= 3200) return 6;
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
  if (targetWordCount > 2200) return sections;
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

  if (normalized.length < minimum) {
    const existing = new Set(normalized.map((section) => normalizeTitleKey(section.title)));
    const candidates = [
      `${keyword}の比較ポイント`,
      `${keyword}の判断基準`,
      `${keyword}の実践手順`,
      `${keyword}で失敗しない注意点`,
      `${keyword}の費用と継続の考え方`,
    ];
    const insertAt = Math.max(1, normalized.length - 1);
    let cursor = 0;
    while (normalized.length < minimum) {
      const candidate = candidates[cursor] || `${keyword}の実践ポイント${cursor + 1}`;
      cursor += 1;
      const key = normalizeTitleKey(candidate);
      if (existing.has(key)) continue;
      existing.add(key);
      normalized.splice(normalized.length - 1, 0, {
        id: uuidv4(),
        title: candidate,
        level: 2,
        description: `${candidate}を解説します。`,
        estimatedWordCount: Math.max(180, Math.floor(targetWordCount / minimum)),
        order: insertAt,
        isGenerated: false,
        isLead: false,
      });
    }
  }

  normalized = rebalanceSectionWordCounts(normalized, targetWordCount)
    .map((section, index) => ({ ...section, order: index }));

  normalized = flattenHeadingLevelsForMediumLength(normalized, targetWordCount)
    .map((section, index) => ({ ...section, order: index }));

  return normalized;
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
    let resolvedTitle = request.selectedTitle || `${mainKeyword}の完全ガイド`;

    try {
      await aiService.loadActiveConfig();

      const competitorHeadings = request.trendData?.competitorAnalysis?.topArticles
        ?.flatMap((article) => article?.headings || [])
        ?.filter((heading) => String(heading || '').trim().length > 0)
        ?.slice(0, 15) || [];

      const relatedKeywords = Array.from(new Set([
        ...(request.keywords || []).slice(1),
        ...((request.trendData?.relatedKeywords || [])
          .map((k) => String(k || '').trim())
          .filter((k) => k.length > 0)
          .slice(0, 12))
      ]));

      const outline = await generateOutlineWithAutoModeStyle({
        keyword: mainKeyword,
        targetWordCount,
        fixedTitle: request.selectedTitle || null,
        customInstructions: request.customInstructions,
        relatedKeywords,
        tone: request.tone,
        competitorHeadings,
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
      console.warn('Outline generation fallback:', error);
    }

    if (sections.length === 0) {
      sections = buildFallbackSections(mainKeyword, targetWordCount);
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
