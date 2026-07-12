// スケジューラ用の記事生成パイプライン（シングルパス）
import { DEFAULT_TARGET_WORD_COUNT } from '../../../src/shared/generationPolicy.ts';
import {
  countGeneratedChars,
  formatArticleBodyForReadability,
  generateOutlineWithAutoModeStyle,
  insertSubheadingsIntoLongSections,
} from '../../../src/shared/articleGenerationCore.ts';
import {
  buildAutoModeQualityInstructions,
  buildAutoOutlineRetryInstructions,
  compactAutoModeInstructions,
  evaluateAutoOutlineQuality,
} from '../../../src/shared/autoModeQuality.ts';
import {
  AiOutputTruncatedError,
  trimForLog,
  type AIConfig,
  type ArticleOutline,
  type OutlineSection,
  type Schedule,
  type WritingTone,
} from './_shared.ts';
import { callAI } from './_ai.ts';
import {
  countNonSummaryHeadings,
  extractHeadingText,
  findHeadingOnlySections,
  isHeadingLine,
  isSummaryHeadingText,
} from './_content-format.ts';

export function formatOutlineForSinglePass(outline: ArticleOutline): string {
  return (outline.sections || [])
    .map((section, index) => {
      const level = section.isLead ? 'lead' : section.level === 3 ? 'H3' : 'H2';
      const indent = section.level === 3 ? '   ' : '';
      const chars = section.estimatedWordCount ? ` (${section.estimatedWordCount}字)` : '';
      const description = section.description ? ` — ${section.description}` : '';
      return `${indent}${index + 1}. [${level}] ${section.title}${chars}${description}`;
    })
    .join('\n');
}


export function validateGeneratedArticleCompleteness(
  content: string,
  outline: ArticleOutline,
  targetWordCount: number
): void {
  const normalized = String(content || '').trim();
  const charCount = countGeneratedChars(normalized);
  const minChars = Math.max(500, Math.round(Math.max(800, targetWordCount) * 0.75));
  if (charCount < minChars) {
    throw new Error(`Generated article is too short (${charCount}/${targetWordCount} chars). AI output may have stopped midway.`);
  }

  const expectedHeadings = (outline.sections || []).filter((section) => !section.isLead).length;
  const actualHeadings = countNonSummaryHeadings(normalized);
  const minHeadings = Math.min(Math.max(2, Math.floor(expectedHeadings * 0.5)), expectedHeadings);
  if (expectedHeadings >= 3 && actualHeadings < minHeadings) {
    throw new Error(`Generated article is missing headings (${actualHeadings}/${expectedHeadings}). AI output may be incomplete.`);
  }

  const headingOnlySections = findHeadingOnlySections(normalized);
  if (headingOnlySections.length > 0) {
    throw new Error(`Generated article has headings without body text: ${headingOnlySections.slice(0, 5).join(', ')}`);
  }

  // Only flag truncation when the last paragraph looks genuinely cut off:
  // skip heading lines, list items, and short label-like lines.
  const lines = normalized.split('\n').map((line) => line.trim()).filter(Boolean);
  const lastTextLine = lines
    .slice()
    .reverse()
    .find((line) => !/^#{1,6}\s/.test(line) && !/^[-*]\s/.test(line) && line.length >= 20) || '';
  if (lastTextLine && !/[。！？.!?」』）)\w]$/.test(lastTextLine)) {
    console.warn(`Generated article may end mid-sentence: ${trimForLog(lastTextLine, 120)}`);
  }
}


