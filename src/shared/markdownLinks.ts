// Markdown のリンク [文字](https://...) を HTML の <a> に変換する（参考資料のリンク用）
const escapeAttr = (value: string): string =>
  value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

export function convertMarkdownLinksToHtml(text: string): string {
  return String(text || '').replace(
    /(^|[^!])\[([^\]\n]+)\]\((https?:\/\/[^\s)]+)\)/g,
    (_match, prefix: string, label: string, url: string) =>
      `${prefix}<a href="${escapeAttr(url)}" target="_blank" rel="noopener noreferrer">${label}</a>`,
  );
}
