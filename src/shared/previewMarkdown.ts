// プレビュー表示（ReactMarkdown）の前に本文を整える
// 2026-11-13 「・a。・b。・c。」と 1 行に続けて書かれた箇条書きが、プレビューで 1 つの段落になっていた
// （WordPress 投稿側は _content-format.ts の renderBufferedBlock で同じように直している）

import { splitLongParagraphForReadability } from './paragraphSplit.ts';

const BULLET_START =/^[・●■◆]\s*/;
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

// 段落として扱わない行（見出し・箇条書き・表・引用・HTML など）
const NON_PARAGRAPH_LINE = /^(?:#{1,6}\s|[-*+]\s|\d+[.)]\s|\||>|<|```|~~~|---\s*$|\*\*\*\s*$)/;

/**
 * プレビュー用に本文を整える。WordPress に投稿されるときと同じ段落の切れ目・空行で見えるようにする
 * 2026-11-13 投稿では段落が 2 文・100 字で分かれるのに、プレビューでは長い段落のまま表示されていた
 */
export function normalizeMarkdownForPreview(markdown: string): string {
  const lines = normalizeBulletsForPreview(markdown).split('\n');
  const output: string[] = [];
  let paragraph: string[] = [];
  let inCode = false;

  const flushParagraph = () => {
    if (paragraph.length === 0) return;
    // 日本語の行どうしは空白なしでつなぐ（英数字どうしのときだけ空白を入れる）。投稿側の renderBufferedBlock と同じ
    const merged = paragraph.reduce(
      (acc, line) => (acc && /[A-Za-z0-9]$/.test(acc) && /^[A-Za-z0-9]/.test(line) ? `${acc} ${line}` : acc + line),
      '',
    );
    const chunks = splitLongParagraphForReadability(merged);
    chunks.forEach((chunk, i) => {
      if (i > 0) output.push('');
      output.push(chunk);
    });
    paragraph = [];
  };

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (/^(```|~~~)/.test(line)) {
      flushParagraph();
      inCode = !inCode;
      output.push(rawLine);
      continue;
    }
    if (inCode) {
      output.push(rawLine);
      continue;
    }
    if (!line) {
      // 文の途中（「、」「・」で終わる行）の空行は段落の切れ目にしない（投稿側と同じ）
      if (/[、・，,]$/.test(paragraph[paragraph.length - 1] || '')) continue;
      flushParagraph();
      output.push('');
      continue;
    }
    if (NON_PARAGRAPH_LINE.test(line)) {
      flushParagraph();
      output.push(rawLine);
      continue;
    }
    paragraph.push(line);
  }
  flushParagraph();

  return output.join('\n');
}
