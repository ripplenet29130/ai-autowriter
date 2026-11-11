// 本文ができた後の整形（今の自動投稿の処理と同じ順番）。両方の流れで同じものを使う
import {
  countGeneratedChars,
  formatArticleBodyForReadability,
  insertSubheadingsIntoLongSections,
} from '../../../src/shared/articleGenerationCore.ts';
import {
  appendReferencesSection,
  buildReferencesMarkdown,
  hasUsableFacts,
  selectReferenceSources,
  type FactSheet,
} from '../../../src/shared/factSheetCore.ts';
import { hasCorrectionArtifacts } from '../../../src/shared/geminiFactCheck.ts';
import {
  countNonSummaryHeadings,
  normalizeGeneratedContentForPublishing,
} from '../../../supabase/functions/scheduler-executor/_content-format.ts';
import {
  compactArticleToTargetLength,
  validateGeneratedArticleCompleteness,
} from '../../../supabase/functions/scheduler-executor/_generation.ts';
import { errorMessage } from './env.ts';

// 本文生成の直後（見直し・検証の前）の整形。
// 本番では index.ts 内の cleanupContentArtifacts も使うが、外から呼べないため公開前の正規化で代用する
export function cleanupGenerated(content: string, title: string, targetWordCount: number): string {
  const normalized = normalizeGeneratedContentForPublishing(content, title);
  return insertSubheadingsIntoLongSections(normalized, targetWordCount);
}

export function finalizeArticle(params: {
  content: string;
  baseContent: string;
  title: string;
  targetWordCount: number;
  outline: any;
  factSheet: FactSheet | null;
}): { content: string; referencesCount: number; draftReasons: string[]; warnings: string[] } {
  const draftReasons: string[] = [];
  const warnings: string[] = [];
  let content = params.content.replace(/\[\[(.+?)\]\]/g, '$1');
  content = formatArticleBodyForReadability(normalizeGeneratedContentForPublishing(content, params.title));

  // 見出しが減りすぎたら生成直後の構成に戻す（本番と同じ）
  const baseline = normalizeGeneratedContentForPublishing(params.baseContent, params.title);
  const baselineHeadings = countNonSummaryHeadings(baseline);
  if (baselineHeadings >= 2 && countNonSummaryHeadings(content) < Math.max(2, baselineHeadings - 1)) {
    warnings.push('見出しが減りすぎたため、生成直後の本文に戻しました');
    content = baseline;
  }

  const before = countGeneratedChars(content);
  content = formatArticleBodyForReadability(compactArticleToTargetLength(content, params.targetWordCount));
  const after = countGeneratedChars(content);
  if (after < before) warnings.push(`文字数を調整しました（${before} → ${after}）`);

  try {
    validateGeneratedArticleCompleteness(content, params.outline, params.targetWordCount);
  } catch (error) {
    // 本番では失敗扱いになる
    warnings.push(`本番では失敗扱いになる状態です: ${errorMessage(error)}`);
  }

  if (hasCorrectionArtifacts(content)) {
    draftReasons.push('自動修正の注記（「修正:」など）が本文に残っています');
  }

  let referencesCount = 0;
  if (hasUsableFacts(params.factSheet)) {
    const refs = buildReferencesMarkdown(params.factSheet);
    if (refs) {
      content = appendReferencesSection(content, refs);
      referencesCount = selectReferenceSources(params.factSheet).length;
    }
  }
  return { content, referencesCount, draftReasons, warnings };
}
