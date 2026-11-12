// スケジューラ用の記事生成パイプライン（セクション分割・シングルパス）
import {
  DEFAULT_REVIEW_THINKING_BUDGET,
  DEFAULT_WRITER_THINKING_BUDGET,
  LOOSE_LENGTH_MAX_RATIO,
  LOOSE_LENGTH_MIN_RATIO,
} from '../../../src/shared/generationPolicy.ts';
import {
  countGeneratedChars,
  formatArticleBodyForReadability,
} from '../../../src/shared/articleGenerationCore.ts';
import {
  trimForLog,
  type AIConfig,
  type ArticleOutline,
  type OutlineSection,
  type WritingTone,
} from './_shared.ts';
import { callAI } from './_ai.ts';
import {
  buildArticleFactInstructions,
  buildSectionFactInstructions,
  hasUsableFacts,
  type FactSheet,
} from '../../../src/shared/factSheetCore.ts';
import { mapWithConcurrency } from '../../../src/shared/geminiCore.ts';

// 思考の上限（記事改善プラン 1-3）。環境変数 WRITER_THINKING_BUDGET / REVIEW_THINKING_BUDGET で変えられる
function readThinkingBudget(name: string, fallback: number): number {
  const raw = Number(Deno.env.get(name));
  return Number.isInteger(raw) && raw >= 0 && raw <= 32768 ? raw : fallback;
}
export const WRITER_THINKING_BUDGET = readThinkingBudget('WRITER_THINKING_BUDGET', DEFAULT_WRITER_THINKING_BUDGET);
export const REVIEW_THINKING_BUDGET = readThinkingBudget('REVIEW_THINKING_BUDGET', DEFAULT_REVIEW_THINKING_BUDGET);
function writerOptionsFor(thinkingBudget?: number) {
  return { role: 'writer' as const, thinkingBudget: thinkingBudget ?? WRITER_THINKING_BUDGET };
}
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
  // 文字数は目安なので、途中で止まったとみなすのは目安の半分未満のときだけ（1-6）
  const minChars = Math.max(500, Math.round(Math.max(800, targetWordCount) * LOOSE_LENGTH_MIN_RATIO));
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


function buildToneInstruction(tone: WritingTone): string {
  return tone === 'casual'
    ? 'Tone: natural, approachable Japanese. Use desu/masu consistently, but do not sound childish. Keep sentences short and easy to follow.'
    : 'Tone: natural professional Japanese for business readers. Write like an experienced practitioner answering a reader consultation. Avoid stiff report-like prose, manual-like prose, sales copy, and overusing overly polite phrases such as 「いたします」「させていただきます」「となります」. Keep sentences short, use concrete verbs, and make the next judgment/action clear for the reader.';
}

// 執筆の中心になる指示（記事改善プラン 1-2・1-9）。
// 段落数・文の数ではなく、読者・目的・具体性で指示する
export function buildReaderFocusedGuidance(keyword: string, scope: 'article' | 'lead' | 'section'): string {
  // 時点の注記は、法律・料金・税率・統計など時間で変わる情報を扱う記事だけに書く（植物の育て方などには不要）
  const dateNote = scope === 'section'
    ? '- Do NOT write date notes such as 「（2026年4月時点）」 in this section. If needed, they appear once in the lead or the summary only.'
    : '- Write a date note such as 「（2026年4月時点）」 only if the article relies on information that changes over time (laws, fees, tax rates, statistics, prices), and at most ONCE in the whole article (in the lead or the summary). For evergreen topics (how-to, hobbies, plant care), write no date note. Never attach date notes to product names.';
  return [
    'What matters most (content):',
    `- The reader is someone who searched for 「${keyword}」. Before writing each part, decide what the reader should understand, decide, or be able to do after reading it.`,
    '- Answer the reader\'s question directly. Put the answer or conclusion first, then the reasons, conditions, and exceptions.',
    '- Include concrete examples, numbers, steps, decision criteria, or common mistakes wherever they fit. Do not end with abstract explanations only.',
    '- Do not fill space with generic statements, obvious preambles, or empty sentences such as 「〜が重要です」「注意が必要です」 that say nothing specific.',
    '- Do not assert numbers, fees, deadlines, or rules that you cannot support.',
    '- When the fact memo has a fact that directly answers the reader\'s question (a deadline, threshold, rate, formula, or rule), use it with its date. Do not leave such facts unused.',
    '- If the reader may wonder whether something applies to them (e.g. whether they must file at all), give the concrete criterion or formula, not a statistic.',
    '- When a rule has tiers (tax rates, penalties, fees, conditions), state every tier that matters, including the heavier or basic ones. Do not give only the mildest tier.',
    '- State concrete limits, amounts, and periods instead of vague words like 「一定の」「所定の」 when you know them.',
    '- When describing a schedule or timeline, give concrete milestones (e.g. by which month what must be done, and related deadlines), not just a generic order of tasks.',
    '- Use the 「Q. 」/「A. 」 format ONLY inside a section whose heading is an FAQ (e.g. 「よくある疑問」「よくある質問」「Q&A」). There, put each question on its own line starting with 「Q. 」 and the answer in the next paragraph starting with 「A. 」. In every other section, write normal prose: do NOT start sections with a Q./A. pair, and do not restate the same answer twice.',
    '- Do not start consecutive paragraphs with the same connective (e.g. 「また、」).',
    dateNote,
    '- Do not fix the number of paragraphs or sentences. Split paragraphs where it reads naturally.',
    '- Prefer clear, short Japanese sentences. Explain technical terms briefly when they may be unfamiliar.',
  ].join('\n');
}

