import type { FactCheckResult } from '../../../src/shared/factCheckCore.ts';
import type { FactSheet } from '../../../src/shared/factSheetCore.ts';
import type { AiUsageSummary } from '../../../src/shared/aiUsage.ts';
import type { OpenAiUsage } from './openai.ts';

export type FlowName = 'current' | 'v2';

export interface FlowResult {
  name: FlowName;
  label: string;
  keyword: string;
  title: string;
  content: string;
  outline: any;
  // 調査の結果（今の流れ: SerpAPI の競合記事、新しい流れ: AI 検索の調査結果）
  research: any;
  relatedKeywords: string[];
  competitorHeadings: string[];
  factSheet: FactSheet | null;
  factSheetNote: string;
  editorialReview: string;
  factCheck: {
    verifier: string;
    executed: boolean;
    results: FactCheckResult[];
    rounds: number;
    autoFixApplied: boolean;
    overall?: { rating: string; summary: string };
    note: string;
  };
  writerModel: string;
  draftReasons: string[];
  warnings: string[];
  notes: string[];
  skippedSteps: string[];
  referencesCount: number;
  steps: Array<{ name: string; ms: number; note?: string }>;
  totalMs: number;
  usage: {
    gemini: AiUsageSummary | null;
    openai: OpenAiUsage | null;
    serpapiCalls: number;
    customSearchCalls: number;
  };
  error?: string;
}
