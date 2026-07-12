// 生成テキストの整形・見出し正規化・WordPress 用フォーマット（純粋関数群）
import { countGeneratedChars } from '../../../src/shared/articleGenerationCore.ts';
import { trimForLog } from './_shared.ts';

export function splitLongParagraphForReadability(text: string): string[] {
  const normalized = String(text || '').replace(/\s+/g, ' ').trim();
  if (!normalized) return [];

  const sentences = normalized
    .split(/(?<=[邵ｲ繧托ｽｼ繝ｻ・ｼ繝ｻ?])\s*/g)
    .map((s) => s.trim())
    .filter(Boolean);

  if (sentences.length <= 2) return [normalized];

  const chunks: string[] = [];
  let buffer: string[] = [];
  let charCount = 0;

  for (const sentence of sentences) {
    buffer.push(sentence);
    charCount += sentence.length;

    if (buffer.length >= 2 || charCount >= 140) {
      chunks.push(buffer.join(''));
      buffer = [];
      charCount = 0;
    }
  }

  if (buffer.length > 0) {
    chunks.push(buffer.join(''));
  }

  return chunks.length > 0 ? chunks : [normalized];
}


export function renderBufferedBlock(lines: string[]): string[] {
  const cleaned = (lines || [])
    .map((line) => String(line || '').trim())
    .filter((line) => line.length > 0);
  if (cleaned.length === 0) return [];

  const isUnorderedList = cleaned.every((line) => /^[-*+]\s+/.test(line));
  if (isUnorderedList) {
    const items = cleaned
      .map((line) => line.replace(/^[-*+]\s+/, '').trim())
      .filter(Boolean)
      .map((item) => `<li>${item}</li>`)
      .join('\n');
    return [`<ul>\n${items}\n</ul>`];
  }

  const isOrderedList = cleaned.every((line) => /^\d+[.)]\s+/.test(line));
  if (isOrderedList) {
    const items = cleaned
      .map((line) => line.replace(/^\d+[.)]\s+/, '').trim())
      .filter(Boolean)
      .map((item) => `<li>${item}</li>`)
      .join('\n');
    return [`<ol>\n${items}\n</ol>`];
  }

  const merged = cleaned.join(' ').replace(/\s+/g, ' ').trim();
  return splitLongParagraphForReadability(merged).map((paragraph) => `<p>${paragraph}</p>`);
}


export function wrapPlainTextBlocksWithParagraphs(text: string): string {
  const lines = String(text || '')
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .split('\n');

  const output: string[] = [];
  let buffer: string[] = [];

  const flushBuffer = () => {
    const rendered = renderBufferedBlock(buffer);
    if (rendered.length > 0) {
      output.push(...rendered);
    }
    buffer = [];
  };

  for (const rawLine of lines) {
    const line = String(rawLine || '').trim();
    if (!line) {
      flushBuffer();
      continue;
    }

    if (/^<h[1-6][^>]*>[\s\S]*<\/h[1-6]>$/i.test(line)) {
      flushBuffer();
      output.push(line);
      continue;
    }

    if (/^<(ul|ol|li|p|blockquote|pre|table)\b/i.test(line)) {
      flushBuffer();
      output.push(line);
      continue;
    }

    buffer.push(line);
  }

  flushBuffer();
  return output.join('\n\n').replace(/\n{3,}/g, '\n\n').trim();
}


