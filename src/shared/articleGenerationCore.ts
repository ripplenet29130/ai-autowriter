import {
  DEFAULT_WORD_COUNT_TOLERANCE,
  getWordCountBounds,
} from './generationPolicy.ts';
import { buildSummaryPrompt, buildSupplementPrompt } from './generationPrompts.ts';
import { buildSchedulerOutlinePrompt } from './multiStepPromptTemplates.ts';
import { parseOutlineSections, parseOutlineTitle } from './outlineParser.ts';
import { buildHighQualitySectionPrompt } from './sectionGenerationPrompt.ts';
import type { ArticleStructureType } from '../types';

type Tone = 'professional' | 'casual';

export interface SearchConsolePromptQuery {
  query: string;
  clicks?: number;
  impressions?: number;
  ctr?: number;
  position?: number;
}

const FINAL_ARTICLE_WORD_COUNT_TOLERANCE = 0.18;

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
  competitorArticles?: { title: string; headings: string[]; excerpt?: string }[];
  relatedKeywords?: string[];
  searchConsoleQueries?: SearchConsolePromptQuery[];
  tone?: string;
  articleStructureType?: ArticleStructureType;
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
  sectionTimeoutMs?: number;
  onSectionStart?: (payload: {
    index: number;
    total: number;
    section: SharedOutlineSection;
  }) => void | Promise<void>;
  onSectionComplete?: (payload: {
    index: number;
    total: number;
    section: SharedSectionWithContent;
  }) => void | Promise<void>;
}

