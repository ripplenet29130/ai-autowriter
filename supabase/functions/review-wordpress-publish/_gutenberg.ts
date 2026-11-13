import { convertMarkdownLinksToHtml } from '../../../src/shared/markdownLinks.ts';
import { isMarkdownTableLine, renderMarkdownTableGutenberg } from '../../../src/shared/markdownTable.ts';
import { splitLongParagraphForReadability } from '../../../src/shared/paragraphSplit.ts';
import { normalizeBulletsForPreview } from '../../../src/shared/previewMarkdown.ts';

/** Convert the review editor's Markdown to native Gutenberg blocks. */
export function toGutenbergBlocks(content: string): string {
  if (!content) return '';

  const blocks: string[] = [];
  let listItems: string[] = [];
  let tableLines: string[] = [];

  const flushList = () => {
    if (listItems.length === 0) return;
    blocks.push(`<!-- wp:list -->\n<ul class="wp-block-list">${listItems.map((item) => `<li>${formatInline(item)}</li>`).join('')}</ul>\n<!-- /wp:list -->`);
    listItems = [];
  };
  // Markdown の表は表ブロックにする。表として読めなければ段落として残す
  const flushTable = () => {
    if (tableLines.length === 0) return;
    const table = renderMarkdownTableGutenberg(tableLines, formatInline);
    if (table) blocks.push(table);
    else tableLines.forEach((row) => blocks.push(`<!-- wp:paragraph -->\n<p>${formatInline(row)}</p>\n<!-- /wp:paragraph -->`));
    tableLines = [];
  };

  // 2026-11-13 レビュー画面から投稿した記事は段落が長いまま・「・」の箇条書きが 1 段落のままだった
  // プレビューと同じく「・」を箇条書きに直してから変換する
  for (const rawLine of normalizeBulletsForPreview(content).split('\n')) {
    const line = rawLine.trim();
    if (isMarkdownTableLine(line)) {
      flushList();
      tableLines.push(line);
      continue;
    }
    flushTable();
    if (!line) {
      flushList();
      continue;
    }

    const heading = line.match(/^(#{1,6})\s+(.+)$/);
    if (heading) {
      flushList();
      const level = heading[1].length;
      blocks.push(`<!-- wp:heading {"level":${level}} -->\n<h${level} class="wp-block-heading">${formatInline(heading[2])}</h${level}>\n<!-- /wp:heading -->`);
      continue;
    }

    const listItem = line.match(/^[-*+]\s+(.+)$/);
    if (listItem) {
      listItems.push(listItem[1]);
      continue;
    }

    flushList();
    // Preserve HTML blocks already deliberately entered in the review editor.
    if (/^<(?:h[1-6]|p|ul|ol|blockquote|figure|table)\b/i.test(line)) {
      blocks.push(line);
    } else {
      // 長い段落は 2 文・100 字くらいで分ける（スケジューラー投稿と同じルール）
      for (const paragraph of splitLongParagraphForReadability(line)) {
        blocks.push(`<!-- wp:paragraph -->\n<p>${formatInline(paragraph)}</p>\n<!-- /wp:paragraph -->`);
      }
    }
  }

  flushTable();
  flushList();
  return blocks.join('\n\n');
}

function formatInline(text: string): string {
  return convertMarkdownLinksToHtml(text)
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/(?<!\*)\*([^*]+?)\*(?!\*)/g, '<em>$1</em>');
}
