import React, { useEffect, useState } from 'react';
import {
  FileText,
  Calendar,
  CheckCircle,
  Clock,
  Globe,
  Tag,
  Power
} from 'lucide-react';
import { useAppStore } from '../store/useAppStore';
import { articlesService } from '../services/articlesService';
import { scheduleService } from '../services/scheduleService';
import { supabaseSchedulerService } from '../services/supabaseSchedulerService';
import { ScheduleSetting } from '../types';
import { format } from 'date-fns';
import { ja } from 'date-fns/locale';

type ScheduleWithNext = ScheduleSetting & {
  nextExecution: Date | null;
  lastExecutionAt: string | null;
};

type ExecutionCostHistoryItem = {
  id: string;
  executed_at: string;
  article_title: string | null;
  status: string | null;
  estimated_cost_usd?: number | string | null;
  cost_breakdown?: any;
  wordpress_configs?: { name?: string; url?: string } | null;
};

const USD_TO_JPY_RATE = 150;

const toJpy = (usd: number) => usd * USD_TO_JPY_RATE;

const formatJpy = (value: number) =>
  new Intl.NumberFormat('ja-JP', {
    style: 'currency',
    currency: 'JPY',
    maximumFractionDigits: 0
  }).format(value);

const getNextExecutionDate = (schedule: ScheduleSetting): Date | null => {
  if (!schedule.status || !schedule.post_time) return null;

  const [hourStr, minuteStr] = schedule.post_time.split(':');
  const hour = Number(hourStr);
  const minute = Number(minuteStr);
  if (!Number.isFinite(hour) || !Number.isFinite(minute)) return null;

  const now = new Date();
  const startAt = schedule.start_date
    ? new Date(`${schedule.start_date}T${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}:00`)
    : null;
  const endAt = schedule.end_date ? new Date(`${schedule.end_date}T23:59:59`) : null;

  const normalizedFrequency = schedule.frequency === '毎日' ? 'daily'
    : schedule.frequency === '毎週' ? 'weekly'
      : schedule.frequency === '隔週' ? 'biweekly'
        : schedule.frequency === '毎月' ? 'monthly'
          : schedule.frequency;

  const buildDateAtTime = (base: Date): Date => {
    const d = new Date(base);
    d.setHours(hour, minute, 0, 0);
    return d;
  };

  const addDays = (base: Date, days: number): Date => {
    const d = new Date(base);
    d.setDate(d.getDate() + days);
    return d;
  };

  const addMonths = (base: Date, months: number): Date => {
    const d = new Date(base);
    d.setMonth(d.getMonth() + months);
    return d;
  };

  let next = buildDateAtTime(now);

  if (normalizedFrequency === 'daily') {
    if (next <= now) next = addDays(next, 1);
    if (startAt && next < startAt) next = new Date(startAt);
  } else if (normalizedFrequency === 'weekly' || normalizedFrequency === 'biweekly') {
    const intervalDays = normalizedFrequency === 'weekly' ? 7 : 14;
    next = startAt ? new Date(startAt) : buildDateAtTime(now);
    if (next <= now) {
      for (let i = 0; i < 1000 && next <= now; i += 1) {
        next = addDays(next, intervalDays);
      }
    }
  } else if (normalizedFrequency === 'monthly') {
    next = startAt ? new Date(startAt) : buildDateAtTime(now);
    if (next <= now) {
      for (let i = 0; i < 240 && next <= now; i += 1) {
        next = addMonths(next, 1);
      }
    }
  } else {
    if (next <= now) next = addDays(next, 1);
    if (startAt && next < startAt) next = new Date(startAt);
  }

  if (endAt && next > endAt) return null;
  return next;
};

const getScheduledExecutionForDate = (schedule: ScheduleSetting, targetDate: Date): Date | null => {
  if (!schedule.status || !schedule.post_time) return null;

  const [hourStr, minuteStr] = schedule.post_time.split(':');
  const hour = Number(hourStr);
  const minute = Number(minuteStr);
  if (!Number.isFinite(hour) || !Number.isFinite(minute)) return null;

  const dayStart = new Date(targetDate);
  dayStart.setHours(0, 0, 0, 0);
  const executionAt = new Date(dayStart);
  executionAt.setHours(hour, minute, 0, 0);

  const startAt = schedule.start_date
    ? new Date(`${schedule.start_date}T${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}:00`)
    : null;
  const endAt = schedule.end_date ? new Date(`${schedule.end_date}T23:59:59`) : null;

  if (startAt && executionAt < startAt) return null;
  if (endAt && executionAt > endAt) return null;

  const normalizedFrequency = schedule.frequency === '毎日' ? 'daily'
    : schedule.frequency === '毎週' ? 'weekly'
      : schedule.frequency === '隔週' ? 'biweekly'
        : schedule.frequency === '毎月' ? 'monthly'
          : schedule.frequency;

  if (normalizedFrequency === 'daily') return executionAt;

  if (normalizedFrequency === 'weekly' || normalizedFrequency === 'biweekly') {
    if (!startAt) return executionAt;
    const intervalDays = normalizedFrequency === 'weekly' ? 7 : 14;
    const elapsedDays = Math.floor((dayStart.getTime() - new Date(startAt).setHours(0, 0, 0, 0)) / 86400000);
    return elapsedDays >= 0 && elapsedDays % intervalDays === 0 ? executionAt : null;
  }

  if (normalizedFrequency === 'monthly') {
    if (!startAt) return executionAt;
    return targetDate.getDate() === startAt.getDate() ? executionAt : null;
  }

  return executionAt;
};

