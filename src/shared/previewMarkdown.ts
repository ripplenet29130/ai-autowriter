// プレビュー表示（ReactMarkdown）の前に本文を整える
// 2026-11-13 「・a。・b。・c。」と 1 行に続けて書かれた箇条書きが、プレビューで 1 つの段落になっていた
// （WordPress 投稿側は _content-format.ts の renderBufferedBlock で同じように直している）

const BULLET_START = /^[・●■◆]\s*/;
const LIST_LINE = /^\s*(?:[-*+]\s|\d+[.)]\s)/;

export function normalizeBulletsForPreview(markdown: string): string {
  const lines = String(markdown || '').replace(/\r\n?/g, '\n').split('\n');
  const output: string[] = [];
  let inCode = false;
  let afterBullets = false;

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (/^(```|~~~)/.test(line)) inCode = !inCode;
    if (inCode || !BULLET_START.test(line)) {
      // 箇条書きのすぐ後の普通の文が、最後の項目の続きにならないよう空行をはさむ
      if (afterBullets && line && !LIST_LINE.test(line)) output.push('');
      afterBullets = false;
      output.push(rawLine);
      continue;
    }

    // 「。・」で区切って項目ごとに分け、Markdown の「- 」にする
    const items = line
      .split(/(?<=[。．！？!?])\s*(?=[・●■◆])/)
      .map((part) => part.replace(BULLET_START, '').trim())
      .filter(Boolean);

    // 直前が普通の文や表なら、空行を入れてから箇条書きを始める
    const prev = output[output.length - 1]?.trim() ?? '';
    if (prev && !LIST_LINE.test(prev)) output.push('');

    output.push(...items.map((item) => `- ${item}`));
    afterBullets = true;
  }

  return output.join('\n');
}
