import React, { useState } from 'react';
import { AlertTriangle, ChevronDown, ChevronUp, Sparkles } from 'lucide-react';
import { Article } from '../../types';
import { countCriticalIssues, hasCorrectionArtifacts } from '../../shared/geminiFactCheck';
import { formatLengthPlanLabel } from '../../shared/articleLengthPlan';
import { CRITIQUE_ISSUE_TYPES, summarizeCritique } from '../../shared/editorialReviewCore';
import { countGeneratedChars } from '../../shared/articleGenerationCore';

interface ArticleQualityCardProps {
  article: Article;
}

// 段落単位で、見直しで変わった部分だけを並べる（簡易な差分表示）
function buildParagraphDiff(before: string, after: string): Array<{ before: string; after: string }> {
  const split = (text: string) => text.split(/\n{2,}/).map((p) => p.trim()).filter(Boolean);
  const beforeParagraphs = split(before);
  const afterParagraphs = split(after);
  const afterSet = new Set(afterParagraphs);
  const beforeSet = new Set(beforeParagraphs);
  const removed = beforeParagraphs.filter((p) => !afterSet.has(p));
  const added = afterParagraphs.filter((p) => !beforeSet.has(p));
  const rows: Array<{ before: string; after: string }> = [];
  const length = Math.max(removed.length, added.length);
  for (let i = 0; i < length; i++) {
    rows.push({ before: removed[i] || '', after: added[i] || '' });
  }
  return rows;
}

// 手動生成の結果: 執筆モデル・見直し・参考資料と、投稿前の注意
export const ArticleQualityCard: React.FC<ArticleQualityCardProps> = ({ article }) => {
  const [showDiff, setShowDiff] = useState(false);
  const info = article.qualityInfo;
  const criticalCount = countCriticalIssues(article.factCheckResults || []);
  const hasArtifacts = hasCorrectionArtifacts(article.content);

  if (!info && criticalCount === 0 && !hasArtifacts) return null;

  const review = info?.editorialReview;
  const diffRows = review?.accepted && review.before ? buildParagraphDiff(review.before, article.content) : [];

  return (
    <div className="mx-auto mb-8 max-w-xl space-y-3 rounded-2xl border border-gray-100 bg-white p-5 text-left">
      {info && (
        <>
          <div className="flex items-center gap-2 text-sm font-bold text-gray-900">
            <Sparkles className="h-4 w-4 text-purple-600" />
            品質の確認
          </div>
          <dl className="grid grid-cols-1 gap-x-4 gap-y-1 text-xs text-gray-600 sm:grid-cols-2">
            <div>
              <dt className="inline text-gray-400">品質モード: </dt>
              <dd className="inline">{info.qualityMode === 'high' ? '高品質' : '標準'}</dd>
            </div>
            <div>
              <dt className="inline text-gray-400">執筆モデル: </dt>
              <dd className="inline">{info.writerModel}{info.proFallback ? '（Flashで代替）' : ''}</dd>
            </div>
            <div>
              <dt className="inline text-gray-400">見直し: </dt>
              <dd className="inline">{review?.status || '未実行'}</dd>
            </div>
            <div>
              <dt className="inline text-gray-400">参考資料: </dt>
              <dd className="inline">{info.referencesCount > 0 ? `${info.referencesCount}件` : 'なし'}</dd>
            </div>
            {info.lengthPlan && (
              <div className="sm:col-span-2">
                <dt className="inline text-gray-400">文字数: </dt>
                <dd className="inline">
                  {formatLengthPlanLabel(info.lengthPlan)} → 完成 {countGeneratedChars(article.content)}字
                </dd>
              </div>
            )}
            {typeof info.estimatedCostJpy === 'number' && (
              <div className="sm:col-span-2">
                <dt className="inline text-gray-400">推定費用（有料キー換算）: </dt>
                <dd className="inline">約{Math.max(1, info.estimatedCostJpy)}円</dd>
              </div>
            )}
          </dl>
          {review?.critique && review.critique.issues.length > 0 && (
            <div className="rounded-lg bg-gray-50 p-3 text-xs text-gray-700">
              <p className="mb-1 font-semibold">見直しの批評: {summarizeCritique(review.critique)}</p>
              {review.critique.summary && <p className="mb-2 text-gray-500">{review.critique.summary}</p>}
              <ol className="list-inside list-decimal space-y-1">
                {review.critique.issues.map((issue, index) => (
                  <li key={index}>
                    <span className="font-medium">[{CRITIQUE_ISSUE_TYPES[issue.type]}] {issue.section}:</span> {issue.problem}
                    {issue.fix && <span className="text-gray-500"> → {issue.fix}</span>}
                  </li>
                ))}
              </ol>
              <p className="mt-2 text-gray-400">
                {review.accepted ? 'この指摘をもとに書き直した本文を採用しています。' : '書き直しは採用されなかったため、指摘は本文に反映されていません。'}
              </p>
            </div>
          )}
          {info.notes.length > 0 && (
            <ul className="list-inside list-disc text-xs text-gray-500">
              {info.notes.map((note) => <li key={note}>{note}</li>)}
            </ul>
          )}
          {diffRows.length > 0 && (
            <div>
              <button
                type="button"
                onClick={() => setShowDiff((v) => !v)}
                className="flex items-center gap-1 text-xs font-semibold text-blue-600 hover:underline"
              >
                {showDiff ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
                見直しで変わった段落を見る（{diffRows.length}か所）
              </button>
              {showDiff && (
                <div className="mt-2 max-h-80 space-y-2 overflow-y-auto">
                  {diffRows.map((row, index) => (
                    <div key={index} className="grid grid-cols-1 gap-2 text-xs sm:grid-cols-2">
                      <p className="whitespace-pre-wrap rounded bg-red-50 p-2 text-red-900">{row.before || '（なし）'}</p>
                      <p className="whitespace-pre-wrap rounded bg-green-50 p-2 text-green-900">{row.after || '（削除）'}</p>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </>
      )}

      {(criticalCount > 0 || hasArtifacts) && (
        <div className="flex items-start gap-2 rounded-lg bg-amber-50 p-3 text-xs text-amber-800">
          <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0" />
          <div>
            <p className="font-semibold">投稿前に確認してください</p>
            {criticalCount > 0 && <p>ファクトチェックで重大な誤りが{criticalCount}件残っています。</p>}
            {hasArtifacts && <p>本文に自動修正の注記（「修正:」など）が残っています。</p>}
            <p>公開ではなく下書きで保存することをおすすめします。</p>
          </div>
        </div>
      )}
    </div>
  );
};
