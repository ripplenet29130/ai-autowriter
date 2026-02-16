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

  return content.trim();
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

  if (sections.length === 0) {
    return {
      title,
      sections: [
        { title: 'はじめに', level: 2, description: '導入', isLead: true, estimatedWordCount: 300 },
        { title: `${params.keyword} の基本`, level: 2, description: '解説', isLead: false, estimatedWordCount: 500 },
        { title: 'まとめ', level: 2, description: '総括', isLead: false, estimatedWordCount: 300 }
      ]
    };
  }

  return { title, sections };
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
