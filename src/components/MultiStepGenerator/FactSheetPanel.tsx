import React from 'react';
import { AlertTriangle, BookOpen, ExternalLink, Loader2, RefreshCw } from 'lucide-react';
import { TrendAnalysisResult } from '../../types';

interface FactSheetPanelProps {
  trendData: TrendAnalysisResult;
  onToggleFact?: (factId: string) => void;
  onRebuild?: () => void;
  isRebuilding?: boolean;
}

const hostnameOf = (url: string): string => {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
};

// 根拠メモ（Google 検索で集めた事実と出典）。チェックを外した事実は本文に使わない。
export const FactSheetPanel: React.FC<FactSheetPanelProps> = ({ trendData, onToggleFact, onRebuild, isRebuilding }) => {
  const sheet = trendData.factSheet;
  const error = trendData.factSheetError;

  // Gemini 以外で生成している場合は根拠メモを作らない
  if (!sheet && !error) return null;

  const excluded = new Set(trendData.excludedFactIds || []);
  const sourceById = new Map((sheet?.sources || []).map((source) => [source.id, source]));
  const usable = Boolean(sheet && sheet.searchUsed && sheet.facts.length > 0);

  return (
    <div className="rounded-xl border border-emerald-200 bg-white p-5 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h4 className="flex items-center gap-2 text-base font-bold text-gray-900">
            <BookOpen className="h-5 w-5 text-emerald-600" />
            根拠メモ
            {usable && (
              <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-semibold text-emerald-700">
                {sheet!.facts.length - excluded.size} / {sheet!.facts.length}件を使用
              </span>
            )}
          </h4>
          <p className="mt-1 text-xs text-gray-500">
            Google 検索で確認した事実です。本文の数字・制度・日付はここにあるものだけを使います。使わない事実はチェックを外してください。
          </p>
        </div>
        {onRebuild && (
          <button
            type="button"
            onClick={onRebuild}
            disabled={isRebuilding}
            className="flex items-center gap-1.5 rounded-lg border border-gray-200 px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
          >
            {isRebuilding ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
            {isRebuilding ? '作成中...' : '作り直す'}
          </button>
        )}
      </div>

      {error && (
        <div className="mt-3 flex items-start gap-2 rounded-lg bg-amber-50 p-3 text-xs text-amber-800">
          <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0" />
          <span>{error}。根拠メモなしでも記事は作成できますが、数字や制度の正確さは下がります。</span>
        </div>
      )}

      {sheet && sheet.facts.length > 0 && (
        <ul className="mt-4 space-y-2">
          {sheet.facts.map((fact) => {
            const checked = !excluded.has(fact.id);
            const sources = fact.sourceIds
              .map((id) => sourceById.get(id))
              .filter((source): source is NonNullable<typeof source> => Boolean(source && source.url));
            return (
              <li key={fact.id} className={`flex items-start gap-3 rounded-lg border p-3 ${checked ? 'border-gray-200' : 'border-gray-100 bg-gray-50 opacity-60'}`}>
                <input
                  type="checkbox"
                  checked={checked}
                  disabled={!onToggleFact || !usable}
                  onChange={() => onToggleFact?.(fact.id)}
                  className="mt-0.5 h-4 w-4 flex-shrink-0"
                  aria-label={`${fact.id} を本文に使う`}
                />
                <div className="min-w-0 flex-1">
                  <p className="text-sm text-gray-800">
                    <span className="mr-1.5 font-mono text-xs text-gray-400">{fact.id}</span>
                    {fact.statement}
                    {fact.asOf && <span className="ml-1 text-xs text-gray-500">（{fact.asOf}）</span>}
                  </p>
                  {sources.length > 0 && (
                    <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1">
                      {sources.map((source) => (
                        <a
                          key={source.id}
                          href={source.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="flex items-center gap-1 text-xs text-blue-600 hover:underline"
                        >
                          {source.title || hostnameOf(source.url)}
                          <ExternalLink className="h-3 w-3" />
                        </a>
                      ))}
                    </div>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {sheet && sheet.cautions.length > 0 && (
        <div className="mt-4 rounded-lg bg-gray-50 p-3">
          <p className="text-xs font-semibold text-gray-700">注意点（本文では断定しません）</p>
          <ul className="mt-1 list-inside list-disc space-y-0.5 text-xs text-gray-600">
            {sheet.cautions.map((caution) => <li key={caution}>{caution}</li>)}
          </ul>
        </div>
      )}
    </div>
  );
};
