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

export function normalizeSharedTone(tone?: string): SharedTone {
  return tone === 'casual' ? 'casual' : 'professional';
}

export function formatSharedTone(tone?: string): string {
  return normalizeSharedTone(tone) === 'casual' ? 'カジュアル' : 'プロフェッショナル（ビジネス）';
}

export function getSharedToneDescription(tone?: string): string {
  const normalized = normalizeSharedTone(tone);
  return sharedToneOptions.find((option) => option.value === normalized)?.description || sharedToneOptions[0].description;
}
