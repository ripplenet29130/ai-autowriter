import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertCircle,
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  BarChart3,
  CheckCircle2,
  Loader2,
  RefreshCw,
  Search,
} from 'lucide-react';
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { GscAnalyticsResponse, GscPropertyStatus, searchConsoleService } from '../services/searchConsoleService';
import { useAppStore } from '../store/useAppStore';
import { ConnectGscButton } from './SearchConsole/ConnectGscButton';

type ReportPeriod = 7 | 28 | 90;
type QuerySortKey = 'query' | 'clicks' | 'impressions' | 'ctr' | 'position';
type SortDirection = 'asc' | 'desc';

interface DateRange {
  startDate: string;
  endDate: string;
}

interface ChartRow {
  label: string;
  currentDate: string;
  previousDate: string;
  clicks: number;
  impressions: number;
  previousClicks: number;
  previousImpressions: number;
}

const PERIODS: ReportPeriod[] = [7, 28, 90];
const ONE_DAY_MS = 86400000;

const formatNumber = (value: number): string => new Intl.NumberFormat('ja-JP').format(Math.round(value));
const formatPercent = (value: number): string => `${(value * 100).toFixed(1)}%`;
const formatPosition = (value: number): string => (value > 0 ? value.toFixed(1) : '-');
const formatDate = (date: Date): string => date.toISOString().split('T')[0];

const addYears = (dateString: string, years: number): string => {
  const date = new Date(`${dateString}T00:00:00.000Z`);
  date.setUTCFullYear(date.getUTCFullYear() + years);
  return formatDate(date);
};

const getCurrentRange = (days: ReportPeriod): DateRange => {
  const endDate = new Date();
  const startDate = new Date(endDate.getTime() - (days - 1) * ONE_DAY_MS);
  return { startDate: formatDate(startDate), endDate: formatDate(endDate) };
};

const getPreviousYearRange = (range: DateRange): DateRange => ({
  startDate: addYears(range.startDate, -1),
  endDate: addYears(range.endDate, -1),
});

const formatChartDate = (value: string): string => {
  const [, month, day] = value.split('-');
  return month && day ? `${Number(month)}/${Number(day)}` : value;
};

const getErrorMessage = (error: unknown): string => {
  if (error instanceof Error) return error.message;
  return 'Search Consoleデータを取得できませんでした';
};

const buildComparisonChartRows = (
  current: GscAnalyticsResponse | null,
  previous: GscAnalyticsResponse | null,
): ChartRow[] => {
  const previousRows = previous?.rows ?? [];
  return (current?.rows ?? []).map((row, index) => {
    const previousRow = previousRows[index];
    return {
      label: formatChartDate(row.key),
      currentDate: row.key,
      previousDate: previousRow?.key ?? '',
      clicks: row.clicks,
      impressions: row.impressions,
      previousClicks: previousRow?.clicks ?? 0,
      previousImpressions: previousRow?.impressions ?? 0,
    };
  });
};

