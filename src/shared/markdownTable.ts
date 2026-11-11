// Markdown の表（| で始まる行。2 行目が区切り行）を HTML の <table> にする共通部品
// 自動投稿・手動投稿・レビューからの投稿で同じ変換を使う

const TABLE_SEPARATOR_PATTERN = /^\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?$/;

export function isMarkdownTableLine(line: string): boolean {
  return /^\|.*\|$/.test(String(line || '').trim());
}

function splitTableRow(line: string): string[] {
  return line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((cell) => cell.trim());
}

// 表として読めれば <table>…</table> を返す。表でなければ null
export function renderMarkdownTableHtml(
  lines: string[],
  formatCell: (text: string) => string = (text) => text,
): string | null {
  const cleaned = (lines || []).map((line) => String(line || '').trim()).filter(Boolean);
  if (cleaned.length < 2) return null;
  if (!cleaned.every(isMarkdownTableLine)) return null;
  if (!TABLE_SEPARATOR_PATTERN.test(cleaned[1])) return null;
  const header = splitTableRow(cleaned[0]);
  const rows = cleaned.slice(2).map(splitTableRow);
  const head = `<thead><tr>${header.map((cell) => `<th>${formatCell(cell)}</th>`).join('')}</tr></thead>`;
  const body = rows.length > 0
    ? `<tbody>${rows.map((row) => `<tr>${row.map((cell) => `<td>${formatCell(cell)}</td>`).join('')}</tr>`).join('')}</tbody>`
    : '';
  return `<table>${head}${body}</table>`;
}

// Gutenberg の表ブロック
export function renderMarkdownTableGutenberg(
  lines: string[],
  formatCell?: (text: string) => string,
): string | null {
  const table = renderMarkdownTableHtml(lines, formatCell);
  if (!table) return null;
  return `<!-- wp:table -->\n<figure class="wp-block-table">${table}</figure>\n<!-- /wp:table -->`;
}
