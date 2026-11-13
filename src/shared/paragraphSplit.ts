// 長い段落を読みやすい長さに分ける（WordPress 投稿の 2 つの経路で共通）
// スケジューラー投稿: scheduler-executor/_content-format.ts
// レビュー画面からの投稿: review-wordpress-publish/_gutenberg.ts
export function splitLongParagraphForReadability(text: string): string[] {
  const normalized = String(text || '').replace(/\s+/g, ' ').trim();
  if (!normalized) return [];

  const sentences = normalized
    .split(/(?<=[。！？!?])\s*/g)
    .map((s) => s.trim())
    .filter(Boolean);

  if (sentences.length <= 1) return [normalized];

  // 2026-11-13 段落が長くて読みにくいとの声。1 段落は 2 文・100 字までを目安に切る（以前は 140 字・最大 200 字）
  const MAX_PARAGRAPH_CHARS = 100;
  const chunks: string[] = [];
  let buffer: string[] = [];
  let charCount = 0;

  for (const sentence of sentences) {
    // 次の文を足すと長くなりすぎるときは、先に段落を切る
    if (buffer.length > 0 && charCount + sentence.length > MAX_PARAGRAPH_CHARS) {
      chunks.push(buffer.join(''));
      buffer = [];
      charCount = 0;
    }
    buffer.push(sentence);
    charCount += sentence.length;

    if (buffer.length >= 2 || charCount >= MAX_PARAGRAPH_CHARS) {
      chunks.push(buffer.join(''));
      buffer = [];
      charCount = 0;
    }
  }

  if (buffer.length > 0) {
    const rest = buffer.join('');
    // 最後に 1 文だけ残ったときは、短ければ前の段落につなげる（1 文だけの段落を作らない）
    const prev = chunks[chunks.length - 1];
    if (buffer.length === 1 && prev && prev.length + rest.length <= MAX_PARAGRAPH_CHARS) {
      chunks[chunks.length - 1] = prev + rest;
    } else {
      chunks.push(rest);
    }
  }

  return chunks.length > 0 ? chunks : [normalized];
}
