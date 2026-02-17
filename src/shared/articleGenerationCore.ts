import {
  DEFAULT_WORD_COUNT_TOLERANCE,
  getWordCountBounds,
} from './generationPolicy.ts';
import { buildSummaryPrompt, buildSupplementPrompt } from './generationPrompts.ts';
import { buildSchedulerOutlinePrompt } from './multiStepPromptTemplates.ts';
import { parseOutlineSections, parseOutlineTitle } from './outlineParser.ts';
import { buildHighQualitySectionPrompt } from './sectionGenerationPrompt.ts';

type Tone = 'professional' | 'casual' | 'technical' | 'friendly';

export interface SharedOutlineSection {
  title: string;
  level: number;
  description: string;
  isLead: boolean;
  estimatedWordCount: number;
}

export interface SharedArticleOutline {
  title: string;
  sections: SharedOutlineSection[];
}

export interface SharedSectionWithContent extends SharedOutlineSection {
  content: string;
}

export interface SharedGenerationResult {
  sectionsWithContent: SharedSectionWithContent[];
  fullContent: string;
  wordCount: number;
}

export interface SharedCallAI {
  (prompt: string, maxTokens: number): Promise<string>;
}

export interface GenerateOutlineWithSharedCoreParams {
  keyword: string;
  targetWordCount: number;
  callAI: SharedCallAI;
  fixedTitle?: string | null;
  customInstructions?: string;
  competitorHeadings?: string[];
}

export interface GenerateArticleWithSharedCoreParams {
  outline: SharedArticleOutline;
  keywords: string[];
  tone?: string;
  callAI: SharedCallAI;
  targetWordCount?: number;
  customInstructions?: string;
  defaultMaxTokens?: number;
  qualityRetryCount?: number;
}

function normalizeTone(tone?: string): Tone {
  if (tone === 'casual' || tone === 'technical' || tone === 'friendly' || tone === 'professional') {
    return tone;
  }
  if (tone === 'desu_masu') return 'friendly';
  return 'professional';
}