function normalizeTone(tone?: string): Tone {
  if (tone === 'casual' || tone === 'friendly' || tone === 'desu_masu') {
    return 'casual';
  }
  if (tone === 'professional' || tone === 'technical' || tone === 'da_dearu') {
    return 'professional';
  }
  if (tone === 'casual') {
    return tone;
  }
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

function appendCustomInstructions(prompt: string, customInstructions?: string): string {
  const extra = String(customInstructions || '').trim();
  if (!extra) return prompt;
  return `${prompt}\n\n追加指示:\n${extra}`.trim();
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

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    if (/^(?:Description|説明|概要|Estimated|推定|目安)\s*[:：]/i.test(line)) {
      continue;
    }

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
    let description = '';
    let estimatedWordCount = Math.max(120, defaultEstimatedWordCount);
    for (let j = i + 1; j < lines.length; j += 1) {
      const next = lines[j];
      if (/^(?:H2)\s*[:：]/i.test(next) || /^##\s+/.test(next) || /^\d+[.)]\s+/.test(next)) {
        break;
      }
      const descMatch = next.match(/^(?:Description|説明|概要)\s*[:：]\s*(.+)$/i);
      if (descMatch?.[1]) {
        description = descMatch[1].trim();
        continue;
      }
      const estimated = next.match(/^(?:Estimated|推定|目安)\s*[:：]?\s*(\d+)/i);
      if (estimated?.[1]) {
        const parsedEstimated = Number.parseInt(estimated[1], 10);
        if (Number.isFinite(parsedEstimated) && parsedEstimated > 0) {
          estimatedWordCount = parsedEstimated;
        }
      }
    }

    sections.push({
      title,
      level: 2,
      description,
      estimatedWordCount,
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

function hasSameH2Sequence(original: string, candidate: string): boolean {
  const originalH2 = extractH2Titles(original).map(normalizeHeadingKey);
  const candidateH2 = extractH2Titles(candidate).map(normalizeHeadingKey);
  if (originalH2.length !== candidateH2.length) return false;
  for (let i = 0; i < originalH2.length; i += 1) {
    if (originalH2[i] !== candidateH2[i]) return false;
  }
  return true;
}

function findHeadingsWithoutBody(markdown: string, minBodyChars = 40): string[] {
  const text = String(markdown || '').trim();
  if (!text) return [];

  const headingRegex = /^#{2,3}\s+(.+)$/gm;
  const headings: Array<{ index: number; end: number; level: number; title: string }> = [];
  let match: RegExpExecArray | null = null;
  while ((match = headingRegex.exec(text)) !== null) {
    const line = match[0] || '';
    const title = String(match[1] || '').trim();
    if (!title) continue;
    headings.push({
      index: match.index,
      end: match.index + line.length,
      level: line.startsWith('###') ? 3 : 2,
      title,
    });
  }

  const missing: string[] = [];
  for (let i = 0; i < headings.length; i += 1) {
    const current = headings[i];
    const nextSameOrHigher = headings.find((candidate, candidateIndex) =>
      candidateIndex > i && candidate.level <= current.level
    );
    const sectionEnd = nextSameOrHigher ? nextSameOrHigher.index : text.length;
    const body = text
      .slice(current.end, sectionEnd)
      .replace(/^#{2,6}\s+.+$/gm, '')
      .trim();
    const requiredChars = SUMMARY_TITLE_PATTERN.test(current.title) ? 20 : minBodyChars;
    if (countGeneratedChars(body) < requiredChars) {
      missing.push(current.title);
    }
  }
  return missing;
}

function hasHeadingWithoutBody(markdown: string): boolean {
  return findHeadingsWithoutBody(markdown).length > 0;
}

function normalizeHeadingKey(value: string): string {
  return String(value || '')
    .replace(/\s+/g, '')
    .replace(/[　]/g, '')
    .replace(/[!！?？:：・]/g, '')
    .toLowerCase();
}

function removeDuplicateTitleAtStart(content: string, title: string): string {
  const lines = String(content || '').split('\n');
  const normalizedTitle = normalizeHeadingKey(title);
  if (!normalizedTitle) return String(content || '').trim();

  const isTitleLikeLine = (line: string): boolean => {
    const trimmed = String(line || '').trim().replace(/^#+\s*/, '');
    if (!trimmed) return false;
    const normalizedLine = normalizeHeadingKey(trimmed);
    if (!normalizedLine) return false;
    if (normalizedLine === normalizedTitle) return true;
    return normalizedLine.length >= 8 && normalizedTitle.includes(normalizedLine);
  };

  let index = 0;
  let removed = 0;
  while (index < lines.length && removed < 8) {
    const line = String(lines[index] || '').trim();
    if (!line) {
      index += 1;
      continue;
    }
    if (!isTitleLikeLine(line)) break;
    index += 1;
    removed += 1;
  }

  if (removed === 0) return String(content || '').trim();
  while (index < lines.length && !String(lines[index] || '').trim()) {
    index += 1;
  }
  return lines.slice(index).join('\n').trim();
}

function isValidPolishedArticle(
  original: string,
  candidate: string
): boolean {
  const cleanedCandidate = String(candidate || '').trim();
  if (!cleanedCandidate) return false;
  if (looksLikeMetaResponse(cleanedCandidate)) return false;

  if (!hasSameH2Sequence(original, cleanedCandidate)) return false;
  if (hasHeadingWithoutBody(cleanedCandidate)) return false;

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
    if (title.includes('方法') || title.includes('手順') || title.includes('やり方')) {
      return ['基本的な手順', '実践時の注意点'];
    }
    if (title.includes('種類') || title.includes('タイプ') || title.includes('分類')) {
      return ['主な種類と特徴', '用途に応じた選び方'];
    }
    if (title.includes('原因') || title.includes('理由') || title.includes('なぜ')) {
      return ['主な原因の整理', '根本的な対処の考え方'];
    }
    if (title.includes('管理') || title.includes('運用') || title.includes('メンテ')) {
      return ['日常管理のポイント', 'トラブルを防ぐ対策'];
    }
    // デフォルト：H2タイトルから文脈に合った見出しを生成
    return ['基本的な考え方', '実践における着眼点'];
  })();
  return pool.slice(0, Math.max(1, Math.min(count, pool.length)));
}

function isMarkdownStructuralBlock(block: string): boolean {
  return /^(```|#{1,6}\s|[-*]\s|\d+\.\s|>\s|\|)/m.test(block.trim());
}

function splitJapaneseParagraphForReadability(paragraph: string): string {
  const trimmed = String(paragraph || '').trim();
  if (!trimmed || trimmed.length < 180) return trimmed;

  const sentences = trimmed
    .replace(/([。！？])(?=\S)/g, '$1\n')
    .split('\n')
    .map((sentence) => sentence.trim())
    .filter(Boolean);

  if (sentences.length <= 2) return trimmed;

  const chunks: string[] = [];
  let current: string[] = [];
  let currentLength = 0;

  for (const sentence of sentences) {
    current.push(sentence);
    currentLength += sentence.length;

    if (current.length >= 3 || currentLength >= 220) {
      chunks.push(current.join(''));
      current = [];
      currentLength = 0;
    }
  }

  if (current.length > 0) {
    chunks.push(current.join(''));
  }

  return chunks.join('\n\n');
}

export function formatArticleBodyForReadability(content: string): string {
  const text = String(content || '')
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .trim();
  if (!text) return '';

  const blocks = text.split(/\n{2,}/);
  return blocks
    .map((block) => {
      const trimmed = block.trim();
      if (!trimmed) return '';
      if (/^#{1,6}\s/m.test(trimmed) && /\n/.test(trimmed)) {
        return trimmed
          .split('\n')
          .map((line) => {
            const current = line.trim();
            if (!current) return '';
            if (isMarkdownStructuralBlock(current)) return current;
            return splitJapaneseParagraphForReadability(current);
          })
          .filter(Boolean)
          .join('\n\n');
      }
      if (isMarkdownStructuralBlock(trimmed)) return trimmed;
      return splitJapaneseParagraphForReadability(trimmed);
    })
    .filter(Boolean)
    .join('\n\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export function insertSubheadingsIntoLongSections(markdown: string, targetWordCount?: number): string {
  if (Number.isFinite(targetWordCount) && Number(targetWordCount) <= 1200) {
    return String(markdown || '').trim();
  }

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
  maxTokens: number,
  customInstructions?: string
): Promise<string> {
  const prompt = [
    '次の記事本文を、Markdown構造を保ったまま読みやすく整えてください。',
    '本文の意味や情報量は大きく変えず、重複・言い回し・段落の流れだけを調整してください。',
    '堅い報告書調や説明書調を避け、読者に話しかけるような自然な「です・ます」の本文にしてください。',
    '',
    '厳守事項:',
    '- 冒頭に記事タイトルを出力しない',
    '- H2/H3の見出し順序と階層を維持する',
    '- H2/H3見出しを削除・改名・追加しない',
    '- 導入文でタイトルを繰り返さない',
    '- 同じ説明の繰り返しを自然に減らす',
    '- 1文を長くしすぎず、長い文は自然な位置で分ける',
    '- 「〜となります」「〜と言えるでしょう」「〜させていただきます」の多用を避ける',
    '- 出力は本文Markdownのみ',
    '',
    `記事タイトル: ${outline.title}`,
    'アウトライン:',
    ...outline.sections.filter((s) => !s.isLead).map((s) => `- H${s.level}: ${s.title}`),
    '',
    '本文:',
    originalContent
  ].join('\n');

  try {
    const polishTokens = Math.max(2200, Math.ceil(originalContent.length * 1.8));
    const polished = removeDuplicateTitleAtStart((await callAI(
      appendCustomInstructions(prompt, customInstructions),
      Math.min(polishTokens, Math.max(1200, maxTokens))
    )).trim(), outline.title);
    if (!isValidPolishedArticle(originalContent, polished)) {
      return originalContent;
    }
    return formatReadableParagraphs(polished);
  } catch {
    return originalContent;
  }
}

function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  message: string
): Promise<T> {
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) return promise;

  let timeoutId: ReturnType<typeof setTimeout> | null = null;
  const timeoutPromise = new Promise<T>((_, reject) => {
    timeoutId = setTimeout(() => reject(new Error(message)), timeoutMs);
  });

  return Promise.race([promise, timeoutPromise]).finally(() => {
    if (timeoutId) clearTimeout(timeoutId);
  });
}

function shouldRunFinalStyleUnification(content: string, outline: SharedArticleOutline): boolean {
  const textLength = countGeneratedChars(content);
  const h2Count = outline.sections.filter((section) => !section.isLead && section.level === 2).length;
  return textLength >= 1500 || h2Count >= 3;
}

async function finalUnifyArticleStyle(
  originalContent: string,
  outline: SharedArticleOutline,
  callAI: SharedCallAI,
  maxTokens: number,
  customInstructions?: string
): Promise<string> {
  const prompt = [
    '記事全体を最終確認し、読みやすい本文に整えてください。',
    '構成は変えず、段落のつながり、重複表現、見出し直下の流れだけを調整してください。',
    '読者が肩の力を抜いて読めるよう、堅い名詞句や長すぎる文を自然な説明文へ置き換えてください。',
    '',
    '厳守事項:',
    '- 冒頭に記事タイトルを出力しない',
    '- H2の順序・文言・数を必ず維持する',
    '- 既存のH3は維持する',
    '- H3を新規追加しない',
    '- タイトルや導入文の重複を削る',
    '- セクション間で同じ説明を繰り返さない',
    '- 読者への相談回答として自然な「です・ます」に統一する',
    '- 専門用語の直後には、必要に応じて短い補足を入れる',
    '- 出力は本文Markdownのみ',
    '',
    `記事タイトル: ${outline.title}`,
    'H2一覧:',
    ...outline.sections.filter((section) => !section.isLead && section.level === 2).map((section) => `- ${section.title}`),
    '',
    '本文:',
    originalContent
  ].join('\n');

  try {
    const unifyTokens = Math.max(2200, Math.ceil(originalContent.length * 1.6));
    const unified = trimDanglingTailSafe(formatReadableParagraphs(removeDuplicateTitleAtStart(
      (await callAI(
        appendCustomInstructions(prompt, customInstructions),
        Math.min(unifyTokens, Math.max(1200, maxTokens))
      )).trim(),
      outline.title
    )));
    if (!isValidPolishedArticle(originalContent, unified)) {
      return originalContent;
    }
    return unified;
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
  isSection = false,
  customInstructions?: string
): Promise<string> {
  const summaryPrompt = buildSummaryPrompt({
    originalContent,
    title,
    targetWordCount,
    keywords,
    customInstructions
  });

  try {
    const summarizedText = await callAI(summaryPrompt, maxTokens);
    const cleaned = sanitizeRewriterOutput(summarizedText, originalContent, isSection);
    if (!cleaned) {
      return isSection ? truncateByParagraph(originalContent, targetWordCount) : originalContent;
    }
    if (!isSection) {
      const hasDanglingHeading = /(?:^|\n\n)#{1,6}\s+\S+\s*$/.test(cleaned);
      const minLength = Math.max(300, Math.floor(targetWordCount * 0.6));
      if (
        hasDanglingHeading ||
        countGeneratedChars(cleaned) < minLength ||
        !hasSameH2Sequence(originalContent, cleaned)
      ) {
        return originalContent;
      }
    }
    return cleaned;
  } catch {
    return isSection ? truncateByParagraph(originalContent, targetWordCount) : originalContent;
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
  isSection: boolean,
  customInstructions?: string
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
    hasSummaryAnchor: false,
    customInstructions
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

const TERMINAL_SENTENCE_END_RE = /(?:\u3002|\uff01|\uff1f|[.!?]|」|』|】)\s*$/;
const SENTENCE_BOUNDARY_RE = /[\u3002\uff01\uff1f.!?](?:\s|$)/g;
const CONTINUATION_TAIL_RE = /(?:\u3057|\u3057\u3001|\u3057\u3066|\u3057\u306a\u304c\u3089|\u3057\u305f\u304c\u3063\u3066|\u306e\u3067|\u305f\u3081|\u3068\u3044\u3048\u3070|\u306a\u3069|\u307e\u305f|\u304a\u3088\u3073|\u3068\u3044\u3046|[A-Za-z0-9]+\s*(?:and|or|because|with))\s*$/i;

function findLastSentenceBoundary(text: string): number {
  let lastIndex = -1;
  for (const match of text.matchAll(SENTENCE_BOUNDARY_RE)) {
    const index = typeof match.index === 'number' ? match.index : -1;
    if (index >= 0) lastIndex = index;
  }
  return lastIndex;
}

function trimDanglingTailSafe(content: string): string {
  const text = String(content || '').trim();
  if (!text) return '';

  const isHeadingOnly = (line: string): boolean => /^#{1,6}\s+\S/.test(line.trim());
  const blocks = text.split(/\n{2,}/).map((b) => b.trim()).filter(Boolean);
  while (blocks.length > 0 && isHeadingOnly(blocks[blocks.length - 1])) {
    blocks.pop();
  }

  const merged = blocks.join('\n\n').trim();
  if (!merged) return '';
  if (TERMINAL_SENTENCE_END_RE.test(merged)) return merged;

  const lastBoundary = findLastSentenceBoundary(merged);
  if (lastBoundary < 0) return merged;

  const trimmed = merged.slice(0, lastBoundary + 1).trim();
  if (!trimmed) return merged;
  if (merged.length < 120) return trimmed;
  if (lastBoundary < Math.floor(merged.length * 0.7)) return merged;
  return trimmed;
}

function endsWithContinuationCueSafe(content: string): boolean {
  const text = String(content || '').trim();
  if (!text) return false;
  if (TERMINAL_SENTENCE_END_RE.test(text)) return false;
  const tail = text.slice(-24);
  return CONTINUATION_TAIL_RE.test(tail);
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
  const leadInLineCount = lines.filter((line) => /^(まず|第一に|次に|第二に|さらに|第三に|最後に|第四に|一つ目|二つ目|三つ目|四つ目)/.test(line)).length;
  const ordinalMentions = text.match(/(?:一|二|三|四|五|六|七|八|九|十)つ目/g)?.length || 0;
  const numberedMentions = text.match(/(?:^|[^\d])(?:[1-9]|1[0-2])\s*(?:つ目|点目|個目|項目)/g)?.length || 0;

  return Math.max(headingCount, bulletCount, leadInLineCount, ordinalMentions, numberedMentions);
}

function hasStructuredListOrTable(content: string): boolean {
  return /(^|\n)\s*(?:[-*]\s+\S+|\d+[.)]\s+\S+|\|.+\|)/.test(String(content || ''));
}

function sectionLikelyNeedsStructuredFormat(section: SharedOutlineSection): boolean {
  const source = `${section.title || ''} ${section.description || ''}`;
  return /(比較|料金|費用|価格|相場|手順|ステップ|チェックリスト|ポイント|選び方|注意点|メリット|デメリット)/.test(source);
}

function evaluateAiCitationSectionIssues(
  content: string,
  section: SharedOutlineSection
): string[] {
  const issues: string[] = [];
  const expectedPoints = extractExpectedPointCount(section.title, section.description);
  if (expectedPoints != null) {
    const detected = countDetectedPoints(content);
    if (detected > 0 && detected < expectedPoints) {
      issues.push(`数字付き見出しの列挙数が不足しています（${detected}/${expectedPoints}）。`);
    }
  }

  if (
    sectionLikelyNeedsStructuredFormat(section) &&
    countGeneratedChars(content) >= 260 &&
    !hasStructuredListOrTable(content)
  ) {
    issues.push('比較・料金・手順・ポイントなどを扱う見出しですが、表または箇条書きで整理されていません。');
  }

  return issues;
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

  if (endsWithContinuationCueSafe(text)) {
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
  maxTokens: number,
  customInstructions?: string
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
    const raw = await callAI(appendCustomInstructions(prompt, customInstructions), maxTokens);
    const addition = sanitizeRewriterOutput(raw, content, true);
    if (!addition) return content;

    const merged = trimDanglingTailSafe(`${content}\n\n${addition}`.trim());
    return merged || content;
  } catch {
    return content;
  }
}

async function improveSectionForAiCitation(
  content: string,
  section: SharedOutlineSection,
  outlineTitle: string,
  issues: string[],
  callAI: SharedCallAI,
  maxTokens: number,
  customInstructions?: string
): Promise<string> {
  if (issues.length === 0) return content;

  const prompt = [
    '以下のセクション本文を、AI検索に引用されやすい形へ必要最小限で修正してください。',
    '全文を書き換えすぎず、指摘された点だけを直してください。',
    '',
    `記事タイトル: ${outlineTitle}`,
    `セクション見出し: ${section.title}`,
    section.description ? `セクション意図: ${section.description}` : '',
    '',
    '修正すべき点:',
    ...issues.map((issue) => `- ${issue}`),
    '',
    '出力ルール:',
    '- 修正後のセクション本文のみを出力（見出し・タイトルは出さない）',
    '- 事実関係や固有名詞を勝手に増やさない',
    '- 数字付きの見出しや表現を使う場合は、本文内の列挙数と一致させる',
    '- 比較、料金、条件、手順、ポイントは必要に応じて表または箇条書きで整理する',
    '- 元本文の主要な内容と文体を維持する',
    '',
    '元本文:',
    content,
  ].filter(Boolean).join('\n');

  try {
    const raw = await callAI(appendCustomInstructions(prompt, customInstructions), maxTokens);
    const improved = sanitizeRewriterOutput(raw, content, true);
    if (!improved) return content;

    const originalLength = countGeneratedChars(content);
    const improvedLength = countGeneratedChars(improved);
    if (improvedLength < Math.max(120, Math.floor(originalLength * 0.65))) return content;
    if (improvedLength > Math.ceil(originalLength * 1.55)) return content;

    return trimDanglingTailSafe(formatReadableParagraphs(improved));
  } catch {
    return content;
  }
}

function formatReadableParagraphs(content: string): string {
  let text = (content || '').trim();
  if (!text) return '';

  // ** (太字マーク) を除去 — 公開記事ではMarkdown強調をそのまま残さない
  text = text.replace(/\*\*(.+?)\*\*/g, '$1').replace(/\*\*/g, '');

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

function getChildH3Titles(outline: SharedArticleOutline, section: SharedOutlineSection): string[] {
  if (!outline.sections || section.isLead || section.level !== 2) return [];
  let index = outline.sections.indexOf(section);
  if (index < 0) {
    index = outline.sections.findIndex((item) => item.title === section.title && item.level === section.level);
  }
  if (index < 0) return [];

  const titles: string[] = [];
  for (let i = index + 1; i < outline.sections.length; i += 1) {
    const next = outline.sections[i];
    if (next.isLead || next.level === 2) break;
    if (next.level === 3 && next.title) {
      titles.push(next.title);
    }
  }
  return titles;
}

export function assembleArticleMarkdown(sections: SharedSectionWithContent[]): string {
  return sections.map((section) => {
    if (section.isLead) return section.content;
    const heading = section.level === 2 ? `## ${section.title}` : `### ${section.title}`;
    return `${heading}\n\n${section.content}`;
  }).join('\n\n');
}
const SUMMARY_TITLE_PATTERN = /(まとめ|結論|総括|おわりに|最後に|summary|conclusion)/i;

function repairHeadingBodiesFromGeneratedSections(
  markdown: string,
  sections: SharedSectionWithContent[]
): string {
  const text = String(markdown || '').trim();
  if (!text || findHeadingsWithoutBody(text).length === 0) return text;

  const contentByTitle = new Map<string, string>();
  for (const section of sections) {
    if (section.isLead) continue;
    const key = normalizeHeadingKey(section.title);
    const content = String(section.content || '').trim();
    if (key && countGeneratedChars(content) >= 40) {
      contentByTitle.set(key, content);
    }
  }
  if (contentByTitle.size === 0) return text;

  const headingRegex = /^#{2,3}\s+(.+)$/gm;
  const headings: Array<{ index: number; end: number; line: string; level: number; title: string }> = [];
  let match: RegExpExecArray | null = null;
  while ((match = headingRegex.exec(text)) !== null) {
    const line = match[0] || '';
    const title = String(match[1] || '').trim();
    if (!title) continue;
    headings.push({
      index: match.index,
      end: match.index + line.length,
      line,
      level: line.startsWith('###') ? 3 : 2,
      title,
    });
  }
  if (headings.length === 0) return text;

  let result = '';
  let cursor = 0;
  for (let i = 0; i < headings.length; i += 1) {
    const current = headings[i];
    const sectionEnd = i + 1 < headings.length ? headings[i + 1].index : text.length;
    const sectionRaw = text.slice(current.index, sectionEnd);
    const body = text
      .slice(current.end, sectionEnd)
      .replace(/^#{2,6}\s+.+$/gm, '')
      .trim();
    const requiredChars = SUMMARY_TITLE_PATTERN.test(current.title) ? 20 : 40;

    result += text.slice(cursor, current.index);
    if (countGeneratedChars(body) < requiredChars) {
      const replacement = contentByTitle.get(normalizeHeadingKey(current.title));
      result += replacement
        ? `${current.line}\n\n${replacement}\n\n`
        : sectionRaw;
    } else {
      result += sectionRaw;
    }
    cursor = sectionEnd;
  }
  result += text.slice(cursor);
  return result.trim();
}

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

function normalizeOutlineDescription(section: SharedOutlineSection): string {
  const raw = String(section.description || '')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[、,，・／/]+$/g, '')
    .trim();
  const title = String(section.title || '').trim();

  const fallback = (() => {
    if (section.isLead) return '記事全体の導入と読むメリットを示す';
    if (isSummaryLikeTitle(title)) return '記事全体の要点を総括する';
    if (section.level === 3) return `${title}の具体的な判断材料を整理する`;
    return `${title}の全体像と判断ポイントを整理する`;
  })();

  if (!raw) return fallback;
  if (raw.length < 6) return fallback;
  if (/(?:や|と|が|を|は|に|で|へ|も|から|まで|による|に応じた|に合わせた|を踏まえた|するための|した|しやすい)$/.test(raw)) {
    return fallback;
  }
  return raw;
}

function normalizeOutlineSections(
  sections: SharedOutlineSection[],
  targetWordCount: number
): SharedOutlineSection[] {
  const normalized = sections.map((section) => ({
    ...section,
    description: normalizeOutlineDescription(section),
  }));

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
  if (targetWordCount > 1200) return sections;
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

function isWeakH3Title(title: string): boolean {
  const t = String(title || '').trim();
  if (!t) return true;
  const normalized = canonicalizeHeading(t);
  if (normalized.length <= 2) return true;
  return /^(物流|効率|品質|安全|費用|コスト|方法|対策|課題|効果|種類|比較|選び方|注意点|ポイント|メリット|デメリット|概要|基本|導入)$/.test(normalized);
}

function getTargetH3Count(targetWordCount: number): number {
  if (!Number.isFinite(targetWordCount) || targetWordCount < 1800) return 0;
  if (targetWordCount < 2600) return 9;
  if (targetWordCount < 3600) return 12;
  return 15;
}

function getHardMinimumH3Count(targetWordCount: number): number {
  const targetH3Count = getTargetH3Count(targetWordCount);
  if (targetH3Count <= 0) return 0;
  return Math.min(targetH3Count, 1);
}

function countH3Sections(sections: SharedOutlineSection[]): number {
  return sections.filter((section) => !section.isLead && section.level === 3).length;
}

function findParentH2Index(sections: SharedOutlineSection[], childIndex: number): number {
  for (let i = childIndex - 1; i >= 0; i -= 1) {
    const section = sections[i];
    if (!section.isLead && section.level === 2 && !isSummaryLikeTitle(section.title)) {
      return i;
    }
  }
  return -1;
}

function countChildH3(sections: SharedOutlineSection[], h2Index: number): number {
  let count = 0;
  for (let i = h2Index + 1; i < sections.length; i += 1) {
    const section = sections[i];
    if (section.isLead || section.level === 2) break;
    if (section.level === 3) count += 1;
  }
  return count;
}

function shouldSplitH2IntoH3(section: SharedOutlineSection): boolean {
  const title = String(section.title || '');
  const description = String(section.description || '');
  const combined = `${title} ${description}`;
  if (section.estimatedWordCount >= 420) return true;
  if (/[・、／/]|(?:と|や|から|まで).*(?:と|や|まで)/.test(title)) return true;
  return /(原因|理由|リスク|選択肢|比較|選び方|判断基準|注意点|ポイント|手順|方法|対策|導入効果|費用|安全)/.test(combined);
}

function selectH2IndexesForH3Supplement(
  sections: SharedOutlineSection[],
  targetWordCount: number,
  targetH3Count: number
): number[] {
  if (targetH3Count <= 0) return [];
  const currentH3Count = countH3Sections(sections);
  const missing = Math.max(0, targetH3Count - currentH3Count);
  if (missing === 0) return [];

  const candidates = sections
    .map((section, index) => ({ section, index }))
    .filter(({ section, index }) => (
      !section.isLead &&
      section.level === 2 &&
      !isSummaryLikeTitle(section.title) &&
      countChildH3(sections, index) < 3
    ))
    .map(({ section, index }) => ({
      index,
      score:
        (shouldSplitH2IntoH3(section) ? 100 : 0) +
        Math.max(0, section.estimatedWordCount - 260) +
        (targetWordCount >= 1800 ? 20 : 0) -
        countChildH3(sections, index) * 40,
    }))
    .sort((a, b) => b.score - a.score);

  const selected: number[] = [];
  for (const candidate of candidates) {
    if (selected.length >= Math.max(1, missing)) break;
    const section = sections[candidate.index];
    if (!section) continue;
    const currentChildren = countChildH3(sections, candidate.index);
    const plannedChildren = selected.filter((index) => index === candidate.index).length;
    const capacity = Math.max(0, 3 - currentChildren - plannedChildren);
    const desired = shouldSplitH2IntoH3(section) ? 3 : 2;
    const addCount = Math.min(capacity, desired, missing - selected.length);
    for (let i = 0; i < addCount; i += 1) {
      selected.push(candidate.index);
    }
  }
  return selected.slice(0, missing);
}

function ensureOutlineDescriptions(sections: SharedOutlineSection[]): SharedOutlineSection[] {
  return sections.map((section) => {
    if (section.description && section.description.trim()) return section;
    if (section.isLead) {
      return { ...section, description: '記事全体の導入と読むメリットを示す' };
    }
    if (isSummaryLikeTitle(section.title)) {
      return { ...section, description: '記事全体の要点を総括' };
    }
    if (section.level === 2) {
      return { ...section, description: 'この章の全体像と判断ポイントを整理する' };
    }
    return { ...section, description: '具体的な論点を掘り下げる' };
  });
}

function rebalanceParentAndChildH3WordCounts(
  sections: SharedOutlineSection[],
  targetWordCount: number
): SharedOutlineSection[] {
  if (!Array.isArray(sections) || sections.length === 0) return sections;
  const adjusted = sections.map((section) => ({ ...section }));
  const parentToChildren = new Map<number, number[]>();

  for (let i = 0; i < adjusted.length; i += 1) {
    if (adjusted[i].level !== 3) continue;
    const parentIndex = findParentH2Index(adjusted, i);
    if (parentIndex < 0) continue;
    const list = parentToChildren.get(parentIndex) || [];
    list.push(i);
    parentToChildren.set(parentIndex, list);
  }

  for (const [parentIndex, childIndexes] of parentToChildren.entries()) {
    const parent = adjusted[parentIndex];
    if (!parent || childIndexes.length === 0) continue;
    const total = parent.estimatedWordCount + childIndexes.reduce((sum, index) => sum + adjusted[index].estimatedWordCount, 0);
    const parentTarget = clampNumber(
      Math.round(total * 0.28),
      120,
      targetWordCount >= 2200 ? 220 : 190
    );
    const childTotal = Math.max(childIndexes.length * 120, total - parentTarget);
    const perChild = Math.max(120, Math.round(childTotal / childIndexes.length));
    parent.estimatedWordCount = parentTarget;
    for (const childIndex of childIndexes) {
      adjusted[childIndex].estimatedWordCount = perChild;
    }
  }

  return adjusted;
}

function isCountermeasureTopic(keyword: string, fixedTitle?: string | null): boolean {
  const text = `${keyword || ''} ${fixedTitle || ''}`;
  return /(対策|改善|解決|防ぐ|抑制|備える|換気|遮熱|断熱|冷却|暑さ|温度|リスク|方法)/i.test(text);
}

function inferSubjectTerm(keyword: string, fixedTitle?: string | null): string {
  const text = `${fixedTitle || ''} ${keyword || ''}`;
  const subjectMatch = text.match(/[A-Za-z0-9ぁ-んァ-ン一-龠]{2,12}(?:倉庫|工場|店舗|施設|設備|機械|システム|サービス|ツール|会社|業者)/);
  if (subjectMatch) return subjectMatch[0].trim();

  return String(keyword || '')
    .split(/[、,｜|/／\s]+/)
    .map((item) => item.trim())
    .find((item) => item.length >= 2 && item.length <= 12) || '';
}

function isWeakOutlineTitle(title: string): boolean {
  const t = String(title || '').trim();
  if (!t) return true;
  if (isSummaryLikeTitle(t)) return false;
  if (t.length <= 7) return true;
  return /(?:とは[？?]?|活用方法|種類と特徴|選び方と注意点|よくある疑問|重要ポイント|基礎知識|基礎)$/i.test(t);
}

function scoreOutlineSections(
  sections: SharedOutlineSection[],
  keyword: string,
  fixedTitle?: string | null
): number {
  if (!Array.isArray(sections) || sections.length === 0) return Number.NEGATIVE_INFINITY;

  const nonLead = sections.filter((section) => !section.isLead && !isSummaryLikeTitle(section.title));
  let score = sections.length * 10;

  for (const section of nonLead) {
    const title = String(section.title || '').trim();
    const description = String(section.description || '').trim();
    if (title.length >= 12) score += 3;
    if (description.length >= 18) score += 2;
    if (/(理由|原因|メカニズム|確認|優先|組み合わせ|併用|費用|施工|安全|注意|判断|比較|選び方|手順|失敗|リスク|導入前)/.test(title)) {
      score += 5;
    }
    if (/(換気|遮熱|断熱|冷却|排出|抑える|防ぐ|守る|改善|導入|施工)/.test(title)) {
      score += 3;
    }
    if (isWeakOutlineTitle(title)) score -= 18;
  }

  const allTitles = nonLead.map((section) => section.title).join(' / ');
  const subjectTerm = inferSubjectTerm(keyword, fixedTitle);
  if (subjectTerm) {
    const repeatedSubjectCount = nonLead.filter((section) => String(section.title || '').includes(subjectTerm)).length;
    if (repeatedSubjectCount > 2) {
      score -= (repeatedSubjectCount - 2) * 12;
    }
  }

  if (isCountermeasureTopic(keyword, fixedTitle)) {
    const checks = [
      /(理由|原因|メカニズム)/,
      /(まず|確認|優先|判断)/,
      /(組み合わせ|併用|使い分け)/,
      /(費用|施工|安全|導入前|注意)/,
    ];
    for (const pattern of checks) {
      score += pattern.test(allTitles) ? 10 : -10;
    }
  }

  return score;
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

  // 記事テーマに合った汎用的なまとめ文を生成（特定ジャンルに依存しない）
  const closingLine = h2Titles.length > 0
    ? `${h2Titles[0]}をはじめとする各ポイントを踏まえ、目的や条件に合った選択・対応を行うことが重要です。`
    : '各ポイントを総合的に確認し、目的や条件に合った選択・対応を行うことが重要です。';

  return [
    '## まとめ',
    '',
    focusLine,
    '',
    closingLine
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
      title: '選定前に押さえておきたい注意点',
      description: '失敗を避けるためのポイントを明確にする',
    },
    {
      title: '運用・管理における実践ポイント',
      description: '継続的に活用するための実践策を提示する',
    },
  ];

  // 関連キーワードからセクション候補を生成（タイトルを自然な形に）
  const supplementTemplates = [
    (k: string) => ({ title: `${k}の選び方と注意点`, description: `${k}に関する選定基準と落とし穴を整理する` }),
    (k: string) => ({ title: `${k}の種類と特徴`, description: `${k}の分類と各特性を整理する` }),
    (k: string) => ({ title: `${k}の活用方法`, description: `${k}を効果的に使うための具体的な方法を説明する` }),
    (k: string) => ({ title: `${k}に関するよくある疑問`, description: `${k}についての疑問と回答を整理する` }),
    (k: string) => ({ title: `${k}の管理と最適化`, description: `${k}のパフォーマンスを維持・向上させる方法を解説する` }),
    (k: string) => ({ title: `${k}を選ぶ際のポイント`, description: `${k}の効果的な選定基準を説明する` }),
  ];

  const related = (relatedKeywords || [])
    .map((k) => String(k || '').trim())
    .filter((k) => k.length > 0)
    .slice(0, 6)
    .map((k, index) => {
      const templateFn = supplementTemplates[index % supplementTemplates.length];
      return templateFn(k);
    });

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
      console.debug(`[outline supplement debug] attempt${attempt + 1} response (first 800 chars):`, response.slice(0, 800));

      let parsed = parseLooseH2Lines(response, perSection);
      if (parsed.length === 0) {
        parsed = parseOutlineSectionsFromJson(response, perSection).sections
          .filter((section) => !section.isLead)
          .map((section) => ({ ...section, isLead: false, level: 2 }));
      }
      if (parsed.length === 0) {
        parsed = parseOutlineSections(response, perSection, false)
          .filter((section) => !section.isLead)
          .map((section) => ({ ...section, isLead: false, level: 2 }));
      }
      console.debug(
        `[outline supplement debug] attempt${attempt + 1} parsed=${parsed.length} missing=${missing} extracted=${extracted.length}`
      );

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
    } catch (err) {
      throw err;
    }
  }

  if (extracted.length === 0) {
    throw new Error('AIによるセクション補充に失敗しました。アウトラインを再生成してください。');
  }

  const combined = normalizeOutlineSections(
    [lead, ...middle, ...extracted, summary],
    targetWordCount
  );

  return { sections: combined, added: extracted.length, usedAI: true };
}

async function supplementH3SectionsWithAI(
  sections: SharedOutlineSection[],
  keyword: string,
  targetWordCount: number,
  targetH3Count: number,
  callAI: SharedCallAI
): Promise<{ sections: SharedOutlineSection[]; added: number }> {
  const normalized = normalizeOutlineSections(sections, targetWordCount);
  const currentH3Count = countH3Sections(normalized);
  if (targetH3Count <= 0 || currentH3Count >= targetH3Count) {
    return { sections: normalized, added: 0 };
  }

  const targetH2Indexes = selectH2IndexesForH3Supplement(normalized, targetWordCount, targetH3Count);
  if (targetH2Indexes.length === 0) {
    return { sections: normalized, added: 0 };
  }

  const missing = targetH3Count - currentH3Count;
  const perH3 = Math.max(140, Math.floor(Math.max(1200, targetWordCount) / Math.max(6, normalized.length + missing)));
  const targetCounts = targetH2Indexes.reduce((map, index) => {
    map.set(index, (map.get(index) || 0) + 1);
    return map;
  }, new Map<number, number>());
  const targetPlans = Array.from(targetCounts.entries())
    .map(([index, needed]) => ({ index, needed, section: normalized[index] }))
    .filter((plan) => plan.section);
  const prompt = [
    `キーワード「${keyword}」の記事アウトラインに小見出し（H3）が不足しています。`,
    `目標はH3合計${targetH3Count}個です。現在${currentH3Count}個なので、H3を合計${missing}個追加してください。`,
    'H3は必ず指定したH2の直下に入る小見出しとして作ってください。',
    '追加対象ごとのNeededH3の数を必ず守ってください。',
    '1つの主要H2につきH3が合計3個になるように追加してください。',
    '同じParentH2にH3を3個まで追加して構いません。',
    'H2と同じ内容の言い換えではなく、本文を分割しやすい具体的な論点にしてください。',
    '「物流」「安全」「品質」「効率」のような単語だけのH3は禁止です。必ず何を論じるか分かる具体的な見出しにしてください。',
    'Descriptionは短い名詞句または短文として完結させ、読点「、」や「や」「と」「した」で終えないでください。',
    'まとめ・導入のH3は作らないでください。',
    '',
    '追加対象のH2と必要数:',
    ...targetPlans.map(({ section, needed }) => {
      return [
        `- ParentH2: ${section.title}`,
        `  NeededH3: ${needed}`,
        `  Description: ${section.description || ''}`,
      ].join('\n');
    }),
    '',
    '既存アウトライン:',
    ...normalized.map((section) => {
      if (section.isLead) return `Lead: ${section.title}`;
      return `${section.level === 3 ? 'H3' : 'H2'}: ${section.title}`;
    }),
    '',
    '出力形式（この形式のみ）:',
    'ParentH2: [追加対象H2の見出し]',
    'H3: [小見出し]',
    'Description: [扱う内容の要点（30字以内・途中で切らず完結）]',
    `Estimated: ${perH3}`,
  ].join('\n');

  const response = await callAI(prompt, 1200);
  console.debug('[outline h3 supplement debug] response (first 800 chars):', response.slice(0, 800));

  const lines = String(response || '').split('\n').map((line) => line.trim()).filter(Boolean);
  const byParent = new Map<string, SharedOutlineSection[]>();
  const orphanItems: SharedOutlineSection[] = [];
  let currentParent = '';
  let pending: SharedOutlineSection | null = null;
  const flush = () => {
    if (!pending) return;
    if (!currentParent) {
      orphanItems.push(pending);
      pending = null;
      return;
    }
    const list = byParent.get(currentParent) || [];
    list.push(pending);
    byParent.set(currentParent, list);
    pending = null;
  };

  for (const line of lines) {
    const parentMatch = line.match(/^ParentH2\s*[:：]\s*(.+)$/i);
    if (parentMatch?.[1]) {
      flush();
      currentParent = canonicalizeHeading(parentMatch[1]);
      continue;
    }
    const h3Match = line.match(/^H3\s*[:：]\s*(.+)$/i);
    if (h3Match?.[1]) {
      flush();
      pending = {
        title: h3Match[1].trim(),
        level: 3,
        description: '',
        isLead: false,
        estimatedWordCount: perH3,
      };
      continue;
    }
    const descMatch = line.match(/^(?:Description|説明|概要)\s*[:：]\s*(.+)$/i);
    if (descMatch?.[1] && pending) {
      pending.description = descMatch[1].trim();
      continue;
    }
    const estimatedMatch = line.match(/^(?:Estimated|推定|目安)\s*[:：]?\s*(\d+)/i);
    if (estimatedMatch?.[1] && pending) {
      const estimated = Number.parseInt(estimatedMatch[1], 10);
      if (Number.isFinite(estimated) && estimated > 0) {
        pending.estimatedWordCount = estimated;
      }
    }
  }
  flush();

  const existing = new Set(normalized.map((section) => canonicalizeHeading(section.title)));
  const rebuilt: SharedOutlineSection[] = [];
  let added = 0;
  const maxAdd = missing;
  const usedParentKeys = new Set<string>();
  const looseItemsForParent = (parentKey: string): SharedOutlineSection[] => {
    const exact = byParent.get(parentKey);
    if (exact && exact.length > 0) {
      usedParentKeys.add(parentKey);
      return exact;
    }
    for (const [candidateKey, items] of byParent.entries()) {
      if (usedParentKeys.has(candidateKey)) continue;
      if (parentKey.includes(candidateKey) || candidateKey.includes(parentKey)) {
        usedParentKeys.add(candidateKey);
        return items;
      }
    }
    return [];
  };

  for (let i = 0; i < normalized.length; i += 1) {
    const section = normalized[i];
    rebuilt.push(section);
    if (added >= maxAdd || section.isLead || section.level !== 2 || isSummaryLikeTitle(section.title)) {
      continue;
    }
    const parentKey = canonicalizeHeading(section.title);
    const items = looseItemsForParent(parentKey);
    for (const item of items) {
      if (added >= maxAdd) break;
      const key = canonicalizeHeading(item.title);
      if (!key || existing.has(key) || isSummaryLikeTitle(item.title) || isWeakH3Title(item.title)) continue;
      existing.add(key);
      rebuilt.push({
        ...item,
        description: item.description || '具体的な判断材料を整理する',
      });
      added += 1;
    }
  }

  if (added < maxAdd) {
    const leftovers = [
      ...orphanItems,
      ...Array.from(byParent.entries())
        .filter(([key]) => !usedParentKeys.has(key))
        .flatMap(([, items]) => items),
    ];
    const targetSet = new Set(targetH2Indexes);
    const inserted: SharedOutlineSection[] = [];
    for (let i = 0; i < rebuilt.length; i += 1) {
      inserted.push(rebuilt[i]);
      const originalIndex = normalized.findIndex((section) => (
        section.title === rebuilt[i].title &&
        section.level === rebuilt[i].level &&
        section.isLead === rebuilt[i].isLead
      ));
      if (added >= maxAdd || !targetSet.has(originalIndex)) continue;
      while (leftovers.length > 0 && added < maxAdd) {
        const item = leftovers.shift();
        if (!item) break;
        const key = canonicalizeHeading(item.title);
        if (!key || existing.has(key) || isSummaryLikeTitle(item.title) || isWeakH3Title(item.title)) continue;
        existing.add(key);
        inserted.push({
          ...item,
          description: item.description || '具体的な判断材料を整理する',
        });
        added += 1;
        break;
      }
    }
    rebuilt.splice(0, rebuilt.length, ...inserted);
  }

  console.debug('[outline h3 supplement debug]', {
    targetH3Count,
    currentH3Count,
    added,
    targetH2: targetPlans.map(({ section, needed }) => ({ title: section.title, needed })),
  });

  return {
    sections: normalizeOutlineSections(rebuilt, targetWordCount),
    added,
  };
}

async function normalizeLengthWithQualityGate(
  content: string,
  title: string,
  targetWordCount: number,
  keywords: string[],
  callAI: SharedCallAI,
  maxTokens: number,
  retryCount: number,
  customInstructions?: string,
  tolerance = DEFAULT_WORD_COUNT_TOLERANCE
): Promise<string> {
  const { minAllowed, maxAllowed } = getWordCountBounds(targetWordCount, tolerance);
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
        false,
        customInstructions
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
        false,
        customInstructions
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
    sectionLevel: section.level,
    childHeadings: getChildH3Titles(outline, section),
    previousContent,
    keywords: params.keywords.length > 0 ? params.keywords : [outline.title],
    tone: params.tone,
    targetChars: section.estimatedWordCount,
    isLead: section.isLead,
    customInstructions: params.customInstructions
  });

  // セクションの推定文字数に応じて十分な maxTokens を確保（日本語 1 文字 ≈ 1.5〜2 トークン + 余裕）
  const sectionMaxTokens = Math.max(
    1500,
    params.maxTokens,
    Math.ceil(section.estimatedWordCount * 2.5)
  );
  let content = stripHeading(await params.callAI(prompt, sectionMaxTokens));
  const { minAllowed, maxAllowed } = getWordCountBounds(section.estimatedWordCount, DEFAULT_WORD_COUNT_TOLERANCE);
  let citationRepairAttempted = false;

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
        true,
        params.customInstructions
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
        true,
        params.customInstructions
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
        params.maxTokens,
        params.customInstructions
      );
      continue;
    }

    const citationIssues = evaluateAiCitationSectionIssues(content, section);
    if (!citationRepairAttempted && citationIssues.length > 0) {
      citationRepairAttempted = true;
      content = await improveSectionForAiCitation(
        content,
        section,
        outline.title,
        citationIssues,
        params.callAI,
        params.maxTokens,
        params.customInstructions
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

  const normalized = trimDanglingTailSafe(formatReadableParagraphs(content));
  if (section.isLead) {
    return trimDanglingTailSafe(stripLeadingTitleLine(normalized, outline.title));
  }
  return trimDanglingTailSafe(normalized);
}

export async function generateOutlineWithSharedCore(
  params: GenerateOutlineWithSharedCoreParams
): Promise<SharedArticleOutline> {
  const basePrompt = buildSchedulerOutlinePrompt({
    keyword: params.keyword,
    targetWordCount: params.targetWordCount,
    fixedTitle: params.fixedTitle,
    customInstructions: params.customInstructions,
    competitorHeadings: params.competitorHeadings || [],
    competitorArticles: params.competitorArticles,
    relatedKeywords: params.relatedKeywords || [],
    searchConsoleQueries: params.searchConsoleQueries || [],
    articleStructureType: params.articleStructureType
  });

  const maxAttempts = 4;
  const minimumSectionCount = params.targetWordCount <= 1200
    ? 5
    : params.targetWordCount <= 2500
      ? 5
      : params.targetWordCount <= 3500
        ? 6
        : 7;
  const minimumNonLeadCount = Math.max(3, minimumSectionCount - 1);
  const targetH3Count = getTargetH3Count(params.targetWordCount);
  const hardMinimumH3Count = getHardMinimumH3Count(params.targetWordCount);
  let resolvedTitle = params.fixedTitle || `${params.keyword} について`;
  let bestSections: SharedOutlineSection[] = [];
  let bestScore = Number.NEGATIVE_INFINITY;
  const attemptDiagnostics: string[] = [];

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const retryInstruction = attempt === 0
      ? ''
      : [
        '【再生成指示】',
        '- 出力形式を厳守し、Section(Lead/H2/H3) の形で返してください。',
        '- 導入とまとめ以外の見出しを最低3つ作成してください。',
        targetH3Count > 0
          ? `- 主要H2ごとにH3を3個置いてください。記事全体のH3目標は${targetH3Count}個です。H3は直前のH2の具体論にしてください。`
          : '',
        '- 見出しはキーワード連呼を避け、自然な日本語で具体化してください。',
        '- 「夏の活用方法」「種類と特徴」「選び方と注意点」「よくある疑問」のような浅い見出しを避けてください。',
        '- 対策記事では、原因、優先順位、組み合わせ方、費用・施工・安全面の注意点を入れてください。',
        params.relatedKeywords && params.relatedKeywords.length > 0
          ? `- 関連語はそのまま見出しにせず、主題に沿って整理: ${params.relatedKeywords.slice(0, 6).join('、')}`
          : '',
        attempt >= 2
          ? '- 形式を守れない場合はJSONのみで返してください: {"title":"...","sections":[{"level":"lead|h2|h3","title":"...","description":"...","estimatedWordCount":300}]}'
          : '',
      ].filter(Boolean).join('\n');

    const prompt = retryInstruction ? `${basePrompt}\n\n${retryInstruction}` : basePrompt;
    let text: string;
    try {
      text = await params.callAI(prompt, 4000);
    } catch (callError: any) {
      // If the AI truncated its output, try to use the partial text for parsing.
      if (callError?.partialText && typeof callError.partialText === 'string' && callError.partialText.length > 100) {
        console.warn(`[outline] callAI truncated on attempt ${attempt + 1}, trying partial text (${callError.partialText.length} chars)`);
        text = callError.partialText;
      } else {
        attemptDiagnostics.push(`attempt${attempt + 1}: callAI error - ${String(callError?.message || callError)}`);
        continue;
      }
    }
    console.debug(`[outline debug] attempt${attempt + 1} response (first 800 chars):`, text.slice(0, 800));
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
    const qualityScore = scoreOutlineSections(normalized, params.keyword, params.fixedTitle);
    const h3Count = countH3Sections(normalized);
    attemptDiagnostics.push(`attempt${attempt + 1}: parsed=${parsedSections.length}, normalized=${normalized.length}, h3=${h3Count}, score=${qualityScore}`);

    if (
      qualityScore > bestScore ||
      (qualityScore === bestScore && normalized.length > bestSections.length)
    ) {
      bestSections = normalized;
      bestScore = qualityScore;
    }
    const nonLeadCount = normalized.filter((section) => !section.isLead).length;
    const minimumQualityScore = isCountermeasureTopic(params.keyword, params.fixedTitle) ? 70 : 45;
    if (
      normalized.length >= minimumSectionCount &&
      nonLeadCount >= minimumNonLeadCount &&
      h3Count >= targetH3Count &&
      qualityScore >= minimumQualityScore
    ) {
      bestSections = normalized;
      bestScore = qualityScore;
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
        targetH3Count > 0
          ? `Section (H3)も目標${targetH3Count}個入れること。主要H2ごとにH3を3個置き、H3は関連するH2の直後に置くこと。`
          : '',
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
    try {
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
      }
      attemptDiagnostics.push(
        `supplemented:${supplementedResult.usedAI ? 'ai' : 'rule'} added=${supplementedResult.added} normalized=${bestSections.length}`
      );
    } catch (error) {
      attemptDiagnostics.push(`supplement:error=${error instanceof Error ? error.message : String(error)}`);
    }
  }

  if (countH3Sections(bestSections) < targetH3Count && bestSections.length >= minimumSectionCount) {
    for (let h3Attempt = 0; h3Attempt < 4 && countH3Sections(bestSections) < targetH3Count; h3Attempt += 1) {
      try {
      const h3Supplement = await supplementH3SectionsWithAI(
        bestSections,
        params.keyword,
        params.targetWordCount,
        targetH3Count,
        params.callAI
      );
      if (h3Supplement.sections.length > bestSections.length) {
        bestSections = h3Supplement.sections;
      }
      attemptDiagnostics.push(`h3Supplement: added=${h3Supplement.added} h3=${countH3Sections(bestSections)} normalized=${bestSections.length}`);
        if (h3Supplement.added === 0) break;
      } catch (error) {
        attemptDiagnostics.push(`h3Supplement:error=${error instanceof Error ? error.message : String(error)}`);
        break;
      }
    }
  }

  if (bestSections.length < minimumSectionCount) {
    throw new Error(`アウトラインの生成に失敗しました。AIの応答が正しく解析できませんでした（diagnostics: ${attemptDiagnostics.join(' | ')}）`);
  }
  if (countH3Sections(bestSections) < hardMinimumH3Count) {
    const h3Count = countH3Sections(bestSections);
    attemptDiagnostics.push(`h3SoftFallback: h3=${h3Count} hardMinimum=${hardMinimumH3Count}`);
    console.warn(
      `Outline H3 count is below preferred minimum, but generation will continue. ` +
      `h3=${h3Count}, hardMinimum=${hardMinimumH3Count}, diagnostics=${attemptDiagnostics.join(' | ')}`
    );
  }

  const sectionsWithDescriptions = ensureOutlineDescriptions(bestSections);
  const sectionsWithBalancedH3 = rebalanceParentAndChildH3WordCounts(sectionsWithDescriptions, params.targetWordCount);
  const rebalancedSections = rebalanceEstimatedWordCounts(sectionsWithBalancedH3, params.targetWordCount);
  const normalizedLevels = flattenHeadingLevelsForMediumLength(rebalancedSections, params.targetWordCount);
  return { title: resolvedTitle, sections: normalizedLevels };
}

