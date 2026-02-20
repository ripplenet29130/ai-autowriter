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
  relatedKeywords?: string[];
  tone?: string;
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
  finalPolish?: boolean;
  onSectionComplete?: (payload: {
    index: number;
    total: number;
    section: SharedSectionWithContent;
  }) => void | Promise<void>;
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
  const paragraphs = content.split('\n\n').map((p) => p.trim()).filter(Boolean);
  const max = Math.max(1, Math.floor(targetWordCount * 1.05));
  const result: string[] = [];
  let currentCount = 0;

  const isHeadingOnly = (paragraph: string): boolean => /^#{1,6}\s+\S/.test(paragraph.trim());

  for (let i = 0; i < paragraphs.length; i += 1) {
    const paragraph = paragraphs[i];
    const paragraphLength = countGeneratedChars(paragraph);

    if (isHeadingOnly(paragraph) && i + 1 < paragraphs.length) {
      const next = paragraphs[i + 1];
      const bundledLength = paragraphLength + countGeneratedChars(next);
      if (currentCount + bundledLength <= max || result.length === 0) {
        result.push(paragraph, next);
        currentCount += bundledLength;
        i += 1;
        continue;
      }
      break;
    }

    if (currentCount + paragraphLength <= max || result.length === 0) {
      result.push(paragraph);
      currentCount += paragraphLength;
    } else {
      break;
    }
  }

  while (result.length > 0 && isHeadingOnly(result[result.length - 1])) {
    result.pop();
  }

  return result.join('\n\n').trim();
}

function normalizeComparableText(value: string): string {
  return String(value || '')
    .replace(/\s+/g, ' ')
    .replace(/[　]/g, ' ')
    .trim();
}

interface ParsedOutlineLikeSection {
  title: string;
  level: 2 | 3;
  description: string;
  estimatedWordCount: number;
  isLead: boolean;
}

function parseOutlineSectionsFromJson(
  text: string,
  defaultEstimatedWordCount = 300
): { title?: string; sections: ParsedOutlineLikeSection[] } {
  const source = String(text || '');
  if (!source.trim()) return { sections: [] };

  const extractJsonCandidate = (): string => {
    const fenced = source.match(/```json\s*([\s\S]*?)```/i);
    if (fenced?.[1]) return fenced[1].trim();
    const objMatch = source.match(/\{[\s\S]*\}/);
    if (objMatch?.[0]) return objMatch[0].trim();
    const arrMatch = source.match(/\[[\s\S]*\]/);
    if (arrMatch?.[0]) return arrMatch[0].trim();
    return '';
  };

  const jsonCandidate = extractJsonCandidate();
  if (!jsonCandidate) return { sections: [] };

  let parsed: any;
  try {
    parsed = JSON.parse(jsonCandidate);
  } catch {
    return { sections: [] };
  }

  const rootTitle = typeof parsed?.title === 'string' ? parsed.title.trim() : undefined;
  const rawSections = Array.isArray(parsed)
    ? parsed
    : Array.isArray(parsed?.sections)
      ? parsed.sections
      : [];

  const sections: ParsedOutlineLikeSection[] = [];
  for (const item of rawSections) {
    const rawTitle = String(item?.title || '').trim();
    if (!rawTitle) continue;
    const rawLevel = String(item?.level ?? '').toLowerCase();
    const isLead = rawLevel === 'lead' || rawLevel === 'intro' || rawLevel === '導入' || Boolean(item?.isLead);
    const level: 2 | 3 = rawLevel === 'h3' || rawLevel === '3' ? 3 : 2;
    const description = String(item?.description || item?.summary || '').trim();
    const estimated = Number.parseInt(String(item?.estimatedWordCount ?? item?.estimated ?? item?.chars ?? ''), 10);
    sections.push({
      title: rawTitle,
      level,
      description,
      estimatedWordCount: Number.isFinite(estimated) && estimated > 0 ? estimated : Math.max(120, defaultEstimatedWordCount),
      isLead
    });
  }

  if (sections.length > 0) {
    const leadIndex = sections.findIndex((section) => section.isLead);
    if (leadIndex === -1) {
      sections[0] = { ...sections[0], isLead: true, level: 2 };
    } else if (leadIndex > 0) {
      const [lead] = sections.splice(leadIndex, 1);
      sections.unshift({ ...lead, isLead: true, level: 2 });
    }
  }

  return { title: rootTitle, sections };
}