export function countGeneratedChars(content: string): number {
  const cleaned = content
    .replace(/^#+\s+/gm, '')
    .replace(/\*\*/g, '')
    .replace(/\*/g, '')
    .replace(/^[-*]\s+/gm, '')
    .replace(/\n+/g, '\n')
    .trim();
  return cleaned.length;
}

function truncateByParagraph(content: string, targetWordCount: number): string {
  const paragraphs = content.split('\n\n');
  let result = '';
  let currentCount = 0;

  for (const paragraph of paragraphs) {
    const paragraphLength = countGeneratedChars(paragraph);
    if (currentCount + paragraphLength <= targetWordCount * 1.05) {
      result += paragraph + '\n\n';
      currentCount += paragraphLength;
    } else {
      break;
    }
  }

  return result.trim();
}

async function summarizeToWordCount(
  originalContent: string,
  title: string,
  targetWordCount: number,
  keywords: string[],
  callAI: SharedCallAI,
  maxTokens: number
): Promise<string> {
  const summaryPrompt = buildSummaryPrompt({
    originalContent,
    title,
    targetWordCount,
    keywords
  });

  try {
    const summarizedText = await callAI(summaryPrompt, maxTokens);
    return summarizedText.trim();
  } catch {
    return truncateByParagraph(originalContent, targetWordCount);
  }
}

async function extendToMinimumLength(
  originalContent: string,
  title: string,
  minAllowed: number,
  maxAllowed: number,
  keywords: string[],
  callAI: SharedCallAI,
  maxTokens: number,
  isSection: boolean
): Promise<string> {
  const currentCount = countGeneratedChars(originalContent);
  const remaining = Math.max(0, minAllowed - currentCount);

  if (remaining <= 0) return originalContent;

  const supplementPrompt = buildSupplementPrompt({
    originalContent,
    currentCount,
    minAllowed,
    maxAllowed,
    remaining,
    title,
    keywords,
    isSection,
    hasSummaryAnchor: false
  });

  try {
    const addition = (await callAI(supplementPrompt, maxTokens)).trim();
    if (!addition) return originalContent;
    return `${originalContent}\n\n${addition}`.trim();
  } catch {
    return originalContent;
  }
}

function stripHeading(content: string): string {
  if (!content.startsWith('#')) return content.trim();
  return content.replace(/^#+\s*.*?\n/, '').trim();
}

function formatReadableParagraphs(content: string): string {
  const text = (content || '').trim();
  if (!text) return '';

  const blocks = text.split(/\n{2,}/);
  const formattedBlocks = blocks.map((block) => {
    const trimmed = block.trim();
    if (!trimmed) return '';
    if (/^(```|#{1,6}\s|[-*]\s|\d+\.\s|>\s|\|)/m.test(trimmed)) {
      return trimmed;
    }

    return trimmed
      .replace(/。(?=\S)/g, '。\n')
      .replace(/！(?=\S)/g, '！\n')
      .replace(/？(?=\S)/g, '？\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  }).filter(Boolean);

  return formattedBlocks.join('\n\n').trim();
}

function buildOutlineSnapshot(outline: SharedArticleOutline): string {
  return outline.sections
    .map((section) => `${section.level === 2 ? 'H2' : 'H3'}: ${section.title}`)
    .join('\n');
}

export function assembleArticleMarkdown(sections: SharedSectionWithContent[]): string {
  return sections.map((section) => {
    if (section.isLead) return section.content;
    const heading = section.level === 2 ? `## ${section.title}` : `### ${section.title}`;
    return `${heading}\n\n${section.content}`;
  }).join('\n\n');
}
const SUMMARY_TITLE_PATTERN = /(まとめ|結論|総括|おわりに|最後に|summary|conclusion)/i;

function calculateEdgeSectionWordCount(targetWordCount: number): number {
  if (!Number.isFinite(targetWordCount) || targetWordCount <= 0) return 250;
  return Math.max(150, Math.round(targetWordCount * 0.15));
}

function normalizeOutlineSections(
  sections: SharedOutlineSection[],
  targetWordCount: number
): SharedOutlineSection[] {
  const normalized = sections.map((section) => ({ ...section }));

  const leadWordCount = calculateEdgeSectionWordCount(targetWordCount);
  const summaryWordCount = calculateEdgeSectionWordCount(targetWordCount);

  const leadIndex = normalized.findIndex((section) => section.isLead);
  if (leadIndex === -1) {
    normalized.unshift({
      title: '導入',
      level: 2,
      description: '記事全体の導入',
      isLead: true,
      estimatedWordCount: leadWordCount
    });
  } else if (leadIndex > 0) {
    const [lead] = normalized.splice(leadIndex, 1);
    normalized.unshift({
      ...lead,
      title: lead.title?.trim() || '導入',
      level: 2,
      isLead: true
    });
  } else {
    normalized[0] = {
      ...normalized[0],
      title: normalized[0].title?.trim() || '導入',
      level: 2,
      isLead: true
    };
  }

  for (let i = 1; i < normalized.length; i++) {
    if (normalized[i].isLead) {
      normalized[i] = { ...normalized[i], isLead: false };
    }
  }

  const summaryIndex = normalized.findIndex((section, index) => (
    index > 0 && SUMMARY_TITLE_PATTERN.test(section.title || '')
  ));

  if (summaryIndex === -1) {
    normalized.push({
      title: 'まとめ',
      level: 2,
      description: '記事全体の要点を総括',
      isLead: false,
      estimatedWordCount: summaryWordCount
    });
  } else if (summaryIndex !== normalized.length - 1) {
    const [summary] = normalized.splice(summaryIndex, 1);
    normalized.push({
      ...summary,
      title: 'まとめ',
      level: 2,
      isLead: false
    });
  } else {
    const last = normalized[normalized.length - 1];
    normalized[normalized.length - 1] = {
      ...last,
      title: 'まとめ',
      level: 2,
      isLead: false
    };
  }

  return normalized;
}

async function normalizeLengthWithQualityGate(
  content: string,
  title: string,
  targetWordCount: number,
  keywords: string[],
  callAI: SharedCallAI,
  maxTokens: number,
  retryCount: number
): Promise<string> {
  const { minAllowed, maxAllowed } = getWordCountBounds(targetWordCount, DEFAULT_WORD_COUNT_TOLERANCE);
  let normalized = content;

  for (let attempt = 0; attempt <= retryCount; attempt++) {
    const current = countGeneratedChars(normalized);
    if (current < minAllowed) {
      normalized = await extendToMinimumLength(
        normalized,
        title,
        minAllowed,
        maxAllowed,
        keywords,
        callAI,
        maxTokens,
        false
      );
      continue;
    }
    if (current > maxAllowed) {
      normalized = await summarizeToWordCount(
        normalized,
        title,
        targetWordCount,
        keywords,
        callAI,
        maxTokens
      );
      continue;
    }
    break;
  }

  return normalized.trim();
}

async function generateSectionWithQualityGate(
  section: SharedOutlineSection,
  outline: SharedArticleOutline,
  previousContent: string,
  params: {
    keywords: string[];
    tone: Tone;
    customInstructions?: string;
    callAI: SharedCallAI;
    maxTokens: number;
    qualityRetryCount: number;
  }
): Promise<string> {
  const prompt = buildHighQualitySectionPrompt({
    articleTitle: outline.title,
    totalOutline: buildOutlineSnapshot(outline),
    sectionTitle: section.title,
    previousContent,
    keywords: params.keywords.length > 0 ? params.keywords : [outline.title],
    tone: params.tone,
    targetChars: section.estimatedWordCount,
    isLead: section.isLead,
    customInstructions: params.customInstructions
  });

  let content = stripHeading(await params.callAI(prompt, params.maxTokens));
  const { minAllowed, maxAllowed } = getWordCountBounds(section.estimatedWordCount, DEFAULT_WORD_COUNT_TOLERANCE);

  for (let attempt = 0; attempt <= params.qualityRetryCount; attempt++) {
    const currentCount = countGeneratedChars(content);
    if (currentCount < minAllowed) {
      content = await extendToMinimumLength(
        content,
        `${outline.title} - ${section.title}`,
        minAllowed,
        maxAllowed,
        params.keywords,
        params.callAI,
        params.maxTokens,
        true
      );
      continue;
    }

    if (currentCount > maxAllowed) {
      content = await summarizeToWordCount(
        content,
        `${outline.title} - ${section.title}`,
        section.estimatedWordCount,
        params.keywords,
        params.callAI,
        params.maxTokens
      );
      continue;
    }

    break;
  }

  return formatReadableParagraphs(content);
}

export async function generateOutlineWithSharedCore(
  params: GenerateOutlineWithSharedCoreParams
): Promise<SharedArticleOutline> {
  const prompt = buildSchedulerOutlinePrompt({
    keyword: params.keyword,
    targetWordCount: params.targetWordCount,
    fixedTitle: params.fixedTitle,
    customInstructions: params.customInstructions,
    competitorHeadings: params.competitorHeadings || []
  });

  const text = await params.callAI(prompt, 1500);
  const title = parseOutlineTitle(text, params.keyword, params.fixedTitle || null);
  const parsedSections = parseOutlineSections(text, 400);
  const sections: SharedOutlineSection[] = parsedSections.map((section) => ({
    title: section.title,
    level: section.level,
    description: section.description,
    isLead: section.isLead,
    estimatedWordCount: section.estimatedWordCount
  }));

  const normalizedSections = normalizeOutlineSections(sections, params.targetWordCount);
  return { title, sections: normalizedSections };
}

export async function generateArticleFromOutlineWithSharedCore(
  params: GenerateArticleWithSharedCoreParams
): Promise<SharedGenerationResult> {
  const tone = normalizeTone(params.tone);
  const maxTokens = params.defaultMaxTokens || 2000;
  const qualityRetryCount = params.qualityRetryCount ?? 1;
  const sectionsWithContent: SharedSectionWithContent[] = [];

  let accumulatedContent = '';
  for (const section of params.outline.sections) {
    const content = await generateSectionWithQualityGate(section, params.outline, accumulatedContent, {
      keywords: params.keywords,
      tone,
      customInstructions: params.customInstructions,
      callAI: params.callAI,
      maxTokens,
      qualityRetryCount
    });

    sectionsWithContent.push({ ...section, content });
    accumulatedContent += `\n\n${content}`;
  }

  let fullContent = assembleArticleMarkdown(sectionsWithContent);
  if (params.targetWordCount && params.targetWordCount > 0) {
    fullContent = await normalizeLengthWithQualityGate(
      fullContent,
      params.outline.title,
      params.targetWordCount,
      params.keywords,
      params.callAI,
      maxTokens,
      qualityRetryCount
    );
  }

  return {
    sectionsWithContent,
    fullContent,
    wordCount: countGeneratedChars(fullContent)
  };
}