export async function generateArticleFromOutlineWithSharedCore(
  params: GenerateArticleWithSharedCoreParams
): Promise<SharedGenerationResult> {
  const tone = normalizeTone(params.tone);
  const maxTokens = Math.max(2000, params.defaultMaxTokens || 4000);
  const qualityRetryCount = params.qualityRetryCount ?? 1;
  const sectionsWithContent: SharedSectionWithContent[] = [];

  let accumulatedContent = '';
  for (const [index, section] of params.outline.sections.entries()) {
    if (params.onSectionStart) {
      await params.onSectionStart({
        index,
        total: params.outline.sections.length,
        section,
      });
    }

    const contentPromise = generateSectionWithQualityGate(section, params.outline, accumulatedContent, {
      keywords: params.keywords,
      tone,
      customInstructions: params.customInstructions,
      callAI: params.callAI,
      maxTokens,
      qualityRetryCount
    });
    const content = await withTimeout(
      contentPromise,
      params.sectionTimeoutMs || 0,
      `Section generation timed out: ${section.title}`
    );

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
      qualityRetryCount,
      params.customInstructions
    );
  }

  if (params.finalPolish !== false) {
    fullContent = await polishArticleFormatting(
      fullContent,
      params.outline,
      params.callAI,
      maxTokens,
      params.customInstructions
    );
  }

  if (shouldRunFinalStyleUnification(fullContent, params.outline)) {
    fullContent = await finalUnifyArticleStyle(
      fullContent,
      params.outline,
      params.callAI,
      maxTokens,
      params.customInstructions
    );
  }

  fullContent = removeDuplicateTitleAtStart(fullContent, params.outline.title);
  fullContent = insertSubheadingsIntoLongSections(fullContent, params.targetWordCount);
  fullContent = trimDanglingTailSafe(formatArticleBodyForReadability(formatReadableParagraphs(fullContent)));
  // まとめセクション保険は最後に一度だけ実行
  fullContent = ensureSummarySection(fullContent, params.outline);
  if (params.targetWordCount && params.targetWordCount > 0) {
    fullContent = await normalizeLengthWithQualityGate(
      fullContent,
      params.outline.title,
      params.targetWordCount,
      params.keywords,
      params.callAI,
      maxTokens,
      1,
      params.customInstructions,
      FINAL_ARTICLE_WORD_COUNT_TOLERANCE
    );
    fullContent = trimDanglingTailSafe(formatArticleBodyForReadability(formatReadableParagraphs(fullContent)));
  }
  fullContent = repairHeadingBodiesFromGeneratedSections(fullContent, sectionsWithContent);
  if (hasHeadingWithoutBody(fullContent)) {
    const restored = trimDanglingTailSafe(formatArticleBodyForReadability(formatReadableParagraphs(ensureSummarySection(
      assembleArticleMarkdown(sectionsWithContent),
      params.outline
    ))));
    if (!hasHeadingWithoutBody(restored)) {
      fullContent = restored;
    }
  }
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
