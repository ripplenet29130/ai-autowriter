export interface ParsedOutlineSection {
  title: string;
  level: 2 | 3;
  description: string;
  estimatedWordCount: number;
  isLead: boolean;
}

function normalizeTitle(value: string): string {
  return String(value || '')
    .replace(/^#{1,6}\s+/, '')
    .replace(/^[\d０-９]+[\.．、:：)\]]\s*/, '')
    .replace(/^["'「」]+|["'「」]+$/g, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

function parseEstimatedWordCount(line: string): number | null {
  const m = String(line || '').match(/(?:estimated|推定|目安)\s*[:：]?\s*(\d+)/i);
  if (!m) return null;
  const value = Number.parseInt(m[1], 10);
  if (!Number.isFinite(value) || value <= 0) return null;
  return value;
}

function fallbackSections(defaultEstimatedWordCount: number): ParsedOutlineSection[] {
  const per = Math.max(180, defaultEstimatedWordCount || 300);
  return [
    { title: '導入', level: 2, description: '記事の導入', estimatedWordCount: per, isLead: true },
    { title: '基礎知識', level: 2, description: '基本事項を整理する', estimatedWordCount: per, isLead: false },
    { title: '比較ポイント', level: 2, description: '判断基準を明確にする', estimatedWordCount: per, isLead: false },
    { title: '実践手順', level: 2, description: '失敗しにくい進め方を示す', estimatedWordCount: per, isLead: false },
    { title: 'まとめ', level: 2, description: '要点を振り返る', estimatedWordCount: per, isLead: false },
  ];
}

export function parseOutlineTitle(
  text: string,
  keyword: string,
  fixedTitle: string | null = null
): string {
  if (fixedTitle) return fixedTitle;

  const match = String(text || '').match(
    /^\s*(?:Title|タイトル|記事タイトル)\s*[:：]\s*(.+)$/im
  );
  if (match?.[1]) {
    const parsed = normalizeTitle(match[1]);
    if (parsed) return parsed;
  }

  return `${keyword}について`;
}

interface SectionStart {
  level: 2 | 3;
  isLead: boolean;
  title: string;
  consumed: number;
}

function isTokenOnlyLine(line: string): boolean {
  return /^(?:Lead|H2|H3|導入|はじめに)$/i.test(String(line || '').trim());
}

function detectSectionStart(lines: string[], index: number): SectionStart | null {
  const line = String(lines[index] || '').trim();
  if (!line) return null;

  const sectionStyle = line.match(/^(?:Section|セクション)\s*\((Lead|H2|H3)\)\s*[:：]\s*(.+)$/i);
  if (sectionStyle) {
    const token = sectionStyle[1].toLowerCase();
    const title = normalizeTitle(sectionStyle[2]);
    if (!title) return null;
    return {
      level: token === 'h3' ? 3 : 2,
      isLead: token === 'lead',
      title,
      consumed: 0,
    };
  }

  const simpleTokenInline = line.match(/^(Lead|H2|H3)\s*[:：]\s*(.+)$/i);
  if (simpleTokenInline) {
    const token = simpleTokenInline[1].toLowerCase();
    const title = normalizeTitle(simpleTokenInline[2]);
    if (!title) return null;
    return {
      level: token === 'h3' ? 3 : 2,
      isLead: token === 'lead',
      title,
      consumed: 0,
    };
  }

  const mdH3 = line.match(/^###\s*(.+)$/);
  if (mdH3) {
    const title = normalizeTitle(mdH3[1]);
    if (!title) return null;
    return { level: 3, isLead: false, title, consumed: 0 };
  }

  const mdH2 = line.match(/^##\s*(.+)$/);
  if (mdH2) {
    const title = normalizeTitle(mdH2[1]);
    if (!title) return null;
    const isLead = /^(導入|リード|はじめに)$/i.test(title);
    return { level: 2, isLead, title, consumed: 0 };
  }

  const orderedHeading = line.match(/^\d+\.\s*(.+)$/);
  if (orderedHeading) {
    const title = normalizeTitle(orderedHeading[1]).replace(/[：:]$/, '').trim();
    if (!title) return null;
    return { level: 2, isLead: false, title, consumed: 0 };
  }

  if (isTokenOnlyLine(line)) {
    const token = line.toLowerCase();
    if (token === 'lead' || token === '導入' || token === 'はじめに') {
      return { level: 2, isLead: true, title: 'はじめに', consumed: 0 };
    }
    let j = index + 1;
    while (j < lines.length && !String(lines[j] || '').trim()) j += 1;
    if (j >= lines.length) return null;
    const candidate = String(lines[j] || '').trim();
    if (!candidate || isTokenOnlyLine(candidate) || parseEstimatedWordCount(candidate) !== null) {
      return null;
    }
    const title = normalizeTitle(candidate);
    if (!title) return null;
    return {
      level: token === 'h3' ? 3 : 2,
      isLead: token === 'lead' || token === '導入' || token === 'はじめに',
      title,
      consumed: j - index,
    };
  }

  return null;
}

function parseLeadFromPreamble(
  lines: string[],
  defaultEstimatedWordCount: number
): ParsedOutlineSection | null {
  const trimmed = (lines || [])
    .map((line) => String(line || '').trim())
    .filter((line) => line.length > 0);
  if (trimmed.length === 0) return null;

  let estimatedWordCount = defaultEstimatedWordCount;
  for (const line of trimmed) {
    const estimated = parseEstimatedWordCount(line);
    if (estimated !== null) {
      estimatedWordCount = estimated;
    }
  }

  const looksLikeStandaloneTitle = (line: string): boolean => {
    const text = String(line || '').trim();
    if (!text) return false;
    if (/^(?:Title|タイトル|記事タイトル)\s*[:：]/i.test(text)) return true;
    const len = text.length;
    return len >= 12 && len <= 90 && !/[。！？]$/.test(text);
  };

  let startIndex = 0;
  if (trimmed.length >= 2 && looksLikeStandaloneTitle(trimmed[0])) {
    startIndex = 1;
  }

  let description = '';
  for (let i = startIndex; i < trimmed.length; i += 1) {
    const line = trimmed[i];
    if (parseEstimatedWordCount(line) !== null) continue;
    if (/^(?:Description|説明|概要)\s*[:：]/i.test(line)) {
      description = line.replace(/^(?:Description|説明|概要)\s*[:：]\s*/i, '').trim();
      break;
    }
    if (isTokenOnlyLine(line)) continue;
    if (/^(?:H2|H3|Lead)\b/i.test(line)) continue;
    description = line;
    break;
  }

  if (!description && trimmed.length > startIndex) {
    description = trimmed
      .find((line, index) => index >= startIndex && parseEstimatedWordCount(line) === null && !/^(?:H2|H3|Lead)\b/i.test(line))
      || '';
  }

  if (!description) {
    description = '記事全体の導入';
  }

  return {
    title: 'はじめに',
    level: 2,
    description,
    estimatedWordCount: Math.max(120, estimatedWordCount),
    isLead: true,
  };
}

function parseBlockStyleSections(
  text: string,
  defaultEstimatedWordCount: number
): ParsedOutlineSection[] {
  const blocks = String(text || '')
    .split(/\n{2,}/)
    .map((block) => block.trim())
    .filter((block) => block.length > 0);

  const sections: ParsedOutlineSection[] = [];

  for (const block of blocks) {
    const lines = block
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.length > 0);
    if (lines.length === 0) continue;

    let token: 'lead' | 'h2' | 'h3' | null = null;
    let title = '';
    let startIndex = 0;

    if (/^(?:Lead|H2|H3|導入)$/i.test(lines[0])) {
      const key = lines[0].toLowerCase();
      token = key === 'h3' ? 'h3' : key === 'h2' ? 'h2' : 'lead';
      if (lines.length < 2) continue;
      title = normalizeTitle(lines[1]);
      startIndex = 2;
    } else {
      const first = normalizeTitle(lines[0]);
      const hasEstimated = lines.some((line) => parseEstimatedWordCount(line) !== null);
      if (!first || (!hasEstimated && first.length > 70)) continue;
      title = first;
      token = sections.length === 0 ? 'lead' : 'h2';
      startIndex = 1;
    }

    if (!title) continue;

    let description = '';
    let estimatedWordCount = defaultEstimatedWordCount;
    for (let i = startIndex; i < lines.length; i += 1) {
      const line = lines[i];
      const estimated = parseEstimatedWordCount(line);
      if (estimated !== null) {
        estimatedWordCount = estimated;
        continue;
      }
      const descMatch = line.match(/^(?:Description|説明|概要)\s*[:：]\s*(.+)$/i);
      if (descMatch?.[1]) {
        description = descMatch[1].trim();
        continue;
      }
      if (!description && !/^(?:H2|H3|Lead)\b/i.test(line)) {
        description = line;
      }
    }

    sections.push({
      title,
      level: token === 'h3' ? 3 : 2,
      description,
      estimatedWordCount: Math.max(120, estimatedWordCount),
      isLead: token === 'lead',
    });
  }

  return sections;
}

export function parseOutlineSections(
  text: string,
  defaultEstimatedWordCount = 300,
  allowFallback = true
): ParsedOutlineSection[] {
  const lines = String(text || '').split('\n');
  const sections: ParsedOutlineSection[] = [];
  let firstDetectedIndex = -1;
  let firstDetectedStart: SectionStart | null = null;

  for (let i = 0; i < lines.length;) {
    const start = detectSectionStart(lines, i);
    if (!start) {
      i += 1;
      continue;
    }

    if (firstDetectedIndex === -1) {
      firstDetectedIndex = i;
      firstDetectedStart = start;
    }

    let description = '';
    let estimatedWordCount = defaultEstimatedWordCount;
    let j = i + start.consumed + 1;

    for (; j < lines.length; j += 1) {
      const boundary = detectSectionStart(lines, j);
      if (boundary) break;

      const raw = String(lines[j] || '').trim();
      if (!raw) continue;

      const estimated = parseEstimatedWordCount(raw);
      if (estimated !== null) {
        estimatedWordCount = estimated;
        continue;
      }

      const descMatch = raw.match(/^(?:Description|説明|概要)\s*[:：]\s*(.+)$/i);
      if (descMatch?.[1]) {
        description = descMatch[1].trim();
        continue;
      }

      if (!description && !isTokenOnlyLine(raw) && !raw.startsWith('#')) {
        description = raw;
      }
    }

    sections.push({
      title: start.title,
      level: start.level,
      description,
      estimatedWordCount,
      isLead: start.isLead,
    });

    i = j;
  }

  if (sections.length > 0 && firstDetectedIndex > 0 && !firstDetectedStart?.isLead) {
    const leadCandidate = parseLeadFromPreamble(
      lines.slice(0, firstDetectedIndex),
      defaultEstimatedWordCount
    );
    if (leadCandidate) {
      sections.unshift(leadCandidate);
    }
  }

  if (sections.length === 0) {
    const blockParsed = parseBlockStyleSections(text, defaultEstimatedWordCount);
    if (blockParsed.length > 0) {
      sections.push(...blockParsed);
    }
  }

  const normalized: ParsedOutlineSection[] = [];
  for (const section of sections) {
    const title = normalizeTitle(section.title);
    if (!title) continue;
    const level: 2 | 3 = section.level === 3 ? 3 : 2;
    normalized.push({
      title,
      level,
      isLead: Boolean(section.isLead),
      description: String(section.description || '').trim(),
      estimatedWordCount: Number.isFinite(section.estimatedWordCount)
        ? Math.max(120, section.estimatedWordCount)
        : Math.max(120, defaultEstimatedWordCount),
    });
  }

  if (normalized.length > 0) {
    const firstLeadIndex = normalized.findIndex((section) => section.isLead);
    if (firstLeadIndex === -1) {
      normalized[0] = { ...normalized[0], isLead: true, level: 2 };
    } else if (firstLeadIndex > 0) {
      const lead: ParsedOutlineSection = { ...normalized[firstLeadIndex], isLead: true, level: 2 };
      normalized.splice(firstLeadIndex, 1);
      normalized.unshift(lead);
    }

    for (let i = 1; i < normalized.length; i += 1) {
      if (normalized[i].isLead) normalized[i] = { ...normalized[i], isLead: false };
    }

    return normalized;
  }

  return allowFallback ? fallbackSections(defaultEstimatedWordCount) : [];
}