export function formatContentForWordPress(rawContent: string): string {
  let text = String(rawContent ?? '');

  // Markdown headings -> HTML headings (陝ｶ・ｸ邵ｺ・ｫ陞溽判驪､)
  text = text
    .replace(/^\s*######\s+(.+)$/gm, '<h6>$1</h6>')
    .replace(/^\s*#####\s+(.+)$/gm, '<h5>$1</h5>')
    .replace(/^\s*####\s+(.+)$/gm, '<h4>$1</h4>')
    .replace(/^\s*###\s+(.+)$/gm, '<h3>$1</h3>')
    .replace(/^\s*##\s+(.+)$/gm, '<h2>$1</h2>')
    .replace(/^\s*#\s+(.+)$/gm, '<h1>$1</h1>');

  // Markdown emphasis -> HTML繝ｻ驛・ｽｦ蜿･繝ｻ邵ｺ諤懶ｽ､逕ｻ驪､陟募ｾ後堤ｹｧ繧会ｽ｢・ｺ陞ｳ貅倪・陞ｳ貅ｯ・｡魃会ｽｼ繝ｻ
  text = text
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>');

  // 陞溽判驪､雋堺ｸ奇ｽ檎ｸｺ・ｮ陝・ｽ､驕ｶ荵晢ｼ邵ｺ繝ｻ** 郢ｧ蟶晏求陷ｴ・ｻ
  text = text.replace(/\*\*/g, '');

  // 隴幢ｽｬ隴√・・定ｰｿ・ｵ髣懶ｽｽ陋ｹ謔ｶ・邵ｺ・ｦ邵ｲ竏ｬ・ｩ・ｰ邵ｺ・ｾ邵ｺ・｣邵ｺ・ｦ髫穂ｹ昶斡郢ｧ蜿･謦ｫ鬯伜ｾ鯉ｽ帝ｫｦ・ｲ邵ｺ繝ｻ
  return wrapPlainTextBlocksWithParagraphs(text);
}


export function normalizeComparableText(value: string): string {
  return String(value || '')
    .replace(/^#{1,6}\s+/, '')
    .replace(/^<h[1-6][^>]*>/i, '')
    .replace(/<\/h[1-6]>$/i, '')
    .replace(/^(タイトル|見出し|heading|title)\s*[:：]\s*/i, '')
    .replace(/^[Tt]itle[:：]\s*/, '')
    .toLowerCase()
    .replace(/[\s\u3000]/g, '')
    .replace(/[「」『』（）()【】\[\]"'`]/g, '')
    .replace(/[、。,.・:：]/g, '')
    .trim();
}


export function extractHeadingText(line: string): string {
  const trimmed = String(line || '').trim();
  const markdown = trimmed.match(/^#{1,6}\s+(.+)$/);
  if (markdown?.[1]) return markdown[1].trim();
  const html = trimmed.match(/^<h[1-6][^>]*>([\s\S]*?)<\/h[1-6]>$/i);
  if (html?.[1]) return html[1].replace(/<[^>]+>/g, '').trim();
  return trimmed;
}


export function isHeadingLine(line: string): boolean {
  const trimmed = String(line || '').trim();
  return /^#{1,6}\s+.+$/.test(trimmed) || /^<h[1-6][^>]*>[\s\S]*<\/h[1-6]>$/i.test(trimmed);
}


export function findNextNonEmptyLineIndex(lines: string[], startIndex: number): number {
  for (let i = startIndex; i < lines.length; i++) {
    if (String(lines[i] || '').trim()) return i;
  }
  return -1;
}


export function isLikelyBodyLine(line: string): boolean {
  const text = String(line || '').trim();
  if (!text) return false;
  if (isHeadingLine(text)) return false;
  if (/^[-*+]\s|^\d+[.)]\s|^[・●■◆]\s?/.test(text)) return true;
  return text.length >= 20 || /[。！？!?]$/.test(text);
}


export function looksLikeStandaloneHeadingLine(line: string): boolean {
  const text = String(line || '').trim();
  if (!text) return false;
  if (isHeadingLine(text)) return false;
  if (/^[-*+]\s|^\d+[.)]\s|^[・●■◆]\s?/.test(text)) return false;
  if (/^https?:\/\//i.test(text)) return false;
  if (text.length < 5 || text.length > 90) return false;
  if (/[。！？!?]$/.test(text)) return false;
  return /[A-Za-z0-9\u3040-\u30ff\u3400-\u9fff]/.test(text);
}


export function isSummaryHeadingText(text: string): boolean {
  const normalized = normalizeComparableText(text);
  if (!normalized) return false;
  const tokens = ['まとめ', '結論', '要約', '総括', 'summary', 'conclusion'];
  return tokens.some((token) => normalized.includes(normalizeComparableText(token)));
}


export function findHeadingOnlySections(content: string): string[] {
  const lines = String(content || '').split('\n');
  const headings: Array<{ index: number; level: number; title: string }> = [];
  for (let i = 0; i < lines.length; i++) {
    const line = String(lines[i] || '').trim();
    if (!isHeadingLine(line)) continue;
    const title = extractHeadingText(line);
    if (!title) continue;
    headings.push({ index: i, level: getHeadingLevel(line), title });
  }

  const missing: string[] = [];
  for (let i = 0; i < headings.length; i++) {
    const current = headings[i];
    const nextSameOrHigher = headings.find((candidate, candidateIndex) =>
      candidateIndex > i && candidate.level <= current.level
    );
    const end = nextSameOrHigher ? nextSameOrHigher.index : lines.length;
    const body = lines
      .slice(current.index + 1, end)
      .filter((line) => !isHeadingLine(line))
      .join('\n')
      .trim();
    const minChars = isSummaryHeadingText(current.title) ? 20 : 40;
    if (countGeneratedChars(body) < minChars) {
      missing.push(current.title);
    }
  }
  return missing;
}


export function sanitizeHeadingLabel(text: string): string {
  return String(text || '')
    .replace(/^[\d０-９]+[.)．、:：]\s*/, '')
    .replace(/^[・●■◆]\s*/, '')
    .replace(/[。！？!?]\s*$/, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
}


export function expandSimpleH2Heading(title: string): string {
  const current = sanitizeHeadingLabel(title);
  if (!current || isSummaryHeadingText(current)) return current;
  return current;
}


export function getHeadingLevel(line: string): number {
  const trimmed = String(line || '').trim();
  const markdown = trimmed.match(/^(#{1,6})\s+(.+)$/);
  if (markdown?.[1]) return markdown[1].length;
  const html = trimmed.match(/^<h([1-6])[^>]*>[\s\S]*<\/h[1-6]>$/i);
  if (html?.[1]) return Number(html[1]);
  return 0;
}


export function rewriteHeadingLine(originalLine: string, level: number, title: string): string {
  const safeLevel = Math.min(6, Math.max(1, Math.floor(level)));
  const safeTitle = String(title || '').trim();
  if (!safeTitle) return originalLine;

  if (/^<h[1-6][^>]*>[\s\S]*<\/h[1-6]>$/i.test(String(originalLine || '').trim())) {
    return `<h${safeLevel}>${safeTitle}</h${safeLevel}>`;
  }
  return `${'#'.repeat(safeLevel)} ${safeTitle}`;
}


export function normalizeHeadingHierarchy(lines: string[]): string[] {
  const output = [...lines];

  for (let i = 0; i < output.length; i += 1) {
    const rawLine = String(output[i] || '');
    const trimmed = rawLine.trim();
    if (!isHeadingLine(trimmed)) continue;

    let level = getHeadingLevel(trimmed);
    if (!Number.isFinite(level) || level <= 0) continue;

    let title = sanitizeHeadingLabel(extractHeadingText(trimmed));
    if (!title) continue;

    // Keep H2/H3 hierarchy. Only normalize overly deep headings into H3.
    if (level === 1) {
      level = 2;
    } else if (level > 3) {
      level = 3;
    }

    if (!isSummaryHeadingText(title)) {
      title = expandSimpleH2Heading(title);
    }

    output[i] = rewriteHeadingLine(rawLine, level, title);
  }

  return output;
}


export function countNonSummaryHeadings(content: string): number {
  const lines = String(content || '')
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .split('\n');

  let count = 0;
  for (const rawLine of lines) {
    const trimmed = String(rawLine || '').trim();
    if (!trimmed) continue;

    let level = 0;
    const markdownMatch = trimmed.match(/^(#{1,6})\s+.+$/);
    if (markdownMatch?.[1]) {
      level = markdownMatch[1].length;
    } else {
      const htmlMatch = trimmed.match(/^<h([1-6])[^>]*>[\s\S]*<\/h[1-6]>$/i);
      if (htmlMatch?.[1]) {
        level = Number(htmlMatch[1]);
      }
    }

    if (!Number.isFinite(level) || level < 2) continue;
    const headingText = extractHeadingText(trimmed);
    if (!headingText || isSummaryHeadingText(headingText)) continue;
    count += 1;
  }

  return count;
}


export function removeDuplicateSummarySections(lines: string[]): string[] {
  const headingRows: Array<{ start: number; end: number; headingText: string; bodyLength: number }> = [];

  for (let i = 0; i < lines.length; i++) {
    const text = String(lines[i] || '').trim();
    if (!isHeadingLine(text)) continue;

    let nextHeading = lines.length;
    for (let j = i + 1; j < lines.length; j++) {
      const nextText = String(lines[j] || '').trim();
      if (isHeadingLine(nextText)) {
        nextHeading = j;
        break;
      }
    }

    const bodyLength = lines
      .slice(i + 1, nextHeading)
      .join(' ')
      .replace(/\s+/g, '')
      .length;

    headingRows.push({
      start: i,
      end: nextHeading,
      headingText: extractHeadingText(text),
      bodyLength,
    });
  }

  const summaryRows = headingRows.filter((row) => isSummaryHeadingText(row.headingText));
  if (summaryRows.length <= 1) return lines;

  const keepRow = summaryRows
    .slice()
    .sort((a, b) => b.bodyLength - a.bodyLength)[0];
  const removeRanges = summaryRows
    .filter((row) => row.start !== keepRow.start)
    .map((row) => ({ start: row.start, end: row.end }));

  if (removeRanges.length === 0) return lines;

  const filtered = lines.filter((_, index) => {
    return !removeRanges.some((range) => index >= range.start && index < range.end);
  });

  console.log(`Removed duplicate summary sections: ${removeRanges.length} removed`);
  return filtered;
}


export function shouldRemoveLeadingTitleLine(line: string, articleTitle: string): boolean {
  const raw = extractHeadingText(line);
  if (!raw) return false;

  const looksHeadingLike = isHeadingLine(line) || (
    raw.length <= 80 &&
    !/[邵ｲ繧托ｽｼ繝ｻ・ｼ繝ｻ!?]$/.test(raw) &&
    /[A-Za-z0-9\u3040-\u30ff\u3400-\u9fff]/.test(raw)
  );
  if (!looksHeadingLike) return false;

  const normalizedLine = normalizeComparableText(raw);
  const normalizedTitle = normalizeComparableText(articleTitle);
  if (!normalizedLine || !normalizedTitle) return false;

  const withoutSummary = normalizeComparableText(raw.replace(/繝ｻ驛・ｽｦ竏ｫ・ｴ繝ｻ・ｼ讎蚕(髫補悪・ｴﾐｫ)|邵ｲ蜊・ｦ竏ｫ・ｴ繝ｻﾂ謗・囎竏ｫ・ｴ繝ｻ/g, ''));
  if (normalizedLine === normalizedTitle) return true;
  if (withoutSummary === normalizedTitle) return true;
  // Only remove via prefix match when the line is close in length to the title
  // (prevents removing lead sentences that start with the keyword).
  const lineIsShortEnough = raw.length <= articleTitle.length * 1.3 + 10;
  if (lineIsShortEnough && (normalizedLine.startsWith(normalizedTitle) || normalizedTitle.startsWith(normalizedLine))) return true;

  const hasSummarySuffix = /(繝ｻ驛・ｽｦ竏ｫ・ｴ繝ｻ・ｼ讎蚕(髫補悪・ｴﾐｫ)|邵ｲ蜊・ｦ竏ｫ・ｴ繝ｻﾂ謗・囎竏ｫ・ｴ繝ｻ)/.test(raw);
  if (hasSummarySuffix && (normalizedLine.includes(normalizedTitle) || withoutSummary.includes(normalizedTitle))) {
    return true;
  }

  // Fuzzy near-duplicate check
  const minComparable = Math.min(normalizedLine.length, normalizedTitle.length);
  if (minComparable >= 10) {
    let commonPrefixLen = 0;
    while (
      commonPrefixLen < minComparable &&
      normalizedLine[commonPrefixLen] === normalizedTitle[commonPrefixLen]
    ) {
      commonPrefixLen += 1;
    }
    const prefixRate = commonPrefixLen / Math.max(1, minComparable);
    if (prefixRate >= 0.72) return true;
  }
  return false;
}


export function normalizeGeneratedContentForPublishing(rawContent: string, articleTitle: string): string {
  let text = String(rawContent ?? '')
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .replace(/\uFEFF/g, '')
    .trim();

  if (!text) return '';
  let lines = text.split('\n');

  // In WordPress, post title is handled separately; drop accidental leading H1 in body.
  const firstHeadingIndex = findNextNonEmptyLineIndex(lines, 0);
  if (firstHeadingIndex !== -1 && getHeadingLevel(lines[firstHeadingIndex]) === 1) {
    lines.splice(firstHeadingIndex, 1);
  }

  const firstLineIndex = findNextNonEmptyLineIndex(lines, 0);
  if (firstLineIndex !== -1 && shouldRemoveLeadingTitleLine(lines[firstLineIndex], articleTitle)) {
    lines.splice(firstLineIndex, 1);
  }
  for (let pass = 0; pass < 2; pass += 1) {
    const idx = findNextNonEmptyLineIndex(lines, 0);
    if (idx === -1) break;
    if (!shouldRemoveLeadingTitleLine(lines[idx], articleTitle)) break;
    lines.splice(idx, 1);
  }

  for (let i = 0; i < lines.length; i++) {
    const current = String(lines[i] || '').trim();
    if (!looksLikeStandaloneHeadingLine(current)) continue;

    const nextIndex = findNextNonEmptyLineIndex(lines, i + 1);
    if (nextIndex === -1) continue;
    const next = String(lines[nextIndex] || '').trim();
    if (isHeadingLine(next)) continue;
    if (!isLikelyBodyLine(next)) continue;

    const normalizedHeading = expandSimpleH2Heading(current) || sanitizeHeadingLabel(current) || current;
    lines[i] = `## ${normalizedHeading}`;
  }

  lines = normalizeHeadingHierarchy(lines);
  lines = removeDuplicateSummarySections(lines);

  const withoutEmptyHeadings: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    const rawLine = String(lines[i] || '');
    const trimmed = rawLine.trim();
    if (!trimmed) {
      withoutEmptyHeadings.push(rawLine);
      continue;
    }

    if (!isHeadingLine(trimmed)) {
      withoutEmptyHeadings.push(rawLine);
      continue;
    }

    const nextIndex = findNextNonEmptyLineIndex(lines, i + 1);
    if (nextIndex === -1) continue;
    const next = String(lines[nextIndex] || '').trim();
    if (isHeadingLine(next)) continue;

    withoutEmptyHeadings.push(rawLine);
  }

  lines = withoutEmptyHeadings;
  lines = normalizeHeadingHierarchy(lines);
  lines = removeDuplicateSummarySections(lines);
  let cleaned = lines.join('\n').replace(/\n{3,}/g, '\n\n').trim();

  const postLines = cleaned.split('\n');
  const postFirstHeadingIndex = findNextNonEmptyLineIndex(postLines, 0);
  if (postFirstHeadingIndex !== -1 && getHeadingLevel(postLines[postFirstHeadingIndex]) === 1) {
    postLines.splice(postFirstHeadingIndex, 1);
  }
  const postFirstLineIndex = findNextNonEmptyLineIndex(postLines, 0);
  if (postFirstLineIndex !== -1 && shouldRemoveLeadingTitleLine(postLines[postFirstLineIndex], articleTitle)) {
    postLines.splice(postFirstLineIndex, 1);
  }
  cleaned = postLines.join('\n').replace(/\n{3,}/g, '\n\n').trim();

  return cleaned;
}


export function extractExcerpt(content: string, maxLength = 180): string {
  const plain = String(content || '')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/\*\*/g, '')
    .replace(/\*/g, '')
    .replace(/!\[[^\]]*]\([^)]+\)/g, '')
    .replace(/\[[^\]]+]\([^)]+\)/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();
  if (plain.length <= maxLength) return plain;
  return `${plain.slice(0, maxLength)}...`;
}


export function inferLengthCategory(charCount: number): 'short' | 'medium' | 'long' {
  if (charCount < 1200) return 'short';
  if (charCount < 2400) return 'medium';
  return 'long';
}


export function summarizeFactCheckContentChanges(
  beforeContent: string,
  afterContent: string,
  maxItems = 5
): string[] {
  const beforeLines = String(beforeContent || '').replace(/\r\n/g, '\n').split('\n');
  const afterLines = String(afterContent || '').replace(/\r\n/g, '\n').split('\n');
  const maxLines = Math.max(beforeLines.length, afterLines.length);
  const summaries: string[] = [];

  for (let i = 0; i < maxLines && summaries.length < maxItems; i += 1) {
    const beforeRaw = beforeLines[i] ?? '';
    const afterRaw = afterLines[i] ?? '';
    const beforeLine = trimForLog(beforeRaw, 120);
    const afterLine = trimForLog(afterRaw, 120);
    if (beforeLine === afterLine) continue;

    summaries.push(
      `${summaries.length + 1}. L${i + 1}\n` +
      `修正前: ${beforeLine || '(空行)'}\n` +
      `修正後: ${afterLine || '(空行)'}`
    );
  }

  return summaries;
}

