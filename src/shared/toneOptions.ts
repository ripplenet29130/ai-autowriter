export type SharedTone = 'professional' | 'casual';

export const sharedToneOptions: Array<{ value: SharedTone; label: string; description: string }> = [
  {
    value: 'professional',
    label: 'プロフェッショナル（ビジネス）',
    description: '専門性は保ちつつ、読者からの相談に答えるように自然に説明します。',
  },
  {
    value: 'casual',
    label: 'カジュアル',
    description: '読みやすく親しみやすい文体。読者に近い距離感で、やわらかく説明します。',
  },
];

// カジュアル文体で書くときの AI への指示（記事生成のすべての経路で共通）
// 2026-11-13 以前の指示は「やわらかく親しみやすい です・ます調」程度で、ビジネス文体とほとんど差が出なかった
// 読者への話しかけ（「〜ですよね」「〜しましょう」など）は入れない方針
export const CASUAL_TONE_INSTRUCTION = [
  'やわらかく読みやすい です・ます調で書く（くだけすぎない。話し言葉や読者への話しかけ・問いかけは使わない）',
  '硬い漢語や業界用語は、意味が変わらない範囲でやさしい言葉に言い換える（例: 「推定する」→「見当をつける」、「導入する」→「取り入れる」、「留意する」→「気をつける」）。専門用語を使うときは短く言い添える',
  '抽象的な説明だけで終わらせず、身近なたとえや具体的な場面を段落にときどき添える',
  '見出しは「〜の方法」「〜と条件」のような資料風の硬い名詞止めを避け、「〜を知るには」「〜で気をつけたいこと」「〜のコツ」のような分かりやすい言い方にする',
].join('。');

export function normalizeSharedTone(tone?: string): SharedTone {
  // 2026-11-13 文体が未設定のときはカジュアルを既定にする（保存済みの「プロフェッショナル」はそのまま）
  return tone === 'professional' || tone === 'technical' || tone === 'da_dearu' ? 'professional' : 'casual';
}

export function formatSharedTone(tone?: string): string {
  return normalizeSharedTone(tone) === 'casual' ? 'カジュアル' : 'プロフェッショナル（ビジネス）';
}

export function getSharedToneDescription(tone?: string): string {
  const normalized = normalizeSharedTone(tone);
  return sharedToneOptions.find((option) => option.value === normalized)?.description || sharedToneOptions[0].description;
}