export function compactArticleToTargetLength(content: string, targetWordCount: number): string {
  const maxChars = Math.round(Math.max(800, targetWordCount) * 1.2);
  let text = String(content || '').trim();
  if (!text || countGeneratedChars(text) <= maxChars) return text;

  const blocks = text.split(/\n{2,}/).map((block) => block.trim()).filter(Boolean);
  const compacted: string[] = [];
  for (const block of blocks) {
    const isHeading = isHeadingLine(block);
    if (isHeading) {
      compacted.push(block);
      continue;
    }

    const sentences = block
      .split(/(?<=[。！？!?])\s*/)
      .map((sentence) => sentence.trim())
      .filter(Boolean);
    const reduced = sentences.length >= 3
      ? sentences.slice(0, Math.max(1, Math.ceil(sentences.length * 0.65))).join('')
      : block;
    compacted.push(reduced);
  }

  text = compacted.join('\n\n').trim();
  if (countGeneratedChars(text) <= maxChars) return text;

  const sections: Array<{ blocks: string[]; isSummary: boolean; hasHeading: boolean }> = [];
  for (const block of compacted) {
    if (isHeadingLine(block)) {
      sections.push({
        blocks: [block],
        isSummary: isSummaryHeadingText(extractHeadingText(block)),
        hasHeading: true,
      });
      continue;
    }

    const currentSection = sections[sections.length - 1];
    if (currentSection) {
      currentSection.blocks.push(block);
    } else {
      sections.push({ blocks: [block], isSummary: false, hasHeading: false });
    }
  }

  const summaryCharBudget = sections
    .filter((section) => section.isSummary)
    .reduce((sum, section) => sum + countGeneratedChars(section.blocks.join('\n\n')), 0);
  const nonSummaryMaxChars = Math.max(0, maxChars - summaryCharBudget);
  const shortenedSections: string[][] = [];
  let nonSummaryChars = 0;

  for (const section of sections) {
    const sectionText = section.blocks.join('\n\n');
    const sectionChars = countGeneratedChars(sectionText);

    if (section.isSummary) {
      shortenedSections.push(section.blocks);
      continue;
    }

    if (section.hasHeading && section.blocks.length <= 1) {
      continue;
    }

    if (nonSummaryChars + sectionChars > nonSummaryMaxChars) {
      continue;
    }

    shortenedSections.push(section.blocks);
    nonSummaryChars += sectionChars;
  }

  return shortenedSections.flat().join('\n\n').trim() || text;
}


