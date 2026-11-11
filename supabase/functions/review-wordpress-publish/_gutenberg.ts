import { convertMarkdownLinksToHtml } from '../../../src/shared/markdownLinks.ts';

/** Convert the review editor's Markdown to native Gutenberg blocks. */
export function toGutenbergBlocks(content: string): string {
  if (!content) return '';

  const blocks: string[] = [];
  let listItems: string[] = [];

  const flushList = () => {
    if (listItems.length === 0) return;
    blocks.push(`<!-- wp:list -->\n<ul class="wp-block-list">${listItems.map((item) => `<li>${formatInline(item)}</li>`).join('')}</ul>\n<!-- /wp:list -->`);
    listItems = [];
  };

  for (const rawLine of content.replace(/\r\n?/g, '\n').split('\n')) {
    const line = rawLine.trim();
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
      blocks.push(`<!-- wp:paragraph -->\n<p>${formatInline(line)}</p>\n<!-- /wp:paragraph -->`);
    }
  }

  flushList();
  return blocks.join('\n\n');
}

function formatInline(text: string): string {
  return convertMarkdownLinksToHtml(text)
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/(?<!\*)\*([^*]+?)\*(?!\*)/g, '<em>$1</em>');
}
