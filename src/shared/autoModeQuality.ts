import type { ArticleOutline, ArticleStructureType } from '../types';

export function compactAutoModeInstructions(parts: Array<string | undefined | null | false>): string | undefined {
  const text = parts
    .map((part) => String(part || '').trim())
    .filter(Boolean)
    .join('\n\n')
    .trim();

  return text || undefined;
}

export function buildAutoModeQualityInstructions(options: {
  selectedTitle?: string;
  targetWordCount: number;
  articleStructureType?: ArticleStructureType;
}): string {
  return [
    '自動モード品質基準:',
    options.selectedTitle
      ? `- 固定タイトル「${options.selectedTitle}」の検索意図を最優先し、タイトルから外れた章を作らない`
      : '- 入力キーワードから読者の検索意図を特定し、記事全体を一つの明確な目的に揃える',
    `- 目標文字数は${options.targetWordCount}字。導入・本文・まとめの配分を崩さず、本文を薄くしない`,
    '- 対話モードで人が確認したアウトラインと同等になるよう、各H2の役割を分ける',
    '- 「種類と特徴」「選び方と注意点」「活用方法」だけの汎用見出しに逃げず、テーマ固有の判断材料にする',
    '- H3は直前のH2を具体化する小見出しとして使い、独立した大テーマにしない',
    '- 本文では同じ説明を繰り返さず、原因・対策・比較・注意点・実行手順のどれを扱うかを明確にする',
    '- AIO・AI検索で要約されやすいよう、導入で結論を先に示し、定義・手順・比較・判断基準・FAQに転用しやすい見出しを必要に応じて入れる',
    '- 各見出しは1つの質問に対する答えが抜き出せる粒度にし、複数テーマを混ぜない',
    options.articleStructureType ? `- 記事構成タイプ: ${options.articleStructureType}` : '',
  ].filter(Boolean).join('\n');
}

function normalizeComparableText(value: string): string {
  return String(value || '')
    .toLowerCase()
    .replace(/[^\p{Letter}\p{Number}]+/gu, '')
    .trim();
}

function isSummaryTitle(title: string): boolean {
  const normalized = String(title || '').trim().toLowerCase();
  return (
    normalized.includes('まとめ') ||
    normalized.includes('結論') ||
    normalized.includes('おわりに') ||
    normalized.includes('総括') ||
    normalized.includes('最後に') ||
    normalized.includes('summary') ||
    normalized.includes('conclusion')
  );
}

export function evaluateAutoOutlineQuality(
  outline: ArticleOutline,
  options: { targetWordCount: number; selectedTitle?: string }
): { passed: boolean; issues: string[] } {
  const issues: string[] = [];
  const sections = outline.sections || [];
  const nonLeadSections = sections.filter((section) => !section.isLead);
  const h2Sections = nonLeadSections.filter((section) => section.level === 2);
  const h3Sections = nonLeadSections.filter((section) => section.level === 3);
  const minSections = options.targetWordCount <= 1200 ? 5 : options.targetWordCount <= 3000 ? 6 : 7;

  if (sections.length < minSections) {
    issues.push(`section count is too low (${sections.length}/${minSections})`);
  }

  if (h2Sections.length < 3) {
    issues.push(`H2 count is too low (${h2Sections.length}/3)`);
  }

  if (options.targetWordCount >= 1600 && h3Sections.length < 2) {
    issues.push(`H3 count is too low (${h3Sections.length}/2)`);
  }

  if (!sections.some((section) => isSummaryTitle(section.title))) {
    issues.push('summary section is missing');
  }

  const seenTitles = new Set<string>();
  const genericHeadingPattern = /(活用方法|種類と特徴|選び方と注意点|ポイント|メリット|デメリット|主な種類と特徴|特徴・費用・継続しやすさ)$/;
  let genericHeadingCount = 0;

  for (const section of nonLeadSections) {
    const title = String(section.title || '').trim();
    const normalized = normalizeComparableText(title);
    if (!normalized) {
      issues.push('empty heading exists');
      continue;
    }

    if (seenTitles.has(normalized)) {
      issues.push(`duplicate heading: ${title}`);
    }
    seenTitles.add(normalized);

    if (genericHeadingPattern.test(title)) {
      genericHeadingCount += 1;
    }
  }

  if (genericHeadingCount >= 2) {
    issues.push(`too many generic headings (${genericHeadingCount})`);
  }

  return { passed: issues.length === 0, issues };
}

export function buildAutoOutlineRetryInstructions(issues: string[]): string {
  return [
    '自動モード再生成指示:',
    '前回のアウトラインは自動生成品質基準を満たしていません。以下を必ず修正してください。',
    ...issues.map((issue) => `- ${issue}`),
    '- H2ごとの役割を明確に分け、汎用見出しをテーマ固有の具体的な見出しに置き換える',
    '- 目標文字数に対して本文が薄くならない章数と配分にする',
  ].join('\n');
}