export async function generateSchedulerArticleSinglePass(params: {
  outline: ArticleOutline;
  keyword: string;
  keywords: string[];
  tone: WritingTone;
  targetWordCount: number;
  customInstructions?: string;
  aiConfig: AIConfig;
}): Promise<{ sectionsWithContent: any[]; fullContent: string; wordCount: number }> {
  const outlineText = formatOutlineForSinglePass(params.outline);
  const keywordLine = Array.from(new Set([params.keyword, ...(params.keywords || [])]
    .map((item) => String(item || '').trim())
    .filter(Boolean)))
    .slice(0, 6)
    .join(', ');
  const toneInstruction = params.tone === 'casual'
    ? 'Tone: natural, approachable Japanese. Use desu/masu consistently, but do not sound childish. Keep sentences short and easy to follow.'
    : 'Tone: natural professional Japanese for business readers. Write like an experienced practitioner answering a reader consultation. Avoid stiff report-like prose, manual-like prose, sales copy, and overusing overly polite phrases such as 「いたします」「させていただきます」「となります」. Keep sentences short, use concrete verbs, and make the next judgment/action clear for the reader.';
  const hardMaxChars = Math.round(params.targetWordCount * 1.2);
  const hardMinChars = Math.round(params.targetWordCount * 0.85);
  const prompt = [
    'Write a complete Japanese article in Markdown.',
    '',
    `Title: ${params.outline.title}`,
    `Main keyword: ${params.keyword}`,
    keywordLine ? `Related keywords: ${keywordLine}` : '',
    `Target length: ${params.targetWordCount} Japanese characters. Stay between ${hardMinChars} and ${hardMaxChars} characters. Stop writing once the article reaches ${hardMaxChars} characters — do NOT exceed this limit.`,
    toneInstruction,
    '',
    'Hard requirements:',
    '- Output only the article body. Do not include explanations, JSON, code fences, or notes.',
    '- Do not repeat the title as an H1.',
    '- Follow the outline structure exactly. Write every [H2] entry as "##" and every [H3] entry as "###". Do NOT skip any heading.',
    '- [H3] entries (indented in the outline) are sub-sections of the preceding [H2]. Always place them inside that H2 section.',
    '- Write 2 to 3 short lead paragraphs BEFORE the first "##" heading.',
    '- H2 sections: 1-2 paragraphs of body text (2-4 sentences each).',
    '- H3 sections: 1-2 paragraphs of body text (2-4 sentences each). Keep each H3 concise to stay within the character limit.',
    '- Prefer clear, short Japanese sentences. Split long sentences instead of stacking abstract nouns.',
    '- Explain technical terms briefly when they may be unfamiliar to a general reader.',
    '- Separate EVERY paragraph with a blank line (one empty line between paragraphs).',
    '- Separate headings from surrounding paragraphs with a blank line.',
    '- Avoid unfinished sentences and placeholder text.',
    '- Never output only headings or an outline. Every heading must be followed by body text before the next heading.',
    '',
    'Outline (indented entries = H3 sub-sections):',
    outlineText,
    '',
    params.customInstructions ? `Additional instructions:\n${params.customInstructions}` : '',
  ].filter(Boolean).join('\n');

  const maxTokens = Math.min(
    12000,
    Math.max(3000, Math.ceil(params.targetWordCount * 2.5))
  );

  let rawText: string;
  try {
    rawText = await callAI(prompt, params.aiConfig, maxTokens);
  } catch (firstError: any) {
    if (firstError?.partialText && typeof firstError.partialText === 'string') {
      // Gemini hit maxOutputTokens — retry with a higher limit before giving up
      const retryMaxTokens = Math.min(16000, maxTokens * 2);
      console.warn(`[singlepass] Gemini hit maxOutputTokens (${maxTokens}), retrying with ${retryMaxTokens}`);
      try {
        rawText = await callAI(prompt, params.aiConfig, retryMaxTokens);
      } catch (retryError: any) {
        // Both attempts hit the limit — use whichever partial text is longer
        const partial1 = typeof firstError.partialText === 'string' ? firstError.partialText : '';
        const partial2 = typeof retryError?.partialText === 'string' ? retryError.partialText : '';
        const bestPartial = countGeneratedChars(partial2) >= countGeneratedChars(partial1) ? partial2 : partial1;
        const minAcceptable = Math.max(400, Math.round(params.targetWordCount * 0.5));
        if (countGeneratedChars(bestPartial) >= minAcceptable) {
          console.warn(`[singlepass] Both attempts hit token limit; using partial text (${countGeneratedChars(bestPartial)} chars)`);
          rawText = bestPartial;
        } else {
          throw retryError;
        }
      }
    } else {
      throw firstError;
    }
  }

  let fullContent = formatArticleBodyForReadability(String(rawText || '').trim());
  if (!fullContent) {
    throw new Error('Single-pass article generation returned empty content');
  }
  try {
    validateGeneratedArticleCompleteness(fullContent, params.outline, params.targetWordCount);
  } catch (validationError) {
    const message = validationError instanceof Error ? validationError.message : String(validationError || '');
    const shouldRetry =
      message.includes('headings without body text') ||
      message.includes('missing headings') ||
      message.includes('too short');

    if (!shouldRetry) {
      throw validationError;
    }

    const retryPrompt = [
      prompt,
      '',
      'Retry instructions:',
      '- The previous output failed quality validation because one or more headings had no body text.',
      '- Do not return an outline. Write the finished article body.',
      '- After every "##" or "###" heading, write at least two complete Japanese sentences before the next heading.',
      '- If the length is tight, make each section shorter, but never leave a heading blank.',
    ].join('\n');
    const retryMaxTokens = Math.min(16000, Math.ceil(maxTokens * 1.5));
    console.warn(`[singlepass] Article validation failed; retrying with stricter body instructions: ${message}`);

    const retryText = await callAI(retryPrompt, params.aiConfig, retryMaxTokens);
    fullContent = formatArticleBodyForReadability(String(retryText || '').trim());
    if (!fullContent) {
      throw validationError;
    }
    validateGeneratedArticleCompleteness(fullContent, params.outline, params.targetWordCount);
  }

  return {
    sectionsWithContent: [],
    fullContent,
    wordCount: countGeneratedChars(fullContent),
  };
}
// Chatwork鬯ｨ・ｾ陞溘ｊ・｡蝓ｼ・ｨ・ｾ遶擾ｽｽ繝ｻ・ｿ繝ｻ・｡
