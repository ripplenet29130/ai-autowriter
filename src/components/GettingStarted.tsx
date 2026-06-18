import React, { useEffect, useMemo, useState } from 'react';
import {
  ArrowRight,
  BarChart3,
  Bot,
  Calendar,
  CheckCircle2,
  Circle,
  FileText,
  Globe,
  LayoutDashboard,
  ListChecks,
  Search,
} from 'lucide-react';
import { useAppStore } from '../store/useAppStore';
import { apiKeyManager } from '../services/apiKeyManager';
import { scheduleService } from '../services/scheduleService';
import { supabase } from '../services/supabaseClient';
import { getCurrentAccountId } from '../services/accountScope';

type SetupStep = {
  id: string;
  title: string;
  description: string;
  actionLabel: string;
  targetView: string;
  targetSettingsTab?: string;
  isDone: boolean;
  icon: React.ComponentType<{ className?: string }>;
};

export const GettingStarted: React.FC = () => {
  const {
    wordPressConfigs,
    aiConfigs,
    articles,
    setActiveView,
  } = useAppStore();
  const [hasSerpApiKey, setHasSerpApiKey] = useState(false);
  const [scheduleCount, setScheduleCount] = useState(0);

  useEffect(() => {
    let mounted = true;

    const loadSerpApiStatus = async () => {
      const localKey = apiKeyManager.getApiKey('serpapi');
      if (localKey?.trim()) {
        if (mounted) setHasSerpApiKey(true);
        return;
      }

      if (!supabase) return;
      const accountId = getCurrentAccountId();
      if (!accountId) return;

      const { data } = await supabase
        .from('app_settings')
        .select('value')
        .eq('account_id', accountId)
        .eq('key', 'serpapi_key')
        .maybeSingle();

      if (mounted) {
        setHasSerpApiKey(Boolean(data?.value?.trim()));
      }
    };

    const loadScheduleStatus = async () => {
      const schedules = await scheduleService.getSchedules().catch(() => []);
      if (mounted) setScheduleCount(schedules.length);
    };

    void loadSerpApiStatus();
    void loadScheduleStatus();

    return () => {
      mounted = false;
    };
  }, []);

  const steps = useMemo<SetupStep[]>(() => [
    {
      id: 'wordpress',
      title: 'WordPressを接続',
      description: '投稿先サイトを登録し、記事を公開できる状態にします。',
      actionLabel: 'WordPress設定へ',
      targetView: 'wordpress',
      isDone: wordPressConfigs.some((config) => config.isActive) || wordPressConfigs.length > 0,
      icon: Globe,
    },
    {
      id: 'ai',
      title: 'AIを設定',
      description: '記事作成に使うAIプロバイダーとモデルを選びます。',
      actionLabel: 'AI設定へ',
      targetView: 'ai-config',
      isDone: aiConfigs.some((config) => config.isActive) || aiConfigs.length > 0,
      icon: Bot,
    },
    {
      id: 'serpapi',
      title: 'キーワード検索APIを設定',
      description: 'キーワード検索と競合記事確認に使うSerpAPIキーを登録します。',
      actionLabel: '検索API設定へ',
      targetView: 'connections',
      targetSettingsTab: 'search-api',
      isDone: hasSerpApiKey,
      icon: Search,
    },
    {
      id: 'article',
      title: 'テスト記事を作成',
      description: '設定内容を使って、最初の記事を下書きで作成します。',
      actionLabel: '記事を作る',
      targetView: 'generator',
      isDone: articles.length > 0,
      icon: FileText,
    },
    {
      id: 'schedule',
      title: '自動投稿を設定',
      description: '投稿頻度、時刻、投稿先、公開方法を決めます。',
      actionLabel: '自動投稿へ',
      targetView: 'scheduler',
      isDone: scheduleCount > 0,
      icon: Calendar,
    },
  ], [aiConfigs, articles.length, hasSerpApiKey, scheduleCount, wordPressConfigs]);

  const requiredSetupStarted = steps
    .filter((step) => step.id === 'wordpress' || step.id === 'ai')
    .some((step) => step.isDone);
  const completedCount = requiredSetupStarted ? steps.filter((step) => step.isDone).length : 0;
  const progressPercent = Math.round((completedCount / steps.length) * 100);

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 border-b border-gray-200 pb-6 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <div className="mb-2 flex items-center gap-2 text-sm font-medium text-blue-700">
            <ListChecks className="h-4 w-4" />
            初期設定ガイド
          </div>
          <h2 className="text-2xl font-bold text-gray-900">はじめる</h2>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-gray-600">
            まずは必須設定を完了し、そのあと記事作成と自動投稿設定へ進みます。通知やファクトチェックは任意設定です。
          </p>
        </div>

        <div className="w-full rounded-lg border border-gray-200 bg-white p-4 lg:w-72">
          <div className="flex items-center justify-between text-sm">
            <span className="font-medium text-gray-700">進捗</span>
            <span className="font-semibold text-gray-900">{completedCount} / {steps.length}</span>
          </div>
          <div className="mt-3 h-2 overflow-hidden rounded-full bg-gray-100">
            <div className="h-full rounded-full bg-blue-600 transition-all" style={{ width: `${progressPercent}%` }} />
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        {steps.map((step, index) => {
          const Icon = step.icon;
          const StatusIcon = step.isDone ? CheckCircle2 : Circle;

          return (
            <div key={step.id} className="rounded-lg border border-gray-200 bg-white p-5 shadow-sm">
              <div className="flex items-start gap-4">
                <div className={`flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-lg ${step.isDone ? 'bg-emerald-50' : 'bg-gray-50'}`}>
                  <Icon className={`h-5 w-5 ${step.isDone ? 'text-emerald-600' : 'text-gray-600'}`} />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-xs font-semibold text-gray-500">STEP {index + 1}</span>
                    <StatusIcon className={`h-4 w-4 ${step.isDone ? 'text-emerald-600' : 'text-gray-400'}`} />
                    <span className={`text-xs font-medium ${step.isDone ? 'text-emerald-700' : 'text-gray-500'}`}>
                      {step.isDone ? '完了' : '未設定'}
                    </span>
                  </div>
                  <h3 className="mt-1 text-lg font-semibold text-gray-900">{step.title}</h3>
                  <p className="mt-1 text-sm leading-6 text-gray-600">{step.description}</p>
                </div>
              </div>

              <div className="mt-4 flex justify-end">
                <button
                  type="button"
                  onClick={() => {
                    if (step.targetSettingsTab) {
                      window.localStorage.setItem('settings_active_tab', step.targetSettingsTab);
                    }
                    setActiveView(step.targetView);
                  }}
                  className="inline-flex items-center gap-2 rounded-lg border border-gray-300 px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
                >
                  {step.actionLabel}
                  <ArrowRight className="h-4 w-4" />
                </button>
              </div>
            </div>
          );
        })}
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <button
          type="button"
          onClick={() => setActiveView('articles')}
          className="rounded-lg border border-gray-200 bg-white p-5 text-left shadow-sm hover:border-blue-200 hover:bg-blue-50"
        >
          <FileText className="mb-3 h-5 w-5 text-blue-600" />
          <h3 className="font-semibold text-gray-900">作成した記事を見る</h3>
          <p className="mt-1 text-sm text-gray-600">下書き、公開済み、失敗した記事を確認します。</p>
        </button>
        <button
          type="button"
          onClick={() => setActiveView('operations')}
          className="rounded-lg border border-gray-200 bg-white p-5 text-left shadow-sm hover:border-blue-200 hover:bg-blue-50"
        >
          <LayoutDashboard className="mb-3 h-5 w-5 text-blue-600" />
          <h3 className="font-semibold text-gray-900">稼働状況を見る</h3>
          <p className="mt-1 text-sm text-gray-600">投稿予定や自動投稿の状態を確認します。</p>
        </button>
        <button
          type="button"
          onClick={() => setActiveView('seo-report')}
          className="rounded-lg border border-gray-200 bg-white p-5 text-left shadow-sm hover:border-blue-200 hover:bg-blue-50"
        >
          <BarChart3 className="mb-3 h-5 w-5 text-blue-600" />
          <h3 className="font-semibold text-gray-900">分析結果を見る</h3>
          <p className="mt-1 text-sm text-gray-600">Search Consoleのクリック数や検索キーワードを確認します。</p>
        </button>
      </div>
    </div>
  );
};