function parseLooseH2Lines(
  text: string,
  defaultEstimatedWordCount = 300
): ParsedOutlineLikeSection[] {
  const lines = String(text || '')
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  const sections: ParsedOutlineLikeSection[] = [];
  const seen = new Set<string>();

  const pickTitle = (line: string): string => {
    const patterns = [
      /^(?:H2)\s*[:：]\s*(.+)$/i,
      /^##\s+(.+)$/,
      /^[-*]\s+(.+)$/,
      /^\d+[.)]\s+(.+)$/,
    ];
    for (const pattern of patterns) {
      const m = line.match(pattern);
      if (m?.[1]) return m[1].trim();
    }
    if (line.length <= 70 && !/[。！？]$/.test(line)) return line;
    return '';
  };

  for (const line of lines) {
    const rawTitle = pickTitle(line);
    if (!rawTitle) continue;
    const title = rawTitle
      .replace(/^["'「」]+|["'「」]+$/g, '')
      .replace(/[：:]$/, '')
      .trim();
    if (!title) continue;
    if (/^(導入|はじめに|まとめ|結論)$/i.test(title)) continue;
    const key = canonicalizeHeading(title);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    sections.push({
      title,
      level: 2,
      description: '',
      estimatedWordCount: Math.max(120, defaultEstimatedWordCount),
      isLead: false
    });
    if (sections.length >= 6) break;
  }

  return sections;
}

function looksLikeMetaResponse(value: string): boolean {
  const text = String(value || '').trim();
  if (!text) return true;
  const patterns = [
    /ご提示いただいた本文/,
    /以下に.*要約/,
    /以下に.*追記/,
    /本文の続きとして/,
    /ご了承ください/,
    /要約を記載/,
    /追記を作成/,
    /不足しております/,
    /困難である/,
    /^-{3,}$/m,
  ];
  return patterns.some((pattern) => pattern.test(text));
}

function extractH2Titles(markdown: string): string[] {
  const titles: string[] = [];
  const regex = /^##\s+(.+)$/gm;
  let match: RegExpExecArray | null = null;
  while ((match = regex.exec(String(markdown || ''))) !== null) {
    const title = String(match[1] || '').trim();
    if (title) titles.push(title);
  }
  return titles;
}

function normalizeHeadingKey(value: string): string {
  return String(value || '')
    .replace(/\s+/g, '')
    .replace(/[　]/g, '')
    .replace(/[!！?？:：・]/g, '')
    .toLowerCase();
}

function isValidPolishedArticle(
  original: string,
  candidate: string
): boolean {
  const cleanedCandidate = String(candidate || '').trim();
  if (!cleanedCandidate) return false;
  if (looksLikeMetaResponse(cleanedCandidate)) return false;

  const originalH2 = extractH2Titles(original).map(normalizeHeadingKey);
  const candidateH2 = extractH2Titles(cleanedCandidate).map(normalizeHeadingKey);
  if (originalH2.length !== candidateH2.length) return false;
  for (let i = 0; i < originalH2.length; i += 1) {
    if (originalH2[i] !== candidateH2[i]) return false;
  }

  const origLen = Math.max(1, countGeneratedChars(original));
  const candLen = Math.max(1, countGeneratedChars(cleanedCandidate));
  const ratio = candLen / origLen;
  if (ratio < 0.75 || ratio > 1.35) return false;

  return true;
}

function selectH3TitlesForH2(h2Title: string, count: number): string[] {
  const title = String(h2Title || '').toLowerCase();
  const pool = (() => {
    if (title.includes('メリット') && title.includes('デメリット')) {
      return ['メリット面の整理', 'デメリット面の整理'];
    }
    if (title.includes('メリット')) {
      return ['主なメリット', '体感しやすい効果'];
    }
    if (title.includes('デメリット')) {
      return ['主なデメリット', '後悔を防ぐ対策'];
    }
    if (title.includes('費用') || title.includes('価格') || title.includes('コスト')) {
      return ['費用の内訳', 'コストを抑えるポイント'];
    }
    if (title.includes('選び方') || title.includes('比較')) {
      return ['比較時のチェック項目', '判断を誤らないコツ'];
    }
    return ['重要ポイント', '実践時の着眼点'];
  })();
  return pool.slice(0, Math.max(1, Math.min(count, pool.length)));
}

function insertSubheadingsIntoLongSections(markdown: string): string {
  const text = String(markdown || '').trim();
  if (!text) return text;

  const h2Regex = /^##\s+(.+)$/gm;
  const matches: Array<{ index: number; full: string; title: string }> = [];
  let m: RegExpExecArray | null = null;
  while ((m = h2Regex.exec(text)) !== null) {
    matches.push({ index: m.index, full: m[0], title: String(m[1] || '').trim() });
  }
  if (matches.length === 0) return text;

  const blocks: string[] = [];
  let cursor = 0;

  const pushUntil = (end: number) => {
    if (end > cursor) {
      blocks.push(text.slice(cursor, end));
      cursor = end;
    }
  };

  for (let i = 0; i < matches.length; i += 1) {
    const current = matches[i];
    const nextIndex = i + 1 < matches.length ? matches[i + 1].index : text.length;

    // Add text before this H2 (lead etc.)
    pushUntil(current.index);

    const blockRaw = text.slice(current.index, nextIndex);
    const firstBreak = blockRaw.indexOf('\n');
    if (firstBreak < 0) {
      blocks.push(blockRaw);
      cursor = nextIndex;
      continue;
    }

    const headingLine = blockRaw.slice(0, firstBreak).trimEnd();
    const body = blockRaw.slice(firstBreak + 1).trim();

    if (
      !body ||
      /^###\s+/m.test(body) ||
      SUMMARY_TITLE_PATTERN.test(current.title) ||
      countGeneratedChars(body) < 520
    ) {
      blocks.push(blockRaw);
      cursor = nextIndex;
      continue;
    }

    const paragraphs = body.split(/\n{2,}/).map((p) => p.trim()).filter(Boolean);
    if (paragraphs.length < 3) {
      blocks.push(blockRaw);
      cursor = nextIndex;
      continue;
    }

    const insertCount = paragraphs.length >= 5 ? 2 : 1;
    const h3Titles = selectH3TitlesForH2(current.title, insertCount);

    let rebuiltBody = '';
    if (insertCount === 1) {
      const split = Math.max(1, Math.floor(paragraphs.length / 2));
      const part1 = paragraphs.slice(0, split).join('\n\n');
      const part2 = paragraphs.slice(split).join('\n\n');
      rebuiltBody = [
        `### ${h3Titles[0] || '重要ポイント'}`,
        '',
        part1,
        '',
        part2
      ].join('\n').trim();
    } else {
      const split1 = Math.max(1, Math.floor(paragraphs.length / 2));
      const part1 = paragraphs.slice(0, split1).join('\n\n');
      const part2 = paragraphs.slice(split1).join('\n\n');
      rebuiltBody = [
        `### ${h3Titles[0] || '重要ポイント'}`,
        '',
        part1,
        '',
        `### ${h3Titles[1] || '実践時の着眼点'}`,
        '',
        part2
      ].join('\n').trim();
    }

    blocks.push(`${headingLine}\n\n${rebuiltBody}\n`);
    cursor = nextIndex;
  }

  pushUntil(text.length);
  return blocks.join('').trim();
}

async function polishArticleFormatting(
  originalContent: string,
  outline: SharedArticleOutline,
  callAI: SharedCallAI,
  maxTokens: number
): Promise<string> {
  const prompt = [
    '以下のMarkdown記事を「内容を変えずに」整形してください。',
    '目的は読みやすさ向上です。適切な改行と、必要箇所への最小限のH3追加のみを行ってください。',
    '厳守ルール:',
    '- 事実・主張・数値・固有名詞・結論を変更しない',
    '- H2見出しの文言と順序を変更しない',
    '- 文章の要約・言い換え・追加説明・削除をしない',
    '- 前置き、注釈、断り書き、区切り線を出力しない',
    '- 出力はMarkdown本文のみ',
    '',
    `記事タイトル: ${outline.title}`,
    'H2一覧:',
    ...outline.sections.filter((s) => !s.isLead).map((s) => `- ${s.title}`),
    '',
    '本文:',
    originalContent
  ].join('\n');

  try {
    const polished = (await callAI(prompt, Math.min(2200, Math.max(1200, maxTokens)))).trim();
    if (!isValidPolishedArticle(originalContent, polished)) {
      return originalContent;
    }
    return formatReadableParagraphs(polished);
  } catch {
    return originalContent;
  }
}

function sanitizeRewriterOutput(
  output: string,
  originalContent: string,
  isSection: boolean
): string {
  let text = String(output || '').trim();
  if (!text) return '';

  // Remove obvious wrapper lines and stray markdown separators.
  text = text
    .replace(/^[-=]{3,}\s*$/gm, '')
    .replace(/^\*\*タイトル[:：].*?\*\*\s*$/gm, '')
    .replace(/^(?:タイトル|Title)\s*[:：].*$/gm, '')
    .trim();

  if (isSection) {
    // Section continuation should not contain headings.
    text = text.replace(/^#{1,6}\s+.*$/gm, '').trim();
  }

  if (looksLikeMetaResponse(text)) return '';

  const normalizedOriginal = normalizeComparableText(originalContent);
  const normalizedText = normalizeComparableText(text);
  if (!normalizedText) return '';

  // Reject near-duplicate / full restatement responses.
  const anchor = normalizedOriginal.slice(0, 140);
  if (anchor.length >= 60 && normalizedText.includes(anchor)) return '';

  return text;
}

async function summarizeToWordCount(
  originalContent: string,
  title: string,
  targetWordCount: number,
  keywords: string[],
  callAI: SharedCallAI,
  maxTokens: number,
  isSection = false
): Promise<string> {
  const summaryPrompt = buildSummaryPrompt({
    originalContent,
    title,
    targetWordCount,
    keywords
  });

  try {
    const summarizedText = await callAI(summaryPrompt, maxTokens);
    const cleaned = sanitizeRewriterOutput(summarizedText, originalContent, isSection);
    if (!cleaned) {
      return truncateByParagraph(originalContent, targetWordCount);
    }
    if (!isSection) {
      const originalH2 = (originalContent.match(/^##\s+/gm) || []).length;
      const cleanedH2 = (cleaned.match(/^##\s+/gm) || []).length;
      const hasDanglingHeading = /(?:^|\n\n)#{1,6}\s+\S+\s*$/.test(cleaned);
      const minLength = Math.max(300, Math.floor(targetWordCount * 0.6));
      if (
        hasDanglingHeading ||
        countGeneratedChars(cleaned) < minLength ||
        (originalH2 >= 2 && cleanedH2 < 2)
      ) {
        return truncateByParagraph(originalContent, targetWordCount);
      }
    }
    return cleaned;
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
    const rawAddition = await callAI(supplementPrompt, maxTokens);
    const addition = sanitizeRewriterOutput(rawAddition, originalContent, isSection);
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

function stripLeadingTitleLine(content: string, articleTitle: string): string {
  const text = String(content || '').trim();
  if (!text) return text;
  const lines = text.split('\n');
  if (lines.length === 0) return text;

  const normalize = (value: string): string => String(value || '')
    .replace(/[ 　\t]/g, '')
    .replace(/[!！?？:：・]/g, '')
    .toLowerCase()
    .trim();

  if (normalize(lines[0]) === normalize(articleTitle)) {
    return lines.slice(1).join('\n').trim();
  }
  return text;
}

function trimDanglingTail(content: string): string {
  const text = String(content || '').trim();
  if (!text) return '';

  const isHeadingOnly = (line: string): boolean => /^#{1,6}\s+\S/.test(line.trim());
  const blocks = text.split(/\n{2,}/).map((b) => b.trim()).filter(Boolean);
  while (blocks.length > 0 && isHeadingOnly(blocks[blocks.length - 1])) {
    blocks.pop();
  }

  let merged = blocks.join('\n\n').trim();
  if (!merged) return '';

  if (/[。！？.!?」』）\]】"'”]\s*$/.test(merged)) {
    return merged;
  }

  if (merged.length < 120) return merged;

  const boundaries = ['。', '！', '？', '.', '!', '?']
    .map((mark) => merged.lastIndexOf(mark))
    .filter((index) => index >= 0);
  if (boundaries.length === 0) return merged;

  const lastBoundary = Math.max(...boundaries);
  if (lastBoundary < Math.floor(merged.length * 0.7)) {
    return merged;
  }

  return merged.slice(0, lastBoundary + 1).trim();
}

function normalizeDigits(value: string): string {
  return String(value || '').replace(/[０-９]/g, (ch) => String(ch.charCodeAt(0) - 0xFEE0));
}

function kanjiNumberToInt(value: string): number | null {
  const map: Record<string, number> = {
    一: 1,
    二: 2,
    三: 3,
    四: 4,
    五: 5,
    六: 6,
    七: 7,
    八: 8,
    九: 9,
    十: 10,
  };
  if (!value) return null;
  if (value === '十') return 10;
  if (value.length === 1 && map[value] != null) return map[value];
  if (value.length === 2 && value[0] === '十' && map[value[1]] != null) return 10 + map[value[1]];
  if (value.length === 2 && map[value[0]] != null && value[1] === '十') return map[value[0]] * 10;
  if (value.length === 3 && map[value[0]] != null && value[1] === '十' && map[value[2]] != null) {
    return map[value[0]] * 10 + map[value[2]];
  }
  return null;
}

function extractExpectedPointCount(title: string, description?: string): number | null {
  const source = `${title || ''} ${description || ''}`;
  const normalized = normalizeDigits(source);

  const digitMatch = normalized.match(/(\d{1,2})\s*(?:つ|項目|ポイント|視点|理由|手順|注意点|デメリット|メリット|選び方)/);
  if (digitMatch?.[1]) {
    const n = Number.parseInt(digitMatch[1], 10);
    if (Number.isFinite(n) && n >= 2 && n <= 12) return n;
  }

  const kanjiMatch = normalized.match(/([一二三四五六七八九十]{1,3})\s*(?:つ|項目|ポイント|視点|理由|手順|注意点|デメリット|メリット|選び方)/);
  if (kanjiMatch?.[1]) {
    const n = kanjiNumberToInt(kanjiMatch[1]);
    if (n != null && n >= 2 && n <= 12) return n;
  }

  return null;
}

function countDetectedPoints(content: string): number {
  const text = String(content || '');
  if (!text) return 0;

  const lines = text.split('\n').map((line) => line.trim()).filter(Boolean);

  const headingCount = lines.filter((line) => /^###\s+\S+/.test(line)).length;
  const bulletCount = lines.filter((line) => /^[-*]\s+\S+/.test(line) || /^\d+[.)]\s+\S+/.test(line)).length;
  const leadInCount = lines.filter((line) => /^(まず|第一に|次に|第二に|さらに|第三に|最後に|第四に|最後に|一つ目|二つ目|三つ目|四つ目)/.test(line)).length;

  return Math.max(headingCount, bulletCount, leadInCount);
}

function endsWithContinuationCue(content: string): boolean {
  const text = String(content || '').trim();
  if (!text) return false;
  const tail = text.slice(-40);
  return /(まず|次に|さらに|また|一方で|そして|最後に|例えば|具体的には|このため|そのため|なお|ただし|ここで)\s*(?:、|：)?$/.test(tail);
}

function isLikelyIncompleteSection(
  content: string,
  section: SharedOutlineSection
): { incomplete: boolean; reason?: string } {
  const text = String(content || '').trim();
  if (!text) return { incomplete: true, reason: 'empty' };

  if (endsWithContinuationCue(text)) {
    return { incomplete: true, reason: 'continuation-tail' };
  }

  const expectedPoints = extractExpectedPointCount(section.title, section.description);
  if (expectedPoints != null) {
    const detected = countDetectedPoints(text);
    if (detected > 0 && detected < expectedPoints) {
      return { incomplete: true, reason: `points:${detected}/${expectedPoints}` };
    }
  }

  return { incomplete: false };
}

async function completeSectionIfIncomplete(
  content: string,
  section: SharedOutlineSection,
  outlineTitle: string,
  callAI: SharedCallAI,
  maxTokens: number
): Promise<string> {
  const check = isLikelyIncompleteSection(content, section);
  if (!check.incomplete) return content;

  const prompt = [
    '以下のセクション本文は要点が途中で終わっている可能性があります。',
    '内容を保ったまま、不足分だけを追記してください。',
    '',
    `記事タイトル: ${outlineTitle}`,
    `セクション見出し: ${section.title}`,
    section.description ? `セクション意図: ${section.description}` : '',
    `不足判定: ${check.reason || 'unknown'}`,
    '',
    '出力ルール:',
    '- 追記本文のみを出力（見出し・タイトルは出さない）',
    '- 既存文の言い換えや繰り返しはしない',
    '- 2〜4段落で完結させる',
    '- 文末を未完で終わらせない',
    '',
    '既存本文:',
    content,
  ].filter(Boolean).join('\n');

  try {
    const raw = await callAI(prompt, maxTokens);
    const addition = sanitizeRewriterOutput(raw, content, true);
    if (!addition) return content;

    const merged = trimDanglingTail(`${content}\n\n${addition}`.trim());
    return merged || content;
  } catch {
    return content;
  }
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
      .replace(/。(?=\S)/g, '。\n\n')
      .replace(/！(?=\S)/g, '！\n\n')
      .replace(/？(?=\S)/g, '？\n\n')
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
  if (targetWordCount <= 1200) return Math.max(90, Math.round(targetWordCount * 0.11));
  if (targetWordCount <= 2200) return Math.max(120, Math.round(targetWordCount * 0.10));
  return Math.max(160, Math.round(targetWordCount * 0.09));
}

function getEdgeSectionBounds(targetWordCount: number): { min: number; max: number; base: number } {
  const base = calculateEdgeSectionWordCount(targetWordCount);
  const min = Math.max(80, Math.round(base * 0.8));
  const max = Math.max(min + 30, Math.round(base * 1.2));
  return { min, max, base };
}

function clampNumber(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, Math.round(value)));
}

function normalizeOutlineSections(
  sections: SharedOutlineSection[],
  targetWordCount: number
): SharedOutlineSection[] {
  const normalized = sections.map((section) => ({ ...section }));

  const edgeBounds = getEdgeSectionBounds(targetWordCount);
  const leadWordCount = edgeBounds.base;
  const summaryWordCount = edgeBounds.base;

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
      title: '導入',
      level: 2,
      isLead: true
    });
  } else {
    normalized[0] = {
      ...normalized[0],
      title: '導入',
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

  if (normalized.length > 0) {
    normalized[0].estimatedWordCount = clampNumber(
      normalized[0].estimatedWordCount || leadWordCount,
      edgeBounds.min,
      edgeBounds.max
    );
  }
  if (normalized.length > 1) {
    const lastIndex = normalized.length - 1;
    normalized[lastIndex].estimatedWordCount = clampNumber(
      normalized[lastIndex].estimatedWordCount || summaryWordCount,
      edgeBounds.min,
      edgeBounds.max
    );
  }

  return normalized;
}

function rebalanceEstimatedWordCounts(
  sections: SharedOutlineSection[],
  targetWordCount: number
): SharedOutlineSection[] {
  if (!Array.isArray(sections) || sections.length === 0) return sections;
  if (!Number.isFinite(targetWordCount) || targetWordCount <= 0) return sections;

  const minPerSection = 120;
  const edgeBounds = getEdgeSectionBounds(targetWordCount);
  const weights = sections.map((section) => Math.max(1, section.estimatedWordCount || 1));
  const weightSum = weights.reduce((sum, w) => sum + w, 0);

  const adjusted = sections.map((section, index) => {
    const ratio = weightSum > 0 ? weights[index] / weightSum : 1 / sections.length;
    const isEdge = section.isLead || isSummaryLikeTitle(section.title);
    const min = isEdge ? edgeBounds.min : minPerSection;
    const max = isEdge ? edgeBounds.max : Number.MAX_SAFE_INTEGER;
    const estimated = clampNumber(Math.round(targetWordCount * ratio), min, max);
    return { ...section, estimatedWordCount: estimated };
  });

  let currentSum = adjusted.reduce((sum, section) => sum + section.estimatedWordCount, 0);
  let remainder = targetWordCount - currentSum;
  const primaryOrder = adjusted
    .map((section, index) => ({ index, score: section.estimatedWordCount, isEdge: section.isLead || isSummaryLikeTitle(section.title) }))
    .sort((a, b) => {
      if (a.isEdge !== b.isEdge) return a.isEdge ? 1 : -1;
      return b.score - a.score;
    })
    .map((x) => x.index);

  let guard = 0;
  while (remainder !== 0 && guard < 5000) {
    let moved = false;
    for (const idx of primaryOrder) {
      if (remainder === 0) break;
      const section = adjusted[idx];
      const isEdge = section.isLead || isSummaryLikeTitle(section.title);
      const min = isEdge ? edgeBounds.min : minPerSection;
      const max = isEdge ? edgeBounds.max : Number.MAX_SAFE_INTEGER;
      if (remainder > 0) {
        if (section.estimatedWordCount < max) {
          section.estimatedWordCount += 1;
          remainder -= 1;
          moved = true;
        }
      } else if (section.estimatedWordCount > min) {
        section.estimatedWordCount -= 1;
        remainder += 1;
        moved = true;
      }
    }
    if (!moved) break;
    guard += 1;
  }

  currentSum = adjusted.reduce((sum, section) => sum + section.estimatedWordCount, 0);
  if (currentSum !== targetWordCount) {
    const delta = targetWordCount - currentSum;
    const fallbackOrder = adjusted
      .map((section, index) => ({ index, isEdge: section.isLead || isSummaryLikeTitle(section.title) }))
      .sort((a, b) => (a.isEdge === b.isEdge ? 0 : a.isEdge ? 1 : -1))
      .map((x) => x.index);
    let remaining = delta;
    for (const idx of fallbackOrder) {
      if (remaining === 0) break;
      const section = adjusted[idx];
      const isEdge = section.isLead || isSummaryLikeTitle(section.title);
      const min = isEdge ? edgeBounds.min : minPerSection;
      const max = isEdge ? edgeBounds.max : Number.MAX_SAFE_INTEGER;
      if (remaining > 0) {
        const movable = Math.min(remaining, Math.max(0, max - section.estimatedWordCount));
        if (movable > 0) {
          section.estimatedWordCount += movable;
          remaining -= movable;
        }
      } else {
        const movable = Math.min(-remaining, Math.max(0, section.estimatedWordCount - min));
        if (movable > 0) {
          section.estimatedWordCount -= movable;
          remaining += movable;
        }
      }
    }
  }

  return adjusted;
}

function flattenHeadingLevelsForMediumLength(
  sections: SharedOutlineSection[],
  targetWordCount: number
): SharedOutlineSection[] {
  if (!Array.isArray(sections) || sections.length === 0) return sections;
  if (!Number.isFinite(targetWordCount) || targetWordCount <= 0) return sections;
  if (targetWordCount > 2200) return sections;
  return sections.map((section) => ({ ...section, level: 2 }));
}

function canonicalizeHeading(title: string): string {
  return String(title || '')
    .replace(/[ 　\t]/g, '')
    .replace(/[!！?？:：・]/g, '')
    .toLowerCase();
}

function isSummaryLikeTitle(title: string): boolean {
  return SUMMARY_TITLE_PATTERN.test(String(title || '').trim());
}

function hasSummaryHeading(content: string): boolean {
  return /^##\s*(?:まとめ|結論|総括|おわりに|最後に|summary|conclusion)\s*$/im.test(String(content || ''));
}

function extractH2WithoutSummary(content: string): string[] {
  const matches = String(content || '').match(/^##\s+(.+)$/gm) || [];
  return matches
    .map((line) => line.replace(/^##\s+/, '').trim())
    .filter((title) => title.length > 0 && !isSummaryLikeTitle(title));
}

function normalizeHeadingForSummary(title: string): string {
  return String(title || '')
    .replace(/[`*_~]/g, '')
    .replace(/[：:].*$/, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function buildFallbackSummarySection(outline: SharedArticleOutline, content: string): string {
  const h2Titles = extractH2WithoutSummary(content)
    .map(normalizeHeadingForSummary)
    .filter(Boolean)
    .slice(0, 3);
  const focusLine = h2Titles.length > 0
    ? `本記事では、${h2Titles.join('、')}を中心に、判断に必要な情報を整理しました。`
    : '本記事では、判断に必要な情報を整理しました。';

  return [
    '## まとめ',
    '',
    focusLine,
    '',
    '導入前には、初期費用と維持管理の負担、住環境との相性、期待できる効果を総合的に確認し、無理なく継続できる選択を行うことが重要です。'
  ].join('\n');
}

function ensureSummarySection(content: string, outline: SharedArticleOutline): string {
  const text = String(content || '').trim();
  if (!text) return text;
  if (hasSummaryHeading(text)) return text;
  return `${text}\n\n${buildFallbackSummarySection(outline, text)}`.trim();
}

function buildSupplementSectionCandidates(
  keyword: string,
  relatedKeywords: string[]
): Array<{ title: string; description: string }> {
  const base = [
    {
      title: '見落としやすい確認項目',
      description: '比較時に見るべき観点を具体的に整理する',
    },
    {
      title: '選ぶ前に確認したい注意点',
      description: '失敗を避けるためのチェックポイントを明確にする',
    },
    {
      title: '長く使うための実践ポイント',
      description: '無理なく続けるための実践策を提示する',
    },
  ];

  const related = (relatedKeywords || [])
    .map((k) => String(k || '').trim())
    .filter((k) => k.length > 0)
    .slice(0, 6)
    .map((k) => ({
      title: `${k}を踏まえたチェックポイント`,
      description: '関連テーマをもとに比較時の見落としを防ぐ',
    }));

  return [...related, ...base];
}

function supplementOutlineSections(
  sections: SharedOutlineSection[],
  keyword: string,
  relatedKeywords: string[],
  targetWordCount: number,
  minimumSectionCount: number
): SharedOutlineSection[] {
  if (sections.length >= minimumSectionCount) return sections;

  const normalized = normalizeOutlineSections(sections, targetWordCount);
  if (normalized.length >= minimumSectionCount) return normalized;

  if (normalized.length < 2) return normalized;

  const lead = normalized[0];
  const summary = normalized[normalized.length - 1];
  const middle = normalized.slice(1, -1);
  const missing = Math.max(0, minimumSectionCount - normalized.length);
  if (missing === 0) return normalized;

  const existing = new Set(
    normalized.map((s) => canonicalizeHeading(s.title))
  );
  const perSection = Math.max(180, Math.floor(Math.max(1200, targetWordCount) / minimumSectionCount));
  const extra: SharedOutlineSection[] = [];

  const candidates = buildSupplementSectionCandidates(keyword, relatedKeywords);
  for (const candidate of candidates) {
    if (extra.length >= missing) break;
    const key = canonicalizeHeading(candidate.title);
    if (!key || existing.has(key) || isSummaryLikeTitle(candidate.title)) continue;
    existing.add(key);
    extra.push({
      title: candidate.title,
      level: 2,
      description: candidate.description,
      isLead: false,
      estimatedWordCount: perSection,
    });
  }

  while (extra.length < missing) {
    const index = extra.length + 1;
    const title = `実践ポイント${index}`;
    const key = canonicalizeHeading(title);
    if (existing.has(key)) {
      continue;
    }
    existing.add(key);
    extra.push({
      title,
      level: 2,
      description: '実行時の具体的な進め方を整理する',
      isLead: false,
      estimatedWordCount: perSection,
    });
  }

  return normalizeOutlineSections([lead, ...middle, ...extra, summary], targetWordCount);
}

async function supplementOutlineSectionsWithAI(
  sections: SharedOutlineSection[],
  keyword: string,
  relatedKeywords: string[],
  targetWordCount: number,
  minimumSectionCount: number,
  callAI: SharedCallAI
): Promise<{ sections: SharedOutlineSection[]; added: number; usedAI: boolean }> {
  if (sections.length >= minimumSectionCount) {
    return { sections, added: 0, usedAI: false };
  }

  const normalized = normalizeOutlineSections(sections, targetWordCount);
  if (normalized.length >= minimumSectionCount || normalized.length < 2) {
    return { sections: normalized, added: 0, usedAI: false };
  }

  const lead = normalized[0];
  const summary = normalized[normalized.length - 1];
  const middle = normalized.slice(1, -1);
  const missing = Math.max(0, minimumSectionCount - normalized.length);
  if (missing === 0) return { sections: normalized, added: 0, usedAI: false };

  const perSection = Math.max(180, Math.floor(Math.max(1200, targetWordCount) / minimumSectionCount));
  const existing = new Set(normalized.map((section) => canonicalizeHeading(section.title)));
  const extracted: SharedOutlineSection[] = [];
  const bannedHeadingPattern = /後悔しないための比較軸/i;
  const maxSupplementAttempts = 3;
  for (let attempt = 0; attempt < maxSupplementAttempts && extracted.length < missing; attempt += 1) {
    const remain = missing - extracted.length;
    const aiPrompt = [
      `キーワード「${keyword}」の記事アウトラインで、H2見出しがあと${remain}個不足しています。`,
      '既存見出しと重複しない、不自然でないH2見出しと説明文を作ってください。',
      '導入やまとめは作らないでください。H2のみです。',
      'キーワードの機械的な連呼を避け、自然な見出しにしてください。',
      '「後悔しないための比較軸」という語句は使わないでください。',
      relatedKeywords && relatedKeywords.length > 0
        ? `関連語: ${relatedKeywords.slice(0, 8).join('、')}`
        : '',
      '既存見出し:',
      ...normalized.map((section) => `- ${section.title}`),
      ...extracted.map((section) => `- ${section.title}`),
      '',
      '出力形式（この形式のみ）:',
      'H2: [見出し]',
      'Description: [説明]',
      `Estimated: ${perSection}`,
      '',
      `上記を${remain}セット。前置きや補足説明は禁止。`
    ].filter(Boolean).join('\n');

    try {
      const response = await callAI(aiPrompt, 1200);
      let parsed = parseOutlineSections(response, perSection, false);
      if (parsed.length === 0) {
        const parsedJson = parseOutlineSectionsFromJson(response, perSection).sections;
        if (parsedJson.length > 0) {
          parsed = parsedJson;
        }
      }
      if (parsed.length === 0) {
        parsed = parseLooseH2Lines(response, perSection);
      }

      for (const item of parsed) {
        if (extracted.length >= missing) break;
        if (item.isLead) continue;
        if (isSummaryLikeTitle(item.title)) continue;
        if (bannedHeadingPattern.test(item.title)) continue;
        const key = canonicalizeHeading(item.title);
        if (!key || existing.has(key)) continue;
        existing.add(key);
        extracted.push({
          title: item.title,
          level: 2,
          description: item.description || '比較時の判断基準を整理する',
          isLead: false,
          estimatedWordCount: item.estimatedWordCount || perSection,
        });
      }
    } catch {
      // no-op
    }
  }

  if (extracted.length === 0) {
    const fallback = supplementOutlineSections(normalized, keyword, relatedKeywords, targetWordCount, minimumSectionCount);
    return { sections: fallback, added: Math.max(0, fallback.length - normalized.length), usedAI: false };
  }

  const combined = normalizeOutlineSections(
    [lead, ...middle, ...extracted, summary],
    targetWordCount
  );

  if (combined.length < minimumSectionCount) {
    const fallback = supplementOutlineSections(combined, keyword, relatedKeywords, targetWordCount, minimumSectionCount);
    return { sections: fallback, added: Math.max(0, fallback.length - normalized.length), usedAI: true };
  }

  return { sections: combined, added: extracted.length, usedAI: true };
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
        maxTokens,
        false
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
        params.maxTokens,
        true
      );
      continue;
    }

    const completionCheck = isLikelyIncompleteSection(content, section);
    if (completionCheck.incomplete) {
      content = await completeSectionIfIncomplete(
        content,
        section,
        outline.title,
        params.callAI,
        params.maxTokens
      );
      continue;
    }

    break;
  }

  if (section.isLead) {
    const leadHardMax = Math.max(120, Math.round(section.estimatedWordCount * 1.15));
    if (countGeneratedChars(content) > leadHardMax) {
      content = truncateByParagraph(content, leadHardMax);
    }
  }

  const normalized = trimDanglingTail(formatReadableParagraphs(content));
  if (section.isLead) {
    return trimDanglingTail(stripLeadingTitleLine(normalized, outline.title));
  }
  return trimDanglingTail(normalized);
}

export async function generateOutlineWithSharedCore(
  params: GenerateOutlineWithSharedCoreParams
): Promise<SharedArticleOutline> {
  const basePrompt = buildSchedulerOutlinePrompt({
    keyword: params.keyword,
    targetWordCount: params.targetWordCount,
    fixedTitle: params.fixedTitle,
    customInstructions: params.customInstructions,
    competitorHeadings: params.competitorHeadings || []
  });

  const maxAttempts = 4;
  const minimumSectionCount = params.targetWordCount <= 1200
    ? 4
    : params.targetWordCount <= 2200
      ? 5
      : params.targetWordCount <= 3200
        ? 6
        : 7;
  const minimumNonLeadCount = Math.max(3, minimumSectionCount - 1);
  let resolvedTitle = params.fixedTitle || `${params.keyword} について`;
  let bestSections: SharedOutlineSection[] = [];
  const attemptDiagnostics: string[] = [];

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const retryInstruction = attempt === 0
      ? ''
      : [
        '【再生成指示】',
        '- 出力形式を厳守し、Section(Lead/H2/H3) の形で返してください。',
        '- 導入とまとめ以外の見出しを最低3つ作成してください。',
        '- 見出しはキーワード連呼を避け、自然な日本語で具体化してください。',
        params.relatedKeywords && params.relatedKeywords.length > 0
          ? `- 関連語を反映: ${params.relatedKeywords.slice(0, 6).join('、')}`
          : '',
        attempt >= 2
          ? '- 形式を守れない場合はJSONのみで返してください: {"title":"...","sections":[{"level":"lead|h2|h3","title":"...","description":"...","estimatedWordCount":300}]}'
          : '',
      ].filter(Boolean).join('\n');

    const prompt = retryInstruction ? `${basePrompt}\n\n${retryInstruction}` : basePrompt;
    const text = await params.callAI(prompt, 1500);
    let parsedSections = parseOutlineSections(text, 400, false);
    const parsedFromJson = parsedSections.length <= 1 ? parseOutlineSectionsFromJson(text, 400) : { sections: [] as ParsedOutlineLikeSection[] };
    if (parsedFromJson.sections.length > parsedSections.length) {
      parsedSections = parsedFromJson.sections;
    }
    resolvedTitle = parsedFromJson.title || parseOutlineTitle(text, params.keyword, params.fixedTitle || null);
    if (parsedSections.length === 0) {
      attemptDiagnostics.push(`attempt${attempt + 1}: parsed=0`);
      continue;
    }

    const mapped: SharedOutlineSection[] = parsedSections.map((section) => ({
      title: section.title,
      level: section.level,
      description: section.description,
      isLead: section.isLead,
      estimatedWordCount: section.estimatedWordCount
    }));
    const normalized = normalizeOutlineSections(mapped, params.targetWordCount);
    attemptDiagnostics.push(`attempt${attempt + 1}: parsed=${parsedSections.length}, normalized=${normalized.length}`);

    if (normalized.length > bestSections.length) {
      bestSections = normalized;
    }
    const nonLeadCount = normalized.filter((section) => !section.isLead).length;
    if (normalized.length >= minimumSectionCount && nonLeadCount >= minimumNonLeadCount) {
      bestSections = normalized;
      break;
    }
  }

  if (bestSections.length < minimumSectionCount) {
    try {
      const rescuePrompt = [
        '以下の条件で、見出し案を再作成してください。',
        `キーワード: ${params.keyword}`,
        `目標文字数: ${params.targetWordCount}`,
        '必ず次の形式だけで返してください。',
        'Title: [記事タイトル]',
        'Section (Lead): 導入',
        'Description: [導入の説明]',
        'Estimated: [文字数]',
        'Section (H2): [見出し]',
        'Description: [説明]',
        'Estimated: [文字数]',
        '最後のH2は「まとめ」にすること。',
        `導入とまとめ以外に最低${Math.max(2, minimumSectionCount - 2)}つのH2を入れること。`,
        'キーワードを不自然に繰り返さないこと。',
        'Section形式で返せない場合は、JSONのみで返してください: {"title":"...","sections":[{"level":"lead|h2|h3","title":"...","description":"...","estimatedWordCount":300}]}'
      ].join('\n');
      const rescueText = await params.callAI(rescuePrompt, 1400);
      let rescueParsed = parseOutlineSections(rescueText, 400, false);
      const rescueJson = rescueParsed.length <= 1 ? parseOutlineSectionsFromJson(rescueText, 400) : { sections: [] as ParsedOutlineLikeSection[] };
      if (rescueJson.sections.length > rescueParsed.length) {
        rescueParsed = rescueJson.sections;
      }
      if (rescueJson.title) {
        resolvedTitle = rescueJson.title;
      }
      if (rescueParsed.length > 0) {
        const rescueMapped: SharedOutlineSection[] = rescueParsed.map((section) => ({
          title: section.title,
          level: section.level,
          description: section.description,
          isLead: section.isLead,
          estimatedWordCount: section.estimatedWordCount,
        }));
        const rescueNormalized = normalizeOutlineSections(rescueMapped, params.targetWordCount);
        if (rescueNormalized.length > bestSections.length) {
          bestSections = rescueNormalized;
        }
        attemptDiagnostics.push(`rescue: parsed=${rescueParsed.length}, normalized=${rescueNormalized.length}`);
      } else {
        attemptDiagnostics.push('rescue: parsed=0');
      }
    } catch (error) {
      attemptDiagnostics.push(`rescue:error=${error instanceof Error ? error.message : String(error)}`);
    }
  }

  if (bestSections.length < minimumSectionCount && bestSections.length >= 2) {
    const supplementedResult = await supplementOutlineSectionsWithAI(
      bestSections,
      params.keyword,
      params.relatedKeywords || [],
      params.targetWordCount,
      minimumSectionCount,
      params.callAI
    );
    if (supplementedResult.sections.length > bestSections.length) {
      bestSections = supplementedResult.sections;
      attemptDiagnostics.push(
        `supplemented:${supplementedResult.usedAI ? 'ai' : 'rule'} added=${supplementedResult.added} normalized=${bestSections.length}`
      );
    }
  }

  if (bestSections.length < minimumSectionCount) {
    const fallbackSectionCount = minimumSectionCount;
    const perSection = Math.max(180, Math.floor(Math.max(1200, params.targetWordCount) / fallbackSectionCount));
    const fallbackSections: SharedOutlineSection[] = [
      {
        title: '導入',
        level: 2,
        description: '記事の導入',
        isLead: true,
        estimatedWordCount: perSection,
      },
      {
        title: `${params.keyword}の基礎知識`,
        level: 2,
        description: '基本事項を整理して前提をそろえる',
        isLead: false,
        estimatedWordCount: perSection,
      }
    ];

    const bodyTarget = Math.max(1, fallbackSectionCount - 2); // lead + summary を除く
    const fallbackCandidates: Array<{ title: string; description: string }> = [
      {
        title: `${params.keyword}の比較ポイント`,
        description: '判断基準を明確にして比較する',
      },
      {
        title: `${params.keyword}の実践手順`,
        description: '失敗しにくい進め方を具体化する',
      },
      {
        title: `${params.keyword}の注意点`,
        description: 'よくある失敗を避けるための留意点を整理する',
      },
      {
        title: `${params.keyword}の費用と継続の考え方`,
        description: '継続しやすさと費用対効果の観点から整理する',
      },
      {
        title: '見落としやすいチェック項目',
        description: '選定時に重要な観点を具体例とともに整理する',
      },
    ];

    let candidateIndex = 0;
    while (fallbackSections.length < bodyTarget + 1) {
      const candidate = fallbackCandidates[candidateIndex];
      if (candidate) {
        fallbackSections.push({
          title: candidate.title,
          level: 2,
          description: candidate.description,
          isLead: false,
          estimatedWordCount: perSection,
        });
      } else {
        const index = fallbackSections.length;
        fallbackSections.push({
          title: `実践ポイント${index}`,
          level: 2,
          description: '実行時に役立つ観点を具体的に整理する',
          isLead: false,
          estimatedWordCount: perSection,
        });
      }
      candidateIndex += 1;
    }

    fallbackSections.push({
      title: 'まとめ',
      level: 2,
      description: '要点を振り返り次の行動につなげる',
      isLead: false,
      estimatedWordCount: perSection,
    });

    bestSections = normalizeOutlineSections(fallbackSections, params.targetWordCount);
    console.warn(
      `[outline] fallback applied keyword="${params.keyword}" min=${minimumSectionCount} diagnostics=${attemptDiagnostics.join(' | ')}`
    );
  }

  const rebalancedSections = rebalanceEstimatedWordCounts(bestSections, params.targetWordCount);
  const normalizedLevels = flattenHeadingLevelsForMediumLength(rebalancedSections, params.targetWordCount);
  return { title: resolvedTitle, sections: normalizedLevels };
}

export async function generateArticleFromOutlineWithSharedCore(
  params: GenerateArticleWithSharedCoreParams
): Promise<SharedGenerationResult> {
  const tone = normalizeTone(params.tone);
  const maxTokens = Math.max(900, params.defaultMaxTokens || 2000);
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

    const completedSection: SharedSectionWithContent = { ...section, content };
    sectionsWithContent.push(completedSection);
    if (params.onSectionComplete) {
      await params.onSectionComplete({
        index: sectionsWithContent.length - 1,
        total: params.outline.sections.length,
        section: completedSection,
      });
    }
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
  fullContent = ensureSummarySection(fullContent, params.outline);

  if (params.finalPolish !== false) {
    fullContent = await polishArticleFormatting(
      fullContent,
      params.outline,
      params.callAI,
      maxTokens
    );
  }
  fullContent = ensureSummarySection(fullContent, params.outline);

  fullContent = insertSubheadingsIntoLongSections(fullContent);
  fullContent = trimDanglingTail(formatReadableParagraphs(fullContent));
  fullContent = ensureSummarySection(fullContent, params.outline);
  if (!fullContent.endsWith('\n')) {
    fullContent = `${fullContent}\n`;
  }

  return {
    sectionsWithContent,
    fullContent,
    wordCount: countGeneratedChars(fullContent)
  };
}

export async function generateOutlineWithAutoModeStyle(
  params: GenerateOutlineWithSharedCoreParams
): Promise<SharedArticleOutline> {
  return generateOutlineWithSharedCore(params);
}