function buildKeywordLine(keyword: string, keywords: string[]): string {
  return Array.from(new Set([keyword, ...(keywords || [])]
    .map((item) => String(item || '').trim())
    .filter(Boolean)))
    .slice(0, 6)
    .join(', ');
}

export async function generateSchedulerArticleSinglePass(params: {
  outline: ArticleOutline;
  keyword: string;
  keywords: string[];
  tone: WritingTone;
  targetWordCount: number;
  customInstructions?: string;
  aiConfig: AIConfig;
  factSheet?: FactSheet | null;
  // 思考の上限（省略時は WRITER_THINKING_BUDGET）。新方式では多めにする
  writerThinkingBudget?: number;
}): Promise<{ sectionsWithContent: any[]; fullContent: string; wordCount: number }> {
  const WRITER_OPTIONS = writerOptionsFor(params.writerThinkingBudget);
  const outlineText = formatOutlineForSinglePass(params.outline);
  const keywordLine = buildKeywordLine(params.keyword, params.keywords);
  const toneInstruction = buildToneInstruction(params.tone);
  const factInstructions = buildArticleFactInstructions(params.factSheet);
  const softMaxChars = Math.round(params.targetWordCount * LOOSE_LENGTH_MAX_RATIO);
  const prompt = [
    'Write a complete Japanese article in Markdown.',
    '',
    `Title: ${params.outline.title}`,
    `Main keyword: ${params.keyword}`,
    keywordLine ? `Related keywords: ${keywordLine}` : '',
    `Length guide: about ${params.targetWordCount} Japanese characters. This is a guide, not a quota — do not pad or drop content to hit it. Never go beyond about ${softMaxChars} characters.`,
    toneInstruction,
    '',
    buildReaderFocusedGuidance(params.keyword, 'article'),
    '',
    'Format requirements:',
    '- Output only the article body. Do not include explanations, JSON, code fences, or notes.',
    '- Do not repeat the title as an H1.',
    '- Follow the outline structure exactly. Write every [H2] entry as "##" and every [H3] entry as "###". Do NOT skip any heading.',
    '- [H3] entries (indented in the outline) are sub-sections of the preceding [H2]. Always place them inside that H2 section.',
    '- Write the lead (opening paragraphs) BEFORE the first "##" heading.',
    '- Separate EVERY paragraph with a blank line (one empty line between paragraphs).',
    '- Separate headings from surrounding paragraphs with a blank line.',
    '- Avoid unfinished sentences and placeholder text.',
    '- Never output only headings or an outline. Every heading must be followed by body text before the next heading.',
    '',
    'Outline (indented entries = H3 sub-sections):',
    outlineText,
    '',
    params.customInstructions ? `Additional instructions:\n${params.customInstructions}` : '',
    factInstructions ? `\n${factInstructions}` : '',
  ].filter(Boolean).join('\n');

  const maxTokens = Math.min(
    20000,
    Math.max(3000, Math.ceil(softMaxChars * 2))
  );

  let rawText: string;
  try {
    rawText = await callAI(prompt, params.aiConfig, maxTokens, WRITER_OPTIONS);
  } catch (firstError: any) {
    if (firstError?.partialText && typeof firstError.partialText === 'string') {
      // Gemini hit maxOutputTokens — retry with a higher limit before giving up
      const retryMaxTokens = Math.min(16000, maxTokens * 2);
      console.warn(`[singlepass] Gemini hit maxOutputTokens (${maxTokens}), retrying with ${retryMaxTokens}`);
      try {
        rawText = await callAI(prompt, params.aiConfig, retryMaxTokens, WRITER_OPTIONS);
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

    const retryText = await callAI(retryPrompt, params.aiConfig, retryMaxTokens, WRITER_OPTIONS);
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


// モデルが指示に反して付けた見出し行を除去する（見出しは組み立て側で付与する）
function stripModelHeadings(text: string): string {
  return text
    .split('\n')
    .filter((line) => !/^\s*#{1,6}\s/.test(line))
    .join('\n')
    .trim();
}

// セクション分割生成。各セクションを個別の AI 呼び出しで書く（記事改善プラン 1-5）。
// - 順番に書く（parallelism = 1）ときは、それまでに書いた本文を全文渡してつながりと重複回避を保つ
// - 並列（parallelism > 1）のときは H2 とその下の H3 を 1 グループにし、グループ内で書いた本文を全文渡す
//   （他のグループの本文は見えないため、時間に余裕があれば順番に書く設定のほうが質は高い）
// - 根拠メモがあれば、見出しごとに割り当てた事実だけを渡す
export interface SectionedGenerationParams {
  outline: ArticleOutline;
  keyword: string;
  keywords: string[];
  tone: WritingTone;
  targetWordCount: number;
  customInstructions?: string;
  aiConfig: AIConfig;
  factSheet?: FactSheet | null;
  // outline.sections と同じ並びの、見出しごとに使う根拠メモの番号
  sectionFactIds?: string[][];
  parallelism?: number;
  // 思考の上限（省略時は WRITER_THINKING_BUDGET）
  writerThinkingBudget?: number;
}

export type SectionWritingStep = { section: OutlineSection | null; isLead: boolean; sectionIndex: number };

// 見出しごとに書くための部品。グループ（リード／H2 とその下の H3）単位で書ける。
// 新方式（article-pipeline）は 1 グループを 1 工程として、それまでの本文を渡して順番に書く
export function createSectionWriter(params: SectionedGenerationParams): {
  groups: SectionWritingStep[][];
  writeStep: (step: SectionWritingStep, writtenSoFar: string) => Promise<string>;
  formatStep: (step: SectionWritingStep, text: string) => string;
} {
  const sections = params.outline.sections || [];
  if (sections.length === 0) {
    throw new Error('Sectioned generation requires an outline with sections');
  }

  const outlineText = formatOutlineForSinglePass(params.outline);
  const keywordLine = buildKeywordLine(params.keyword, params.keywords);
  const toneInstruction = buildToneInstruction(params.tone);
  const useFacts = hasUsableFacts(params.factSheet);
  const WRITER_OPTIONS = writerOptionsFor(params.writerThinkingBudget);

  // 文字数の目安: アウトラインの estimatedWordCount 比率で配分し、無ければ均等割り
  const totalEstimated = sections.reduce((sum, s) => sum + (Number(s.estimatedWordCount) || 0), 0);
  const evenBudget = Math.round(params.targetWordCount / sections.length);
  const budgetFor = (section: OutlineSection): number => {
    const raw = totalEstimated > 0
      ? Math.round(params.targetWordCount * ((Number(section.estimatedWordCount) || evenBudget) / totalEstimated))
      : evenBudget;
    return Math.min(1500, Math.max(150, raw));
  };

  type Step = SectionWritingStep;
  const steps: Step[] = [];
  if (!sections.some((s) => s.isLead)) steps.push({ section: null, isLead: true, sectionIndex: -1 });
  sections.forEach((section, index) => steps.push({ section, isLead: section.isLead, sectionIndex: index }));

  // グループ分け: リード（最初の H2 より前）/ H2 ごと（直後の H3 を含む）
  const groups: Step[][] = [];
  for (const step of steps) {
    const startsGroup = groups.length === 0 || (!step.isLead && step.section?.level !== 3);
    if (startsGroup) groups.push([step]);
    else groups[groups.length - 1].push(step);
  }

  const isSummarySection = (section: OutlineSection | null): boolean =>
    Boolean(section && /まとめ|結論|おわりに/.test(section.title || ''));

  const writeStep = async (step: Step, writtenSoFar: string): Promise<string> => {
    const section = step.section;
    const budget = section
      ? budgetFor(section)
      : Math.min(500, Math.max(200, Math.round(params.targetWordCount * 0.08)));
    const softMaxChars = Math.round(budget * LOOSE_LENGTH_MAX_RATIO);

    const task = step.isLead
      ? 'Write ONLY the lead that opens the article (the text shown before the first heading). Answer the reader\'s main question briefly and tell them what this article covers.'
      : [
          `Write ONLY the body text of the section titled 「${section!.title}」.`,
          section!.description ? `Section focus: ${section!.description}` : '',
        ].filter(Boolean).join('\n');

    const contextBlock = writtenSoFar
      ? [
          'Article text written so far (read it to keep the flow natural; do NOT rewrite it, and do NOT repeat explanations, examples, or numbers it already gives):',
          '<<<',
          writtenSoFar,
          '>>>',
        ].join('\n')
      : '';

    const factIds = step.sectionIndex >= 0 ? (params.sectionFactIds?.[step.sectionIndex] || []) : [];
    const factInstructions = useFacts ? buildSectionFactInstructions(params.factSheet, factIds) : '';
    const scope = step.isLead ? 'lead' : isSummarySection(section) ? 'article' : 'section';

    const prompt = [
      'You are writing ONE part of a longer Japanese article. The other parts are written separately.',
      '',
      `Article title: ${params.outline.title}`,
      `Main keyword: ${params.keyword}`,
      keywordLine ? `Related keywords: ${keywordLine}` : '',
      toneInstruction,
      '',
      'Full outline of the article (context only — do NOT write the other sections):',
      outlineText,
      contextBlock ? `\n${contextBlock}` : '',
      '',
      task,
      '',
      buildReaderFocusedGuidance(params.keyword, scope),
      '',
      'Format requirements:',
      `- Length guide: about ${budget} Japanese characters. This is a guide, not a quota — do not pad. Never go beyond about ${softMaxChars} characters.`,
      '- Output only the body text in Markdown. Do NOT output any headings (## or ###), the article title, explanations, JSON, code fences, or notes.',
      '- Separate paragraphs with one blank line.',
      '- Do not summarize the entire article here unless this section is the closing summary.',
      '- Do not explain content that clearly belongs to another heading in the outline.',
      '- Avoid unfinished sentences and placeholder text.',
      params.customInstructions ? `\nAdditional instructions:\n${params.customInstructions}` : '',
      factInstructions ? `\n${factInstructions}` : '',
    ].filter(Boolean).join('\n');

    const maxTokens = Math.min(6000, Math.max(1200, Math.ceil(softMaxChars * 2)));

    let rawText: string;
    try {
      rawText = await callAI(prompt, params.aiConfig, maxTokens, WRITER_OPTIONS);
    } catch (error: any) {
      const partial = typeof error?.partialText === 'string' ? error.partialText : '';
      if (countGeneratedChars(partial) >= Math.max(120, Math.round(budget * 0.6))) {
        console.warn(`[sectioned] Token limit hit; using partial text (${countGeneratedChars(partial)} chars) for "${section?.title ?? 'lead'}"`);
        rawText = partial;
      } else {
        // 一度だけトークン上限を引き上げて再試行。ここで失敗すれば呼び出し元がシングルパスへフォールバックする
        rawText = await callAI(prompt, params.aiConfig, Math.min(10000, maxTokens * 2), WRITER_OPTIONS);
      }
    }

    const text = stripModelHeadings(String(rawText || '').trim());
    if (!text) {
      throw new Error(`Sectioned generation returned empty content for "${section?.title ?? 'lead'}"`);
    }
    return text;
  };

  // 書いた本文に見出しを付ける（見出しは組み立て側で付与する）
  const formatStep = (step: Step, text: string): string => {
    if (step.isLead || !step.section) return text;
    const headingPrefix = step.section.level === 3 ? '###' : '##';
    return `${headingPrefix} ${step.section.title}\n\n${text}`;
  };

  return { groups, writeStep, formatStep };
}

export async function generateSchedulerArticleSectioned(
  params: SectionedGenerationParams,
): Promise<{ sectionsWithContent: any[]; fullContent: string; wordCount: number }> {
  const { groups, writeStep, formatStep } = createSectionWriter(params);
  const parallelism = Math.max(1, params.parallelism ?? 1);

  // 並列でなければ全体を 1 グループとして順番に書き、それまでの本文を全文渡す
  const writingGroups = parallelism > 1 ? groups : [groups.flat()];
  const groupOutputs = await mapWithConcurrency(writingGroups, parallelism, async (group) => {
    const parts: string[] = [];
    for (const step of group) {
      const text = await writeStep(step, parts.join('\n\n'));
      parts.push(formatStep(step, text));
    }
    return parts.join('\n\n');
  });

  const fullContent = formatArticleBodyForReadability(groupOutputs.join('\n\n'));
  if (!fullContent) {
    throw new Error('Sectioned article generation returned empty content');
  }

  validateGeneratedArticleCompleteness(fullContent, params.outline, params.targetWordCount);

  return {
    sectionsWithContent: [],
    fullContent,
    wordCount: countGeneratedChars(fullContent),
  };
}
