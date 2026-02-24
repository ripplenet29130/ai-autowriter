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
  const m1 = text.match(/^\s*Title\s*:\s*(.+)$/im);
  if (m1?.[1]) return m1[1].trim();
  const m2 = text.match(/^\s*タイトル\s*:\s*(.+)$/im);
  if (m2?.[1]) return m2[1].trim();
  return `${keyword}について`;
}

function fallbackSections(keyword: string, defaultEstimatedWordCount: number): ParsedOutlineSection[] {
  return [
    { title: '導入', level: 2, description: '記事の導入', estimatedWordCount: defaultEstimatedWordCount, isLead: true },
    { title: `${keyword}の基礎`, level: 2, description: '基本情報の整理', estimatedWordCount: defaultEstimatedWordCount, isLead: false },
    { title: `${keyword}のポイント`, level: 2, description: '実践上の要点', estimatedWordCount: defaultEstimatedWordCount, isLead: false },
    { title: 'まとめ', level: 2, description: '要点の総括', estimatedWordCount: defaultEstimatedWordCount, isLead: false },
  ];
}

export function parseOutlineSections(
  text: string,
  defaultEstimatedWordCount = 300
): ParsedOutlineSection[] {
  const lines = text.split('\n').map((l) => l.trim()).filter(Boolean);
  const sections: ParsedOutlineSection[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const sec = line.match(/^Section\s*\((Lead|H2|H3)\)\s*:\s*(.+)$/i)
      || line.match(/^見出し\s*\((Lead|H2|H3)\)\s*:\s*(.+)$/i);
    if (!sec) continue;

    const rawLevel = sec[1].toLowerCase();
    const level: 2 | 3 = rawLevel === 'h3' ? 3 : 2;
    const isLead = rawLevel === 'lead';
    const title = (sec[2] || '').trim();

    let description = '';
    let estimatedWordCount = defaultEstimatedWordCount;

    for (let j = i + 1; j < lines.length; j++) {
      const next = lines[j];
      if (/^(Section|見出し)\s*\(/i.test(next)) break;

      const d = next.match(/^(Description|説明)\s*:\s*(.+)$/i);
      if (d) {
        description = d[2].trim();
        continue;
      }

      const e = next.match(/^(Estimated|推定文字数)\s*:\s*(\d+)/i);
      if (e) {
        estimatedWordCount = Number.parseInt(e[2], 10) || defaultEstimatedWordCount;
      }
    }

    sections.push({
      title,
      level,
      description,
      estimatedWordCount,
      isLead,
    });
  }

  if (sections.length > 0) return sections;
  return fallbackSections('記事テーマ', defaultEstimatedWordCount);
}