const toStatusLabel = (postStatus: ScheduleSetting['post_status']) => {
  return postStatus === 'publish' ? '公開投稿' : '下書き保存';
};

const getKeywordPreview = (keywordText: string) => {
  const list = keywordText
    .split(',')
    .map((k) => k.trim())
    .filter((k) => k.length > 0);

  if (list.length === 0) return { primary: 'キーワード未設定', restCount: 0 };
  return { primary: list[0], restCount: Math.max(0, list.length - 1) };
};

export const Dashboard: React.FC = () => {
  const { wordPressConfigs, aiConfigs, setActiveView } = useAppStore();
  const [stats, setStats] = useState({
    totalArticles: 0,
    publishedToday: 0
  });
  const [activeSchedules, setActiveSchedules] = useState<ScheduleWithNext[]>([]);
  const [todayScheduleCount, setTodayScheduleCount] = useState(0);
  const [recentExecutionCosts, setRecentExecutionCosts] = useState<ExecutionCostHistoryItem[]>([]);
  const [recentExecutionCostTotal, setRecentExecutionCostTotal] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const [togglingScheduleId, setTogglingScheduleId] = useState<string | null>(null);

  useEffect(() => {
    void loadDashboardData();
  }, []);

  const loadDashboardData = async () => {
    try {
      setIsLoading(true);

      const [totalArticles, schedules] = await Promise.all([
        articlesService.getArticleCount(),
        scheduleService.getSchedules().catch(() => [] as ScheduleSetting[])
      ]);
      const executionHistory = await supabaseSchedulerService.getExecutionHistory(12).catch(() => [] as ExecutionCostHistoryItem[]);

      const todayStart = new Date();
      todayStart.setHours(0, 0, 0, 0);
      const todayEnd = new Date(todayStart);
      todayEnd.setHours(23, 59, 59, 999);

      const publishedToday = await articlesService.getArticleCount({
        publishedDateFrom: todayStart.toISOString(),
        publishedDateTo: todayEnd.toISOString()
      });

      const enabledWithNext = await Promise.all(
        schedules
          .filter((schedule) => schedule.status)
          .map(async (schedule) => {
            const lastExecutionAt = schedule.id
              ? await scheduleService.getLastExecution(schedule.id).catch(() => null)
              : null;

            return {
              ...schedule,
              nextExecution: getNextExecutionDate(schedule),
              lastExecutionAt
            };
          })
      );

      enabledWithNext.sort((a, b) => {
        if (!a.nextExecution && !b.nextExecution) return 0;
        if (!a.nextExecution) return 1;
        if (!b.nextExecution) return -1;
        return a.nextExecution.getTime() - b.nextExecution.getTime();
      });

      const todayPlanned = enabledWithNext.filter((schedule) =>
        Boolean(getScheduledExecutionForDate(schedule, todayStart))
      ).length;

      setStats({
        totalArticles,
        publishedToday
      });
      setActiveSchedules(enabledWithNext);
      setTodayScheduleCount(todayPlanned);
      setRecentExecutionCosts(executionHistory);
      const total = executionHistory.reduce((sum, row) => {
        const n = Number(row.estimated_cost_usd ?? 0);
        return sum + (Number.isFinite(n) ? n : 0);
      }, 0);
      setRecentExecutionCostTotal(Number(total.toFixed(6)));
    } catch (error) {
      console.error('ダッシュボード取得エラー:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const wpNameById = (wpConfigId: string) => {
    const config = wordPressConfigs.find((item) => item.id === wpConfigId);
    return config?.name || '未設定サイト';
  };

  const aiNameById = (aiConfigId: string) => {
    const config = aiConfigs.find((item) => item.id === aiConfigId);
    if (!config) return '未設定AI';
    if (config.provider === 'openai') return `OpenAI (${config.model})`;
    if (config.provider === 'claude') return `Claude (${config.model})`;
    return `Gemini (${config.model})`;
  };

  const aiNameBySchedule = (schedule: ScheduleSetting) => {
    if (schedule.ai_provider_override && schedule.ai_model_override) {
      const providerName = schedule.ai_provider_override === 'openai'
        ? 'OpenAI'
        : schedule.ai_provider_override === 'claude'
          ? 'Claude'
          : schedule.ai_provider_override === 'gemini'
            ? 'Gemini'
            : schedule.ai_provider_override;
      return `${providerName} (${schedule.ai_model_override})`;
    }
    return aiNameById(schedule.ai_config_id);
  };

  const openSchedulerEditor = (scheduleId?: string) => {
    if (scheduleId) {
      localStorage.setItem('scheduler_edit_schedule_id', scheduleId);
    }
    setActiveView('scheduler');
  };

  const handleToggleScheduleStatus = async (schedule: ScheduleWithNext) => {
    if (!schedule.id) return;
    try {
      setTogglingScheduleId(schedule.id);
      await scheduleService.toggleScheduleStatus(schedule.id);
      await loadDashboardData();
    } catch (error) {
      console.error('Failed to toggle schedule status on dashboard:', error);
    } finally {
      setTogglingScheduleId(null);
    }
  };

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-gray-600">総記事数</p>
              <p className="text-3xl font-bold text-gray-900">{stats.totalArticles}</p>
            </div>
            <div className="w-12 h-12 bg-blue-100 rounded-lg flex items-center justify-center">
              <FileText className="w-6 h-6 text-blue-600" />
            </div>
          </div>
        </div>

        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-gray-600">本日投稿済み</p>
              <p className="text-3xl font-bold text-green-600">{stats.publishedToday}</p>
            </div>
            <div className="w-12 h-12 bg-green-100 rounded-lg flex items-center justify-center">
              <CheckCircle className="w-6 h-6 text-green-600" />
            </div>
          </div>
        </div>

        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-gray-600">本日投稿予定</p>
              <p className="text-3xl font-bold text-purple-600">{todayScheduleCount}</p>
            </div>
            <div className="w-12 h-12 bg-purple-100 rounded-lg flex items-center justify-center">
              <Calendar className="w-6 h-6 text-purple-600" />
            </div>
          </div>
        </div>
      </div>

      <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-semibold text-gray-900">有効な予約スケジュール</h3>
          <span className="text-sm text-gray-500">本日投稿予定: {todayScheduleCount}件</span>
        </div>

        {isLoading ? (
          <div className="text-center py-8">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600 mx-auto mb-4"></div>
            <p className="text-gray-500">読み込み中...</p>
          </div>
        ) : activeSchedules.length === 0 ? (
          <div className="text-center py-8">
            <Calendar className="w-12 h-12 text-gray-400 mx-auto mb-4" />
            <p className="text-gray-500">有効な予約スケジュールはありません</p>
          </div>
        ) : (
          <div className="space-y-3">
            {activeSchedules.map((schedule) => {
              const keywordInfo = getKeywordPreview(schedule.keyword || '');
              return (
                <div
                  key={schedule.id}
                  className="border rounded-xl p-5 shadow-md transition-all bg-white border-emerald-300 ring-1 ring-emerald-100 hover:shadow-lg cursor-pointer"
                  onClick={() => openSchedulerEditor(schedule.id)}
                >
                  <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
                    <div className="flex flex-wrap gap-4 items-center flex-1 min-w-0">
                      <div className="flex items-center space-x-3 min-w-0">
                        <div className="w-10 h-10 rounded-full bg-white border border-gray-100 flex items-center justify-center shadow-sm flex-shrink-0">
                          <Globe className="w-5 h-5 text-blue-500" />
                        </div>
                        <div className="min-w-0">
                          <div className="text-[10px] text-gray-400 font-bold uppercase tracking-wider">Target Site</div>
                          <div className="text-sm font-bold text-gray-900 truncate max-w-[220px]" title={wpNameById(schedule.wp_config_id)}>
                            {wpNameById(schedule.wp_config_id)}
                          </div>
                        </div>
                      </div>

                      <div className="flex items-center space-x-3 min-w-0">
                        <div className="w-10 h-10 rounded-full bg-white border border-gray-100 flex items-center justify-center shadow-sm flex-shrink-0">
                          <Tag className="w-5 h-5 text-purple-500" />
                        </div>
                        <div className="min-w-0">
                          <div className="text-[10px] text-gray-400 font-bold uppercase tracking-wider">Keyword / AI</div>
                          <div className="text-sm font-bold text-gray-900 truncate max-w-[240px]" title={keywordInfo.primary}>
                            {keywordInfo.primary}
                            {keywordInfo.restCount > 0 ? ` +${keywordInfo.restCount}件` : ''}
                          </div>
                          <div className="text-xs text-gray-500">{aiNameBySchedule(schedule)}</div>
                        </div>
                      </div>
                    </div>

                    <div className="flex items-center space-x-3 min-w-[210px]">
                      <div className="p-3 rounded-xl shadow-sm bg-blue-600 text-white">
                        <Clock className="w-6 h-6" />
                      </div>
                      <div>
                        <div className="flex items-baseline gap-2">
                          <span className="text-2xl font-bold text-gray-900 leading-none">{schedule.post_time}</span>
                          <span className="text-sm font-semibold text-gray-500">/{schedule.frequency}</span>
                        </div>
                        <div className="flex items-center gap-2 mt-1">
                          <span className="px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide rounded border bg-green-50 text-green-700 border-green-200">
                            Active
                          </span>
                          <span className="text-xs text-gray-500">{toStatusLabel(schedule.post_status)}</span>
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              void handleToggleScheduleStatus(schedule);
                            }}
                            disabled={togglingScheduleId === schedule.id}
                            className="ml-1 inline-flex items-center gap-1 px-2 py-1 text-[11px] rounded border border-gray-200 text-gray-600 hover:bg-gray-50 disabled:opacity-50"
                            title="有効/無効を切り替え"
                          >
                            <Power className="w-3 h-3" />
                            {togglingScheduleId === schedule.id ? '変更中' : '無効化'}
                          </button>
                        </div>
                      </div>
                    </div>
                  </div>

                  <div className="mt-3 grid grid-cols-1 md:grid-cols-2 gap-2">
                    <div className="text-xs rounded-lg border border-gray-200 bg-gray-50 px-3 py-2">
                      <p className="text-[11px] text-gray-700 font-semibold">前回実行</p>
                      <p className="text-gray-700 mt-0.5">
                        {schedule.lastExecutionAt ? format(new Date(schedule.lastExecutionAt), 'yyyy/MM/dd HH:mm', { locale: ja }) : '未実行'}
                      </p>
                    </div>
                    <div className="text-xs rounded-lg border border-blue-100 bg-blue-50 px-3 py-2">
                      <p className="text-[11px] text-blue-700 font-semibold">次回実行</p>
                      <p className="text-gray-700 mt-0.5">
                        {schedule.nextExecution ? format(schedule.nextExecution, 'yyyy/MM/dd HH:mm', { locale: ja }) : '予定なし'}
                      </p>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-semibold text-gray-900">直近実行コスト（概算）</h3>
          <span className="text-sm text-gray-500">直近 {recentExecutionCosts.length} 件合計: {formatJpy(toJpy(recentExecutionCostTotal))}</span>
        </div>
        <p className="text-xs text-gray-500 mb-3">換算レート: 1 USD = {USD_TO_JPY_RATE} JPY</p>

        {recentExecutionCosts.length === 0 ? (
          <div className="text-center py-6 text-sm text-gray-500">コスト履歴はまだありません</div>
        ) : (
          <div className="space-y-2">
            {recentExecutionCosts.map((row) => {
              const estimated = Number(row.estimated_cost_usd ?? 0);
              const ai = row.cost_breakdown?.ai;
              const research = row.cost_breakdown?.research;
              const images = row.cost_breakdown?.images;
              return (
                <div key={row.id} className="border rounded-lg p-3 bg-gray-50">
                  <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-gray-900 truncate">{row.article_title || '（タイトル未保存）'}</p>
                      <p className="text-xs text-gray-500">
                        {row.wordpress_configs?.name || 'Unknown Site'} | {format(new Date(row.executed_at), 'yyyy/MM/dd HH:mm', { locale: ja })}
                      </p>
                    </div>
                    <div className="text-right">
                      <p className="text-sm font-bold text-emerald-700">{formatJpy(toJpy(Number.isFinite(estimated) ? estimated : 0))}</p>
                      <p className="text-[11px] text-gray-500">{row.status || 'unknown'}</p>
                    </div>
                  </div>
                  <div className="mt-2 text-[11px] text-gray-600 flex flex-wrap gap-x-3 gap-y-1">
                    <span>AI: {ai ? `${ai.provider}/${ai.model}` : 'n/a'}</span>
                    <span>AI概算: {formatJpy(toJpy(ai?.estimated_usd != null ? Number(ai.estimated_usd) : 0))}</span>
                    <span>Research概算: {formatJpy(toJpy(research?.estimated_usd != null ? Number(research.estimated_usd) : 0))}</span>
                    <span>画像概算: {formatJpy(toJpy(images?.estimated_usd != null ? Number(images.estimated_usd) : 0))}</span>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
};