export const SEOReport: React.FC = () => {
  const { wordPressConfigs, selectedSeoReportConfigId, setSelectedSeoReportConfigId, setActiveView } = useAppStore();
  const [period, setPeriod] = useState<ReportPeriod>(28);
  const [status, setStatus] = useState<GscPropertyStatus | null>(null);
  const [dateAnalytics, setDateAnalytics] = useState<GscAnalyticsResponse | null>(null);
  const [previousDateAnalytics, setPreviousDateAnalytics] = useState<GscAnalyticsResponse | null>(null);
  const [queryAnalytics, setQueryAnalytics] = useState<GscAnalyticsResponse | null>(null);
  const [comparisonEnabled, setComparisonEnabled] = useState(false);
  const [querySort, setQuerySort] = useState<{ key: QuerySortKey; direction: SortDirection }>({
    key: 'clicks',
    direction: 'desc',
  });
  const [isLoading, setIsLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const selectedConfigId = useMemo(() => {
    if (selectedSeoReportConfigId && wordPressConfigs.some((config) => config.id === selectedSeoReportConfigId)) {
      return selectedSeoReportConfigId;
    }
    const activeConfig = wordPressConfigs.find((config) => config.isActive);
    return activeConfig?.id ?? wordPressConfigs[0]?.id ?? '';
  }, [selectedSeoReportConfigId, wordPressConfigs]);

  const currentRange = useMemo(() => getCurrentRange(period), [period]);
  const previousRange = useMemo(() => getPreviousYearRange(currentRange), [currentRange]);

  useEffect(() => {
    if (selectedConfigId && selectedConfigId !== selectedSeoReportConfigId) {
      setSelectedSeoReportConfigId(selectedConfigId);
    }
  }, [selectedConfigId, selectedSeoReportConfigId, setSelectedSeoReportConfigId]);

  const loadReport = useCallback(async () => {
    if (!selectedConfigId) return;
    setIsLoading(true);
    setErrorMessage(null);

    try {
      const nextStatus = await searchConsoleService.checkPropertyStatus(selectedConfigId);
      setStatus(nextStatus);

      if (!nextStatus.verified) {
        setDateAnalytics(null);
        setPreviousDateAnalytics(null);
        setQueryAnalytics(null);
        setErrorMessage(nextStatus.error_message || 'このサイトに一致するSearch Consoleプロパティが見つかりませんでした');
        return;
      }

      const [dateResult, previousDateResult, queryResult] = await Promise.all([
        searchConsoleService.fetchAnalytics(selectedConfigId, 'date', {
          startDate: currentRange.startDate,
          endDate: currentRange.endDate,
        }),
        comparisonEnabled
          ? searchConsoleService.fetchAnalytics(selectedConfigId, 'date', {
              startDate: previousRange.startDate,
              endDate: previousRange.endDate,
            })
          : Promise.resolve(null),
        searchConsoleService.fetchAnalytics(selectedConfigId, 'query', {
          startDate: currentRange.startDate,
          endDate: currentRange.endDate,
          rowLimit: 25,
        }),
      ]);

      setDateAnalytics(dateResult);
      setPreviousDateAnalytics(previousDateResult);
      setQueryAnalytics(queryResult);
    } catch (error) {
      setErrorMessage(getErrorMessage(error));
      setDateAnalytics(null);
      setPreviousDateAnalytics(null);
      setQueryAnalytics(null);
    } finally {
      setIsLoading(false);
    }
  }, [comparisonEnabled, currentRange.endDate, currentRange.startDate, previousRange.endDate, previousRange.startDate, selectedConfigId]);

  useEffect(() => {
    loadReport();
  }, [loadReport]);

  const summary = dateAnalytics?.summary;
  const previousSummary = comparisonEnabled ? previousDateAnalytics?.summary : undefined;
  const chartRows = buildComparisonChartRows(dateAnalytics, comparisonEnabled ? previousDateAnalytics : null);
  const topQueries = queryAnalytics?.rows ?? [];
  const sortedQueries = useMemo(() => {
    return [...topQueries].sort((a, b) => {
      const multiplier = querySort.direction === 'asc' ? 1 : -1;
      if (querySort.key === 'query') return a.key.localeCompare(b.key, 'ja') * multiplier;
      return ((a[querySort.key] ?? 0) - (b[querySort.key] ?? 0)) * multiplier;
    });
  }, [querySort.direction, querySort.key, topQueries]);

  const handleQuerySort = (key: QuerySortKey) => {
    setQuerySort((current) => ({
      key,
      direction: current.key === key && current.direction === 'desc' ? 'asc' : 'desc',
    }));
  };

  if (wordPressConfigs.length === 0) {
    return (
      <div className="rounded-lg border border-gray-200 bg-white p-8 text-center">
        <Search className="mx-auto mb-4 h-10 w-10 text-gray-400" />
        <h2 className="mb-2 text-xl font-bold text-gray-900">SEOレポート</h2>
        <p className="text-gray-600">先にWordPress接続を追加してください。</p>
        <button type="button" onClick={() => setActiveView('connections')} className="mt-5 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700">
          接続設定へ移動
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex items-center gap-3">
          <BarChart3 className="h-8 w-8 text-blue-600" />
          <div>
            <h2 className="text-2xl font-bold text-gray-900">SEOレポート</h2>
            <p className="text-gray-600">Search Consoleの検索パフォーマンスをサイト別に確認します。</p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <ConnectGscButton />
          <button type="button" onClick={loadReport} disabled={isLoading} className="inline-flex items-center gap-2 rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-60">
            {isLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
            更新
          </button>
        </div>
      </div>

      <section className="rounded-lg border border-gray-200 bg-white p-5">
        <div className="grid gap-4 lg:grid-cols-[1fr_auto] lg:items-end">
          <div>
            <label className="mb-2 block text-sm font-medium text-gray-700" htmlFor="seo-report-site">
              対象サイト
            </label>
            <select id="seo-report-site" value={selectedConfigId} onChange={(event) => setSelectedSeoReportConfigId(event.target.value)} className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100">
              {wordPressConfigs.map((config) => (
                <option key={config.id} value={config.id}>
                  {config.name} - {config.url}
                </option>
              ))}
            </select>
          </div>
          <div>
            <div className="mb-2 text-sm font-medium text-gray-700">期間</div>
            <div className="flex rounded-lg border border-gray-300 bg-gray-50 p-1">
              {PERIODS.map((days) => (
                <button key={days} type="button" onClick={() => setPeriod(days)} className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${period === days ? 'bg-white text-blue-700 shadow-sm' : 'text-gray-600 hover:text-gray-900'}`}>
                  {days}日
                </button>
              ))}
            </div>
            <p className="mt-2 text-xs text-gray-500">
              {currentRange.startDate} - {currentRange.endDate}
            </p>
          </div>
        </div>
        <div className="mt-4 flex flex-wrap items-center gap-2">
          {status?.verified ? (
            <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2.5 py-1 text-xs font-medium text-emerald-700">
              <CheckCircle2 className="h-3.5 w-3.5" />
              Search Console確認済み
            </span>
          ) : (
            <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2.5 py-1 text-xs font-medium text-slate-600">
              Search Console未確認
            </span>
          )}
        </div>
      </section>

      {errorMessage && (
        <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{errorMessage}</span>
        </div>
      )}

      {isLoading && !summary && (
        <div className="flex items-center gap-2 rounded-lg border border-gray-200 bg-white p-5 text-sm text-gray-500">
          <Loader2 className="h-4 w-4 animate-spin" />
          Search Consoleデータを読み込んでいます
        </div>
      )}

      {summary && (
        <>
          <section className="grid gap-4 md:grid-cols-4">
            <MetricCard label="クリック" value={formatNumber(summary.clicks)} previousValue={comparisonEnabled && previousSummary ? formatNumber(previousSummary.clicks) : undefined} change={comparisonEnabled ? getRateChange(summary.clicks, previousSummary?.clicks) : null} />
            <MetricCard label="表示回数" value={formatNumber(summary.impressions)} previousValue={comparisonEnabled && previousSummary ? formatNumber(previousSummary.impressions) : undefined} change={comparisonEnabled ? getRateChange(summary.impressions, previousSummary?.impressions) : null} />
            <MetricCard label="CTR" value={formatPercent(summary.ctr)} previousValue={comparisonEnabled && previousSummary ? formatPercent(previousSummary.ctr) : undefined} change={comparisonEnabled ? getPointChange(summary.ctr, previousSummary?.ctr, 'pp') : null} />
            <MetricCard label="平均順位" value={formatPosition(summary.position)} previousValue={comparisonEnabled && previousSummary ? formatPosition(previousSummary.position) : undefined} change={comparisonEnabled ? getPositionChange(summary.position, previousSummary?.position) : null} />
          </section>

          <div className="flex flex-col items-end gap-1">
            <button type="button" onClick={() => setComparisonEnabled((enabled) => !enabled)} className={`inline-flex items-center gap-2 rounded-lg border px-3 py-2 text-sm font-medium transition-colors ${comparisonEnabled ? 'border-blue-200 bg-blue-50 text-blue-700' : 'border-gray-300 bg-white text-gray-700 hover:bg-gray-50'}`}>
              <BarChart3 className="h-4 w-4" />
              前年同期間比較 {comparisonEnabled ? 'ON' : 'OFF'}
            </button>
            {comparisonEnabled && (
              <p className="text-right text-xs text-gray-500">
                {currentRange.startDate} - {currentRange.endDate} / 前年同期間: {previousRange.startDate} - {previousRange.endDate}
              </p>
            )}
          </div>

          <section className="rounded-lg border border-gray-200 bg-white p-5">
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
              <div>
                <h3 className="text-lg font-semibold text-gray-900">日別推移</h3>
                <p className="text-sm text-gray-500">
                  {comparisonEnabled ? `過去${period}日と前年同期間のクリック数・表示回数` : `過去${period}日のクリック数・表示回数`}
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-3 text-xs text-gray-500">
                <LegendDot color="bg-blue-600" label="クリック" />
                {comparisonEnabled && <LegendDot color="bg-blue-300" label="前年クリック" dashed />}
                <LegendDot color="bg-green-600" label="表示回数" />
                {comparisonEnabled && <LegendDot color="bg-green-300" label="前年表示回数" dashed />}
              </div>
            </div>
            {chartRows.length > 0 ? (
              <div className="h-72 w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={chartRows} margin={{ top: 10, right: 20, left: 0, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                    <XAxis dataKey="label" tick={{ fill: '#64748b', fontSize: 12 }} tickLine={false} axisLine={{ stroke: '#cbd5e1' }} />
                    <YAxis yAxisId="clicks" tick={{ fill: '#64748b', fontSize: 12 }} tickLine={false} axisLine={false} allowDecimals={false} />
                    <YAxis yAxisId="impressions" orientation="right" tick={{ fill: '#64748b', fontSize: 12 }} tickLine={false} axisLine={false} allowDecimals={false} />
                    <Tooltip
                      labelFormatter={(_, payload) => {
                        const item = payload?.[0]?.payload as ChartRow | undefined;
                        if (!item) return '';
                        return comparisonEnabled ? `${item.currentDate} / 前年: ${item.previousDate}` : item.currentDate;
                      }}
                      formatter={(value, name) => [formatNumber(Number(value)), getChartLabel(String(name))]}
                    />
                    <Line yAxisId="clicks" type="monotone" dataKey="clicks" name="clicks" stroke="#2563eb" strokeWidth={2} dot={false} activeDot={{ r: 4 }} />
                    {comparisonEnabled && <Line yAxisId="clicks" type="monotone" dataKey="previousClicks" name="previousClicks" stroke="#93c5fd" strokeWidth={2} strokeDasharray="5 5" dot={false} activeDot={{ r: 4 }} />}
                    <Line yAxisId="impressions" type="monotone" dataKey="impressions" name="impressions" stroke="#16a34a" strokeWidth={2} dot={false} activeDot={{ r: 4 }} />
                    {comparisonEnabled && <Line yAxisId="impressions" type="monotone" dataKey="previousImpressions" name="previousImpressions" stroke="#86efac" strokeWidth={2} strokeDasharray="5 5" dot={false} activeDot={{ r: 4 }} />}
                  </LineChart>
                </ResponsiveContainer>
              </div>
            ) : (
              <p className="rounded-lg border border-gray-100 bg-gray-50 px-4 py-6 text-center text-sm text-gray-500">
                この期間の日別データはまだありません。
              </p>
            )}
          </section>

          <section className="rounded-lg border border-gray-200 bg-white">
            <div className="flex items-center justify-between border-b border-gray-100 px-5 py-4">
              <div>
                <h3 className="text-lg font-semibold text-gray-900">上位クエリ</h3>
                <p className="text-sm text-gray-500">過去{period}日の検索クエリ</p>
              </div>
            </div>
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-gray-100 text-sm">
                <thead className="bg-gray-50 text-left text-xs font-semibold text-gray-500">
                  <tr>
                    <SortableHeader label="クエリ" sortKey="query" activeSort={querySort} onSort={handleQuerySort} />
                    <SortableHeader label="クリック" sortKey="clicks" activeSort={querySort} onSort={handleQuerySort} align="right" />
                    <SortableHeader label="表示回数" sortKey="impressions" activeSort={querySort} onSort={handleQuerySort} align="right" />
                    <SortableHeader label="CTR" sortKey="ctr" activeSort={querySort} onSort={handleQuerySort} align="right" />
                    <SortableHeader label="平均順位" sortKey="position" activeSort={querySort} onSort={handleQuerySort} align="right" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100 bg-white">
                  {sortedQueries.length > 0 ? (
                    sortedQueries.map((row) => (
                      <tr key={row.key}>
                        <td className="max-w-[360px] truncate px-5 py-3 font-medium text-gray-900">{row.key || '(not set)'}</td>
                        <td className="px-5 py-3 text-right text-gray-700">{formatNumber(row.clicks)}</td>
                        <td className="px-5 py-3 text-right text-gray-700">{formatNumber(row.impressions)}</td>
                        <td className="px-5 py-3 text-right text-gray-700">{formatPercent(row.ctr)}</td>
                        <td className="px-5 py-3 text-right text-gray-700">{formatPosition(row.position)}</td>
                      </tr>
                    ))
                  ) : (
                    <tr>
                      <td className="px-5 py-6 text-center text-gray-500" colSpan={5}>
                        この期間のクエリデータはまだありません。
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </section>
        </>
      )}
    </div>
  );
};

const getRateChange = (current: number, previous?: number): { label: string; isPositive: boolean } | null => {
  if (!previous) return null;
  const rate = ((current - previous) / previous) * 100;
  return { label: `${rate >= 0 ? '+' : ''}${rate.toFixed(1)}%`, isPositive: rate >= 0 };
};

const getPointChange = (current: number, previous: number | undefined, unit: 'pp'): { label: string; isPositive: boolean } | null => {
  if (previous === undefined) return null;
  const point = (current - previous) * 100;
  return { label: `${point >= 0 ? '+' : ''}${point.toFixed(1)}${unit}`, isPositive: point >= 0 };
};

const getPositionChange = (current: number, previous?: number): { label: string; isPositive: boolean } | null => {
  if (!previous || !current) return null;
  const diff = current - previous;
  return { label: `${diff >= 0 ? '+' : ''}${diff.toFixed(1)}`, isPositive: diff <= 0 };
};

const getChartLabel = (name: string): string => {
  switch (name) {
    case 'clicks':
      return 'クリック';
    case 'previousClicks':
      return '前年クリック';
    case 'impressions':
      return '表示回数';
    case 'previousImpressions':
      return '前年表示回数';
    default:
      return name;
  }
};

const SortableHeader: React.FC<{
  label: string;
  sortKey: QuerySortKey;
  activeSort: { key: QuerySortKey; direction: SortDirection };
  onSort: (key: QuerySortKey) => void;
  align?: 'left' | 'right';
}> = ({ label, sortKey, activeSort, onSort, align = 'left' }) => {
  const isActive = activeSort.key === sortKey;
  const Icon = !isActive ? ArrowUpDown : activeSort.direction === 'asc' ? ArrowUp : ArrowDown;
  return (
    <th className={`px-5 py-3 ${align === 'right' ? 'text-right' : 'text-left'}`}>
      <button type="button" onClick={() => onSort(sortKey)} className={`inline-flex items-center gap-1.5 rounded text-xs font-semibold transition-colors hover:text-blue-700 ${align === 'right' ? 'justify-end' : 'justify-start'} ${isActive ? 'text-blue-700' : 'text-gray-500'}`}>
        <span>{label}</span>
        <Icon className="h-3.5 w-3.5" />
      </button>
    </th>
  );
};

const MetricCard: React.FC<{
  label: string;
  value: string;
  previousValue?: string;
  change: { label: string; isPositive: boolean } | null;
}> = ({ label, value, previousValue, change }) => (
  <div className="rounded-lg border border-gray-200 bg-white p-5">
    <div className="flex items-start justify-between gap-2">
      <p className="text-sm font-medium text-gray-500">{label}</p>
      {change && (
        <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${change.isPositive ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-700'}`}>
          {change.label}
        </span>
      )}
    </div>
    <p className="mt-2 text-2xl font-bold text-gray-900">{value}</p>
    {previousValue && <p className="mt-1 text-xs text-gray-500">前年同期間: {previousValue}</p>}
  </div>
);

const LegendDot: React.FC<{ color: string; label: string; dashed?: boolean }> = ({ color, label, dashed }) => (
  <span className="inline-flex items-center gap-1.5">
    <span className={`h-0.5 w-5 ${color} ${dashed ? 'border-t border-dashed border-current bg-transparent' : ''}`} />
    {label}
  </span>
);
