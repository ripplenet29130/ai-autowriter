import React, { useCallback, useEffect, useState } from 'react';
import { AlertCircle, BarChart3, CheckCircle2, Loader2 } from 'lucide-react';
import { ConnectGscButton } from './ConnectGscButton';
import { GscPropertyStatus, searchConsoleService } from '../../services/searchConsoleService';
import { useAppStore } from '../../store/useAppStore';

interface GscConnectionSummaryProps {
  wordpressConfigId: string;
}

const getErrorMessage = (error: unknown): string => {
  if (error instanceof Error) {
    return error.message;
  }

  return 'Search Consoleの状態を確認できませんでした';
};

export const GscConnectionSummary: React.FC<GscConnectionSummaryProps> = ({ wordpressConfigId }) => {
  const { setActiveView, setSelectedSeoReportConfigId } = useAppStore();
  const [status, setStatus] = useState<GscPropertyStatus | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const loadStatus = useCallback(async () => {
    setIsLoading(true);
    setErrorMessage(null);

    try {
      const result = await searchConsoleService.checkPropertyStatus(wordpressConfigId);
      setStatus(result);
      if (!result.verified) {
        setErrorMessage(result.error_message || '一致するSearch Consoleプロパティが見つかりませんでした');
      }
    } catch (error) {
      setErrorMessage(getErrorMessage(error));
      setStatus(null);
    } finally {
      setIsLoading(false);
    }
  }, [wordpressConfigId]);

  useEffect(() => {
    loadStatus();
  }, [loadStatus]);

  const openReport = () => {
    setSelectedSeoReportConfigId(wordpressConfigId);
    setActiveView('seo-report');
  };

  return (
    <div className="mt-4 rounded-lg border border-slate-200 bg-slate-50 p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2">
          {isLoading ? (
            <Loader2 className="h-4 w-4 animate-spin text-slate-500" />
          ) : status?.verified ? (
            <CheckCircle2 className="h-4 w-4 text-emerald-600" />
          ) : (
            <AlertCircle className="h-4 w-4 text-amber-600" />
          )}
          <span className="text-sm font-semibold text-slate-900">Search Console</span>
          <span
            className={`inline-flex items-center rounded-full px-2 py-1 text-xs font-medium ${
              status?.verified
                ? 'bg-emerald-100 text-emerald-700'
                : 'bg-slate-100 text-slate-600'
            }`}
          >
            {status?.verified ? '確認済み' : '未確認'}
          </span>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {!status?.verified && <ConnectGscButton />}
          {status?.verified && (
            <button
              type="button"
              onClick={openReport}
              className="inline-flex items-center gap-2 rounded-lg border border-blue-200 bg-white px-3 py-2 text-sm font-medium text-blue-700 transition-colors hover:bg-blue-50"
              title="SEOレポートを見る"
            >
              <BarChart3 className="h-4 w-4" />
              レポート
            </button>
          )}
        </div>
      </div>

      {errorMessage && (
        <p className="mt-2 text-xs text-amber-700">
          {errorMessage === 'Search Console property was not found for this WordPress URL.'
            ? 'このWordPress URLに一致するSearch Consoleプロパティが見つかりませんでした。'
            : errorMessage}
        </p>
      )}
    </div>
  );
};
