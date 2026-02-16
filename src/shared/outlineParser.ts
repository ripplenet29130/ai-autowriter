export interface ParsedOutlineSection {
  title: string;
  level: 2 | 3;
  description: string;
  estimatedWordCount: number;
  isLead: boolean;
}

export function parseOutlineTitle(
  text: string,
  keyword: string,
  fixedTitle: string | null = null
): string {
  if (fixedTitle) return fixedTitle;
  const titleMatch = text.match(/(?:タイトル|title)\s*:\s*(.+)/i);
  return titleMatch ? titleMatch[1].trim() : `${keyword} について`;
}

export function parseOutlineSections(
  text: string,
  defaultEstimatedWordCount = 300
): ParsedOutlineSection[] {
  const sections: ParsedOutlineSection[] = [];
  const lines = text.split('\n');

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    const leadMatch = line.match(/^見出し\s*\(Lead\)\s*:\s*(.+)$/);
    const h2Match = line.match(/^見出し\d+\s*\(H2\)\s*:\s*(.+)$/);
    const h3Match = line.match(/^\s*見出し\d+-\d+\s*\(H3\)\s*:\s*(.+)$/);

    if (!leadMatch && !h2Match && !h3Match) continue;

    const title = (leadMatch?.[1] || h2Match?.[1] || h3Match?.[1] || '').trim();
    const level: 2 | 3 = leadMatch || h2Match ? 2 : 3;
    const isLead = !!leadMatch;

    let description = '';
    let estimatedWordCount = defaultEstimatedWordCount;

    for (let j = i + 1; j < lines.length; j++) {
      const nextLine = lines[j].trim();

      if (nextLine.startsWith('説明:')) {
        description = nextLine.replace(/^説明:\s*/, '').trim();
        continue;
      }

      if (nextLine.startsWith('推定文字数:')) {
        const match = nextLine.match(/\d+/);
        if (match) estimatedWordCount = parseInt(match[0], 10);
        continue;
      }

      if (nextLine.startsWith('見出し')) {
        break;
      }
    }

    sections.push({
      title,
      level,
      description,
      estimatedWordCount,
      isLead
    });
  }

  return sections;
}
