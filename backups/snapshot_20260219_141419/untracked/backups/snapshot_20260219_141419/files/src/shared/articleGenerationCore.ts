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

export interface GenerateOutlineWithAiGeneratorStyleParams {
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

export interface GenerateFullArticleWithSharedCoreParams {
  keyword: string;
  keywords: string[];
  tone?: string;
  callAI: SharedCallAI;
  targetWordCount: number;
  fixedTitle?: string | null;
  customInstructions?: string;
  competitorHeadings?: string[];
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

function stripPseudoHeadingLine(content: string, sectionTitle: string): string {
  const lines = content.split('\n');
  if (lines.length === 0) return content.trim();
  const first = (lines[0] || '').trim();
  const firstNormalized = first.replace(/[ \u3000:：・]/g, '').toLowerCase();
  const sectionNormalized = String(sectionTitle || '')
    .trim()
    .replace(/[ \u3000:：・]/g, '')
    .toLowerCase();
  const summaryLike = /^(まとめ|おわりに|最後に|結論|summary|conclusion)$/i.test(first);
  if (summaryLike || (sectionNormalized && firstNormalized === sectionNormalized)) {
    return lines.slice(1).join('\n').trim();
  }
  return content.trim();
}

function stripStandaloneSummaryLines(content: string): string {
  return content
    .split('\n')
    .filter((line) => !/^\s*(まとめ|おわりに|最後に|結論|summary|conclusion)\s*$/i.test(line))
    .join('\n')
    .trim();
}

function normalizeBrokenWordWraps(content: string): string {
  return content
    .replace(/([A-Za-z0-9\u30A1-\u30FA\u30FC\u3041-\u3096\u4E00-\u9FFF])\n([A-Za-z0-9\u30A1-\u30FA\u30FC\u3041-\u3096\u4E00-\u9FFF])/g, '$1$2')
    .replace(/\n{3,}/g, '\n\n');
}

function stripAllMarkdownHeadings(content: string): string {
  return content
    .replace(/^#{1,6}\s+.+$/gm, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
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
      .replace(/\u3002(?=\S)/g, '\u3002\n')
      .replace(/\uFF01(?=\S)/g, '\uFF01\n')
      .replace(/\uFF1F(?=\S)/g, '\uFF1F\n')
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
const SUMMARY_TITLE_PATTERN = /(summary|conclusion)/i;

function isSummaryLikeTitle(title?: string): boolean {
  const raw = String(title || '').trim();
  if (!raw) return false;
  const normalized = raw
    .toLowerCase()
    .replace(/\s+/g, '')
    .replace(/[\u3002\uFF01\uFF1F\uFF1A:!?.\-\u30FC]/g, '');

  if (SUMMARY_TITLE_PATTERN.test(normalized)) return true;

  const jaCandidates = [
    '\u307e\u3068\u3081',
    '\u7d50\u8ad6',
    '\u7dcf\u62ec',
    '\u304a\u308f\u308a\u306b',
    '\u6700\u5f8c\u306b',
    '\u7dcf\u307e\u3068\u3081',
  ];
  return jaCandidates.some((token) => normalized.includes(token));
}

function normalizeComparableTitleText(value: string): string {
  return String(value || '')
    .toLowerCase()
    .replace(/[「」『』【】"'`]/g, '')
    .replace(/[｜|:：\-‐‑–—]/g, '')
    .replace(/\s+/g, '')
    .trim();
}

function removeArticleTitlePrefixFromSectionTitle(
  sectionTitle: string,
  articleTitleHint?: string
): string {
  const current = String(sectionTitle || '').trim();
  const articleTitle = String(articleTitleHint || '').trim();
  if (!current || !articleTitle) return current;

  const normalizedCurrent = normalizeComparableTitleText(current);
  const normalizedArticle = normalizeComparableTitleText(articleTitle);
  if (!normalizedCurrent || !normalizedArticle) return current;

  const splitMatch = current.match(/^(.+?)(?:\s*[｜|:：\-]\s*)(.+)$/);
  if (splitMatch?.[1] && splitMatch?.[2]) {
    const left = splitMatch[1].trim();
    const right = splitMatch[2].trim();
    if (normalizeComparableTitleText(left) === normalizedArticle && right.length >= 4) {
      return right;
    }
  }

  if (normalizedCurrent.startsWith(normalizedArticle)) {
    const stripped = current
      .slice(articleTitle.length)
      .replace(/^[\s｜|:：\-]+/, '')
      .trim();
    if (stripped.length >= 4) return stripped;
  }

  return current;
}

function sanitizeSectionTitle(
  rawTitle: string,
  options?: {
    articleTitleHint?: string;
    keywordHint?: string;
    isLead?: boolean;
    isSummary?: boolean;
  }
): string {
  let title = String(rawTitle || '')
    .replace(/^#{1,6}\s+/, '')
    .trim();

  const isLead = Boolean(options?.isLead);
  const isSummary = Boolean(options?.isSummary);

  if (!title) {
    if (isLead) return '導入';
    if (isSummary) return 'まとめ';
    return 'ポイント';
  }

  title = removeArticleTitlePrefixFromSectionTitle(title, options?.articleTitleHint);
  title = title.replace(/^[\s｜|:：\-]+/, '').replace(/\s{2,}/g, ' ').trim();

  if (!isLead && !isSummary) {
    // 見出しには記事タイトルの丸ごと再掲を避ける
    if (
      options?.articleTitleHint &&
      normalizeComparableTitleText(title) === normalizeComparableTitleText(options.articleTitleHint)
    ) {
      const keywordHint = String(options.keywordHint || '').trim();
      title = keywordHint ? `${keywordHint}のポイント` : '重要ポイント';
    }

    if (title.length > 42) {
      const parts = title
        .split(/[｜|:：]/)
        .map((p) => p.trim())
        .filter(Boolean);
      const compact = parts.find((p) => p.length >= 8 && p.length <= 42);
      if (compact) title = compact;
    }

    title = title.replace(/^\d{4}年(?:版)?\s*/, '').trim();
    if (title.length < 6) {
      title = `${title}のポイント`;
    }
  }

  return title;
}

function calculateEdgeSectionWordCount(targetWordCount: number): number {
  if (!Number.isFinite(targetWordCount) || targetWordCount <= 0) return 250;
  return Math.max(150, Math.round(targetWordCount * 0.15));
}

function normalizeOutlineSections(
  sections: SharedOutlineSection[],
  targetWordCount: number,
  options?: {
    keywordHint?: string;
    articleTitleHint?: string;
  }
): SharedOutlineSection[] {
  const normalized = sections.map((section) => {
    const summaryLike = isSummaryLikeTitle(section.title);
    return {
      ...section,
      title: sanitizeSectionTitle(section.title, {
        articleTitleHint: options?.articleTitleHint,
        keywordHint: options?.keywordHint,
        isLead: Boolean(section.isLead),
        isSummary: summaryLike,
      }),
    };
  });

  const leadWordCount = calculateEdgeSectionWordCount(targetWordCount);
  const summaryWordCount = calculateEdgeSectionWordCount(targetWordCount);

  const leadTitle = '\u5c0e\u5165';
  const summaryTitle = '\u307e\u3068\u3081';

  const leadIndex = normalized.findIndex((section) => section.isLead);
  if (leadIndex === -1) {
    normalized.unshift({
      title: leadTitle,
      level: 2,
      description: '\u8a18\u4e8b\u5168\u4f53\u306e\u5c0e\u5165',
      isLead: true,
      estimatedWordCount: leadWordCount
    });
  } else if (leadIndex > 0) {
    const [lead] = normalized.splice(leadIndex, 1);
    normalized.unshift({
      ...lead,
      title: lead.title?.trim() || leadTitle,
      level: 2,
      isLead: true
    });
  } else {
    normalized[0] = {
      ...normalized[0],
      title: normalized[0].title?.trim() || leadTitle,
      level: 2,
      isLead: true
    };
  }

  if (normalized[0] && isSummaryLikeTitle(normalized[0].title)) {
    normalized[0] = {
      ...normalized[0],
      title: leadTitle,
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
    index > 0 && isSummaryLikeTitle(section.title)
  ));

  if (summaryIndex === -1) {
    normalized.push({
      title: summaryTitle,
      level: 2,
      description: '\u8a18\u4e8b\u5168\u4f53\u306e\u8981\u70b9\u3092\u7dcf\u62ec',
      isLead: false,
      estimatedWordCount: summaryWordCount
    });
  } else if (summaryIndex !== normalized.length - 1) {
    const [summary] = normalized.splice(summaryIndex, 1);
    normalized.push({
      ...summary,
      title: summaryTitle,
      level: 2,
      isLead: false
    });
  } else {
    const last = normalized[normalized.length - 1];
    normalized[normalized.length - 1] = {
      ...last,
      title: summaryTitle,
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

  const finalCount = countGeneratedChars(normalized);
  if (finalCount > maxAllowed) {
    return truncateByParagraph(normalized, targetWordCount).trim();
  }
  return normalized.trim();
}

const COMPLETE_SENTENCE_END_RE = /(?:[.!?)]|[\u3002\uFF01\uFF1F\u300D\u300F\u3011\uFF09])(?:["'\u201D\u2019\u300D\u300F\u3011\uFF09])?$/;
const SENTENCE_COMPLETION_MAX_RETRIES = 3;
const SENTENCE_COMPLETION_MAX_TOKENS = 220;
const MIN_GENERATION_MAX_TOKENS = 300;

function hasCompleteSentenceEnding(text: string): boolean {
  const t = String(text || '').trim();
  if (!t) return true;
  if (t.endsWith('...') || t.endsWith('\u2026')) return false;
  return COMPLETE_SENTENCE_END_RE.test(t);
}

function findContinuationOverlap(base: string, continuation: string): number {
  const source = base.slice(-240);
  const target = continuation.slice(0, 240);
  const maxOverlap = Math.min(source.length, target.length);

  for (let size = maxOverlap; size >= 12; size -= 1) {
    if (source.endsWith(target.slice(0, size))) {
      return size;
    }
  }

  return 0;
}

function mergeContinuation(base: string, continuation: string): string {
  const left = base.trimEnd();
  const right = continuation.trimStart();
  if (!left) return right;
  if (!right) return left;

  const overlap = findContinuationOverlap(left, right);
  const append = right.slice(overlap).trimStart();
  if (!append) return left;

  const needsSpace = /[A-Za-z0-9]$/.test(left) && /^[A-Za-z0-9]/.test(append);
  return `${left}${needsSpace ? ' ' : ''}${append}`.trim();
}

function forceSentenceEnding(text: string): string {
  const t = String(text || '').trim();
  if (!t || hasCompleteSentenceEnding(t)) return t;
  const asciiTail = /[A-Za-z0-9]$/.test(t);
  return `${t}${asciiTail ? '.' : '\u3002'}`;
}

const SUMMARY_HEADING_PATTERN = /^##\s*(まとめ|おわりに|最後に|結論|summary|conclusion)\s*$/im;

function hasSummaryHeadingWithContent(content: string): boolean {
  const match = content.match(SUMMARY_HEADING_PATTERN);
  if (!match || match.index === undefined) return false;
  const afterHeading = content.slice(match.index + match[0].length).trim();
  return afterHeading.length >= 50;
}

function stripEmptySummaryHeading(content: string): string {
  return content.replace(/\n*^##\s*(まとめ|おわりに|最後に|結論|summary|conclusion)\s*\n*/im, '\n').trim();
}

async function ensureSummarySection(
  content: string,
  title: string,
  keywords: string[],
  callAI: SharedCallAI,
  maxTokens: number
): Promise<string> {
  const current = String(content || '').trim();
  if (!current) return current;
  if (hasSummaryHeadingWithContent(current)) return current;

  const cleaned = SUMMARY_HEADING_PATTERN.test(current)
    ? stripEmptySummaryHeading(current)
    : current;

  const prompt = [
    '次の記事本文に、自然な「まとめ」セクションを追加してください。',
    '出力はセクション本文のみ。120〜180文字を目安にしてください。',
    '重要ポイントの振り返りと、読者の次の行動につながる一文を含めてください。',
    `タイトル: ${title}`,
    `キーワード: ${keywords.join('、')}`,
    '',
    cleaned,
  ].join('\n');

  let summaryBody = '';
  try {
    summaryBody = (await callAI(prompt, Math.min(260, maxTokens))).trim();
  } catch {
    summaryBody = '';
  }

  if (!summaryBody) {
    summaryBody = 'ここまでの要点を振り返り、優先順位を整理したうえで自分に合う選択肢から着手することが重要です。';
  }

  if (!hasCompleteSentenceEnding(summaryBody)) {
    summaryBody = `${summaryBody}\u3002`;
  }

  return `${cleaned}\n\n## まとめ\n\n${summaryBody}`.trim();
}

async function completeSentenceEndingIfNeeded(
  text: string,
  title: string,
  callAI: SharedCallAI,
  maxTokens: number
): Promise<string> {
  let current = String(text || '').trim();
  if (!current) return current;

  const completionMaxTokens = Math.min(SENTENCE_COMPLETION_MAX_TOKENS, Math.max(80, maxTokens));

  for (let attempt = 0; attempt < SENTENCE_COMPLETION_MAX_RETRIES; attempt += 1) {
    if (hasCompleteSentenceEnding(current)) return current;

    const prompt = [
      'Continue the text from the cut-off point and finish the current sentence naturally.',
      'Do not repeat existing text. Output only the continuation.',
      `Title: ${title}`,
      '',
      current,
    ].join('\n');

    try {
      const tail = (await callAI(prompt, completionMaxTokens)).trim();
      if (!tail) break;

      const merged = mergeContinuation(current, tail);
      if (merged === current) break;
      current = merged;
    } catch {
      break;
    }
  }

  return forceSentenceEnding(current);
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
  content = stripPseudoHeadingLine(content, section.title);
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

  const completed = await completeSentenceEndingIfNeeded(
    content,
    `${outline.title} - ${section.title}`,
    params.callAI,
    params.maxTokens
  );
  const cleaned = stripAllMarkdownHeadings(stripStandaloneSummaryLines(normalizeBrokenWordWraps(completed)));
  return formatReadableParagraphs(cleaned);
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

  const normalizedSections = normalizeOutlineSections(sections, params.targetWordCount, {
    keywordHint: params.keyword,
    articleTitleHint: title,
  });
  return { title, sections: normalizedSections };
}

function extractJsonArray(text: string): string | null {
  const trimmed = String(text || '').trim();
  if (!trimmed) return null;

  // 1. Try to find JSON in markdown code blocks
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced?.[1]) {
    return fenced[1].trim();
  }

  // 2. If no code blocks, look for the first '[' and last ']'
  // This handles cases where the AI replies with just the JSON or surrounds it with text but no blocks
  const start = trimmed.indexOf('[');
  const end = trimmed.lastIndexOf(']');
  if (start !== -1 && end !== -1 && end > start) {
    return trimmed.slice(start, end + 1);
  }

  return null;
}

export async function generateOutlineWithAiGeneratorStyle(
  params: GenerateOutlineWithAiGeneratorStyleParams
): Promise<SharedArticleOutline> {
  const competitorHint =
    params.competitorHeadings && params.competitorHeadings.length > 0
      ? `競合見出し（参考）:\n- ${params.competitorHeadings.slice(0, 15).join('\n- ')}`
      : '';

  const prompt = [
    '以下の条件で、SEO記事の見出し構成をJSON配列のみで作成してください。',
    `メインキーワード: ${params.keyword}`,
    `目標文字数: ${params.targetWordCount}`,
    params.fixedTitle ? `固定タイトル: ${params.fixedTitle}` : '',
    params.customInstructions ? `追加指示: ${params.customInstructions}` : '',
    competitorHint,
    '',
    '必須要件:',
    '- 出力はJSON配列のみ。説明文・Markdown・コードフェンスは不要',
    '- 各要素に title / description / level / estimatedWordCount / isLead を含める',
    '- level は 2 または 3 のみ',
    '- 先頭要素は導入（リード文）セクションとし、title="導入", isLead=true にする。このセクションは見出しなしで本文のみ表示される',
    '- estimatedWordCount は 120 以上の整数',
    '- H2中心で構成し、H3は必要時のみ使用する',
    '- 見出しに記事タイトル全体を繰り返さない（例: 「記事タイトル - 〇〇」を禁止）',
    '- 見出しは原則 12〜36 文字で、自然な日本語のフレーズにする',
    competitorHint ? '- 競合見出しの構成・トピックを積極的に参考にし、同等以上の網羅性を確保する' : '',
    '- 見出し（2つ目以降）は短い単語やキーワードの羅列ではなく、読者に内容と価値が伝わる文章形式にする',
    '  （悪い例: 「費用」「効果」「選び方」 → 良い例: 「費用の相場と治療プラン別の内訳を徹底解説」「効果を実感するまでの期間と成功のポイント」）',
    '',
    '出力例:',
    `[{"title":"導入","description":"リード文","level":2,"estimatedWordCount":260,"isLead":true},{"title":"${params.keyword}の費用相場と治療プラン別の内訳を徹底解説","description":"費用に関する詳細","level":2,"estimatedWordCount":400,"isLead":false}]`,
  ]
    .filter(Boolean)
    .join('\n');

  const text = await params.callAI(prompt, 1800);
  const jsonArrayText = extractJsonArray(text);

  let rawSections: Array<{
    title?: string;
    description?: string;
    level?: number;
    estimatedWordCount?: number;
    isLead?: boolean;
  }> = [];

  if (jsonArrayText) {
    try {
      const parsed = JSON.parse(jsonArrayText);
      if (Array.isArray(parsed)) {
        rawSections = parsed;
      }
    } catch {
      // Fallback handled below.
    }
  }

  const fallbackWordCount = Math.max(180, Math.floor(params.targetWordCount / 5));
  const sections: SharedOutlineSection[] = rawSections
    .filter((s) => String(s?.title || '').trim().length > 0)
    .map((s, index) => ({
      title: String(s.title || '').trim(),
      level: s.level === 3 ? 3 : 2,
      description: String(s.description || '').trim(),
      isLead: Boolean(s.isLead) || index === 0,
      estimatedWordCount: Number.isFinite(Number(s.estimatedWordCount))
        ? Math.max(120, Number(s.estimatedWordCount))
        : fallbackWordCount,
    }));

  const resolvedTitle = params.fixedTitle || `${params.keyword}の完全ガイド`;
  const normalizedSections = normalizeOutlineSections(
    sections.length > 0
      ? sections
      : [
        { title: '導入', level: 2, description: '記事の導入', isLead: true, estimatedWordCount: fallbackWordCount },
        { title: `${params.keyword}の基礎知識`, level: 2, description: '基本事項の解説', isLead: false, estimatedWordCount: fallbackWordCount },
        { title: `${params.keyword}の選び方`, level: 2, description: '実践ポイントの整理', isLead: false, estimatedWordCount: fallbackWordCount },
        { title: 'まとめ', level: 2, description: '重要ポイントの振り返り', isLead: false, estimatedWordCount: fallbackWordCount },
      ],
    params.targetWordCount,
    {
      keywordHint: params.keyword,
      articleTitleHint: resolvedTitle,
    }
  );

  return {
    title: resolvedTitle,
    sections: normalizedSections,
  };
}

export async function generateArticleFromOutlineWithSharedCore(
  params: GenerateArticleWithSharedCoreParams
): Promise<SharedGenerationResult> {
  const tone = normalizeTone(params.tone);
  const configuredMaxTokens = Number(params.defaultMaxTokens);
  const maxTokens = Number.isFinite(configuredMaxTokens) && configuredMaxTokens > 0
    ? Math.max(MIN_GENERATION_MAX_TOKENS, Math.floor(configuredMaxTokens))
    : 2000;
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
  fullContent = await ensureSummarySection(
    fullContent,
    params.outline.title,
    params.keywords,
    params.callAI,
    maxTokens
  );

  return {
    sectionsWithContent,
    fullContent,
    wordCount: countGeneratedChars(fullContent)
  };
}

export async function generateFullArticleWithSharedCore(
  params: GenerateFullArticleWithSharedCoreParams
): Promise<{ outline: SharedArticleOutline; generationResult: SharedGenerationResult }> {
  const outline = await generateOutlineWithSharedCore({
    keyword: params.keyword,
    targetWordCount: params.targetWordCount,
    fixedTitle: params.fixedTitle,
    customInstructions: params.customInstructions,
    competitorHeadings: params.competitorHeadings,
    callAI: params.callAI
  });

  const generationResult = await generateArticleFromOutlineWithSharedCore({
    outline,
    keywords: params.keywords,
    tone: params.tone,
    targetWordCount: params.targetWordCount,
    customInstructions: params.customInstructions,
    defaultMaxTokens: params.defaultMaxTokens,
    qualityRetryCount: params.qualityRetryCount,
    callAI: params.callAI
  });

  return { outline, generationResult };
}

export async function generateOutlineWithAutoModeStyle(
  params: GenerateOutlineWithSharedCoreParams
): Promise<SharedArticleOutline> {
  const prompt = [
    '以下の条件で、SEO記事の見出し構成をJSON配列のみで作成してください。',
    `メインキーワード: ${params.keyword}`,
    `目標文字数: ${params.targetWordCount}`,
    params.fixedTitle ? `固定タイトル: ${params.fixedTitle}` : '',
    params.competitorHeadings && params.competitorHeadings.length > 0
      ? `競合見出し（参考）: ${params.competitorHeadings.slice(0, 15).join(', ')}`
      : '',
    params.customInstructions ? `追加指示: ${params.customInstructions}` : '',
    '',
    '必須要件:',
    '- 出力はJSON配列のみ。説明文・Markdown・コードフェンスは不要',
    '- 各要素に title / description / level / estimatedWordCount / isLead を含める',
    '- level は 2 または 3 のみ',
    '- 先頭要素は導入セクションとして isLead=true にする',
    '- estimatedWordCount は 120 以上の整数',
    '- H2中心で構成し、H3は必要時のみ使用する',
    '- 見出しに記事タイトル全体を繰り返さない（例: 「記事タイトル - 〇〇」を禁止）',
    '- 見出しは原則 12〜36 文字で、自然な日本語のフレーズにする',
    '',
    '出力例:',
    '[{"title":"導入","description":"記事の導入","level":2,"estimatedWordCount":260,"isLead":true}]',
  ].filter(Boolean).join('\n');

  const text = await params.callAI(prompt, 2000);
  const jsonArrayText = extractJsonArray(text);

  let rawSections: Array<{
    title?: string;
    description?: string;
    level?: number;
    estimatedWordCount?: number;
    isLead?: boolean;
  }> = [];

  if (jsonArrayText) {
    try {
      const parsed = JSON.parse(jsonArrayText);
      if (Array.isArray(parsed)) {
        rawSections = parsed;
      }
    } catch {
      // Fallback handled below.
    }
  }

  const fallbackWordCount = Math.max(180, Math.floor(params.targetWordCount / 5));
  const sections: SharedOutlineSection[] = rawSections
    .filter((s) => String(s?.title || '').trim().length > 0)
    .map((s, index) => ({
      title: String(s.title || '').trim(),
      level: s.level === 3 ? 3 : 2,
      description: String(s.description || '').trim(),
      isLead: Boolean(s.isLead) || index === 0,
      estimatedWordCount: Number.isFinite(Number(s.estimatedWordCount))
        ? Math.max(120, Number(s.estimatedWordCount))
        : fallbackWordCount,
    }));

  const resolvedTitle = params.fixedTitle || `${params.keyword}の完全ガイド`;
  const normalizedSections = normalizeOutlineSections(
    sections.length > 0
      ? sections
      : [
        { title: '導入', level: 2, description: '記事の導入', isLead: true, estimatedWordCount: fallbackWordCount },
        { title: `${params.keyword}の基礎知識`, level: 2, description: '基本事項の解説', isLead: false, estimatedWordCount: fallbackWordCount },
        { title: `${params.keyword}の選び方`, level: 2, description: '実践ポイントの整理', isLead: false, estimatedWordCount: fallbackWordCount },
        { title: 'まとめ', level: 2, description: '重要ポイントの振り返り', isLead: false, estimatedWordCount: fallbackWordCount },
      ],
    params.targetWordCount,
    {
      keywordHint: params.keyword,
      articleTitleHint: resolvedTitle,
    }
  );

  return {
    title: resolvedTitle,
    sections: normalizedSections,
  };
}
