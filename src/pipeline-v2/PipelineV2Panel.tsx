// 画面「新方式（テスト）」: 記事作成を工程ごとに分けて実行する新方式を、管理者が試すための画面
// 仕様: docs/article-pipeline-v2-spec-2026-11-11.md（10 章）
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Play, RefreshCw, RotateCcw, Square } from 'lucide-react';
import toast from 'react-hot-toast';
import {
  PIPELINE_STEP_LABELS,
  PIPELINE_STEP_ORDER,
  pipelineV2Service,
  type PipelineJob,
  type PipelineJobSettings,
  type PipelineJobStep,
  type SelectableConfig,
} from './pipelineV2Service';

const STATUS_LABEL: Record<string, string> = {
  queued: '待機中',
  running: '実行中',
  completed: '完了',
  failed: '失敗',
  cancelled: 'キャンセル',
};

const STATUS_CLASS: Record<string, string> = {
  queued: 'bg-gray-100 text-gray-700',
  running: 'bg-blue-100 text-blue-800',
  completed: 'bg-green-100 text-green-800',
  failed: 'bg-red-100 text-red-800',
  cancelled: 'bg-gray-100 text-gray-500',
};

const CRITIQUE_LABEL: Record<string, string> = {
  thin: '説明が薄い',
  duplicate: '重複',
  unsupported: '根拠のない断定',
  unanswered: '答えていない疑問',
  off_topic: '検索意図から外れる',
  flow: 'つながりが悪い',
  readability: '読みにくい',
};

const formatTime = (iso?: string | null) => (iso ? new Date(iso).toLocaleString('ja-JP') : '—');

const elapsed = (job: PipelineJob) => {
  const end = job.completed_at ? new Date(job.completed_at).getTime() : new Date(job.updated_at).getTime();
  const seconds = Math.max(0, Math.round((end - new Date(job.created_at).getTime()) / 1000));
  return seconds >= 60 ? `${Math.floor(seconds / 60)}分${seconds % 60}秒` : `${seconds}秒`;
};

const defaultSettings: PipelineJobSettings = {
  lengthMode: 'auto',
  targetWordCount: 3000,
  tone: 'professional',
  qualityMode: 'high',
  customInstructions: '',
  appendReferences: true,
};

export const PipelineV2Panel: React.FC = () => {
  const [jobs, setJobs] = useState<PipelineJob[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [steps, setSteps] = useState<PipelineJobStep[]>([]);
  const [aiConfigs, setAiConfigs] = useState<SelectableConfig[]>([]);
  const [wpConfigs, setWpConfigs] = useState<SelectableConfig[]>([]);
  const [keyword, setKeyword] = useState('');
  const [title, setTitle] = useState('');
  const [aiConfigId, setAiConfigId] = useState('');
  const [wpConfigId, setWpConfigId] = useState('');
  const [settings, setSettings] = useState<PipelineJobSettings>(defaultSettings);
  const [submitting, setSubmitting] = useState(false);
  const [versionIndex, setVersionIndex] = useState<number | null>(null);

  const selected = useMemo(() => jobs.find((job) => job.id === selectedId) || null, [jobs, selectedId]);
  const hasActive = jobs.some((job) => job.status === 'queued' || job.status === 'running');

  const loadJobs = useCallback(async () => {
    try {
      setJobs(await pipelineV2Service.listJobs());
    } catch (error) {
      toast.error(`ジョブを読み込めませんでした: ${error instanceof Error ? error.message : error}`);
    }
  }, []);

  useEffect(() => {
    void loadJobs();
    pipelineV2Service.listGeminiConfigs().then((rows) => {
      setAiConfigs(rows);
      if (rows[0]) setAiConfigId((current) => current || rows[0].id);
    }).catch(() => undefined);
    pipelineV2Service.listWordPressConfigs().then(setWpConfigs).catch(() => undefined);
  }, [loadJobs]);

  // 実行中のジョブがあるあいだは 5 秒ごとに更新する
  useEffect(() => {
    if (!hasActive) return;
    const timer = window.setInterval(() => { void loadJobs(); }, 5000);
    return () => window.clearInterval(timer);
  }, [hasActive, loadJobs]);

  useEffect(() => {
    if (!selectedId) {
      setSteps([]);
      return;
    }
    pipelineV2Service.listSteps(selectedId).then(setSteps).catch(() => setSteps([]));
  }, [selectedId, selected?.updated_at]);

  useEffect(() => setVersionIndex(null), [selectedId]);

  const createJob = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!keyword.trim()) {
      toast.error('キーワードを入力してください');
      return;
    }
    setSubmitting(true);
    try {
      const jobId = await pipelineV2Service.createJob({
        keyword: keyword.trim(),
        title: title.trim() || undefined,
        aiConfigId: aiConfigId || undefined,
        wordpressConfigId: wpConfigId || undefined,
        settings,
      });
      toast.success('作成を開始しました。工程ごとに自動で進みます');
      setKeyword('');
      setTitle('');
      await loadJobs();
      setSelectedId(jobId);
    } catch (error) {
      toast.error(`開始できませんでした: ${error instanceof Error ? error.message : error}`);
    } finally {
      setSubmitting(false);
    }
  };

  const runAction = async (action: 'retry' | 'cancel', jobId: string) => {
    try {
      if (action === 'retry') await pipelineV2Service.retryJob(jobId);
      else await pipelineV2Service.cancelJob(jobId);
      toast.success(action === 'retry' ? '失敗した工程からやり直します' : 'キャンセルしました');
      await loadJobs();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
    }
  };

  const versions: Array<{ label: string; content: string; chars: number }> = selected?.state?.versions || [];
  const shownContent = versionIndex !== null && versions[versionIndex] ? versions[versionIndex].content : selected?.content || '';
  const critique = selected?.state?.critique;
  const factCheck = selected?.quality?.fact_check;
  const verdict = selected?.verdict;

  return (
    <div className="space-y-6">
      <div className="bg-amber-50 border border-amber-200 rounded-lg p-4 text-sm text-amber-900">
        記事作成を工程ごと（調査 → 企画 → 執筆 → 文字数の調整 → 批評 → 書き直し → ファクトチェック → 修正 → 投稿）に分けて実行する新方式のテストです。
        1 本あたり 4〜8 分かかります。テスト期間中、WordPress へは常に下書きで投稿します。
      </div>

      <form onSubmit={createJob} className="bg-white border border-gray-200 rounded-lg p-5 space-y-4">
        <h2 className="text-lg font-semibold text-gray-900">記事を作る</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <label className="block text-sm">
            <span className="text-gray-700">キーワード（必須）</span>
            <input className="input-field mt-1" value={keyword} onChange={(e) => setKeyword(e.target.value)} placeholder="例: 相続税 申告期限" />
          </label>
          <label className="block text-sm">
            <span className="text-gray-700">タイトル（任意。空なら AI が決める）</span>
            <input className="input-field mt-1" value={title} onChange={(e) => setTitle(e.target.value)} />
          </label>
          <label className="block text-sm">
            <span className="text-gray-700">Gemini の AI 設定</span>
            <select className="input-field mt-1" value={aiConfigId} onChange={(e) => setAiConfigId(e.target.value)}>
              {aiConfigs.length === 0 && <option value="">（Gemini の設定がありません）</option>}
              {aiConfigs.map((config) => <option key={config.id} value={config.id}>{config.label}</option>)}
            </select>
          </label>
          <label className="block text-sm">
            <span className="text-gray-700">投稿先の WordPress</span>
            <select className="input-field mt-1" value={wpConfigId} onChange={(e) => setWpConfigId(e.target.value)}>
              <option value="">投稿しない（記事だけ作る）</option>
              {wpConfigs.map((config) => <option key={config.id} value={config.id}>{config.label}</option>)}
            </select>
          </label>
          <div className="text-sm">
            <span className="text-gray-700">文字数</span>
            <div className="flex gap-2 mt-1">
              {(['auto', 'fixed'] as const).map((mode) => (
                <button
                  key={mode}
                  type="button"
                  onClick={() => setSettings({ ...settings, lengthMode: mode })}
                  className={`px-3 py-2 rounded-md border ${settings.lengthMode === mode ? 'bg-purple-600 text-white border-purple-600' : 'bg-white text-gray-700 border-gray-300'}`}
                >
                  {mode === 'auto' ? 'おまかせ（AIが決める）' : '文字数指定'}
                </button>
              ))}
              {settings.lengthMode === 'fixed' && (
                <input
                  type="number"
                  min={500}
                  max={6000}
                  step={100}
                  className="input-field w-28"
                  value={settings.targetWordCount}
                  onChange={(e) => setSettings({ ...settings, targetWordCount: Number(e.target.value) || 3000 })}
                />
              )}
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3 text-sm">
            <label className="block">
              <span className="text-gray-700">文体</span>
              <select className="input-field mt-1" value={settings.tone} onChange={(e) => setSettings({ ...settings, tone: e.target.value === 'casual' ? 'casual' : 'professional' })}>
                <option value="professional">ビジネス向け</option>
                <option value="casual">やわらかめ</option>
              </select>
            </label>
            <label className="block">
              <span className="text-gray-700">品質モード</span>
              <select className="input-field mt-1" value={settings.qualityMode} onChange={(e) => setSettings({ ...settings, qualityMode: e.target.value === 'standard' ? 'standard' : 'high' })}>
                <option value="high">高品質（Pro）</option>
                <option value="standard">標準</option>
              </select>
            </label>
          </div>
        </div>
        <label className="block text-sm">
          <span className="text-gray-700">追加の指示（任意）</span>
          <textarea className="input-field mt-1" rows={2} value={settings.customInstructions} onChange={(e) => setSettings({ ...settings, customInstructions: e.target.value })} />
        </label>
        <label className="flex items-center gap-2 text-sm text-gray-700">
          <input type="checkbox" checked={settings.appendReferences} onChange={(e) => setSettings({ ...settings, appendReferences: e.target.checked })} />
          記事末に参考資料を付ける
        </label>
        <button type="submit" disabled={submitting} className="inline-flex items-center gap-2 bg-purple-600 hover:bg-purple-700 disabled:opacity-60 text-white rounded-lg px-4 py-2 text-sm font-medium">
          <Play className="w-4 h-4" />
          {submitting ? '開始しています' : '作成開始'}
        </button>
      </form>

      <div className="bg-white border border-gray-200 rounded-lg">
        <div className="flex items-center justify-between px-5 py-3 border-b border-gray-200">
          <h2 className="text-lg font-semibold text-gray-900">ジョブ一覧</h2>
          <button type="button" onClick={() => void loadJobs()} className="inline-flex items-center gap-1 text-sm text-gray-600 hover:text-gray-900">
            <RefreshCw className="w-4 h-4" /> 更新
          </button>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-gray-500">
              <tr>
                <th className="text-left px-4 py-2">キーワード／タイトル</th>
                <th className="text-left px-4 py-2">状態</th>
                <th className="text-left px-4 py-2">今の工程</th>
                <th className="text-left px-4 py-2">経過</th>
                <th className="text-left px-4 py-2">費用</th>
                <th className="text-left px-4 py-2">作成</th>
              </tr>
            </thead>
            <tbody>
              {jobs.length === 0 && (
                <tr><td colSpan={6} className="px-4 py-6 text-center text-gray-500">まだジョブはありません</td></tr>
              )}
              {jobs.map((job) => (
                <tr
                  key={job.id}
                  onClick={() => setSelectedId(job.id)}
                  className={`border-t border-gray-100 cursor-pointer hover:bg-gray-50 ${selectedId === job.id ? 'bg-purple-50' : ''}`}
                >
                  <td className="px-4 py-2">
                    <div className="font-medium text-gray-900">{job.title || job.fixed_title || job.keyword}</div>
                    <div className="text-xs text-gray-500">{job.keyword}{job.schedule_id ? '（スケジュール）' : ''}</div>
                  </td>
                  <td className="px-4 py-2"><span className={`px-2 py-0.5 rounded-full text-xs ${STATUS_CLASS[job.status] || ''}`}>{STATUS_LABEL[job.status] || job.status}</span></td>
                  <td className="px-4 py-2">{job.status === 'completed' ? '—' : PIPELINE_STEP_LABELS[job.current_step] || job.current_step}</td>
                  <td className="px-4 py-2">{elapsed(job)}</td>
                  <td className="px-4 py-2">{job.cost?.total_jpy ? `約${job.cost.total_jpy}円` : '—'}</td>
                  <td className="px-4 py-2 text-gray-500">{formatTime(job.created_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {selected && (
        <div className="bg-white border border-gray-200 rounded-lg p-5 space-y-5">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h2 className="text-lg font-semibold text-gray-900">{selected.title || selected.keyword}</h2>
              <p className="text-sm text-gray-500">
                {STATUS_LABEL[selected.status]}・{selected.length_plan ? `${selected.length_plan.mode === 'auto' ? 'おまかせ' : '文字数指定'} ${selected.length_plan.targetChars}字（${selected.length_plan.reason}）` : '文字数は未決定'}
              </p>
              {selected.error && <p className="text-sm text-red-700 mt-1">{selected.error}</p>}
            </div>
            <div className="flex gap-2">
              {(selected.status === 'failed' || selected.status === 'cancelled') && (
                <button type="button" onClick={() => void runAction('retry', selected.id)} className="inline-flex items-center gap-1 border border-gray-300 rounded-lg px-3 py-1.5 text-sm">
                  <RotateCcw className="w-4 h-4" /> 失敗した工程からやり直す
                </button>
              )}
              {(selected.status === 'queued' || selected.status === 'running') && (
                <button type="button" onClick={() => void runAction('cancel', selected.id)} className="inline-flex items-center gap-1 border border-gray-300 rounded-lg px-3 py-1.5 text-sm">
                  <Square className="w-4 h-4" /> キャンセル
                </button>
              )}
            </div>
          </div>

          {/* 工程の進み具合 */}
          <div className="flex flex-wrap gap-2">
            {PIPELINE_STEP_ORDER.map((step) => {
              const done = steps.some((s) => s.step === step && s.status === 'completed');
              const failed = !done && steps.some((s) => s.step === step && s.status === 'failed');
              const current = selected.status !== 'completed' && selected.current_step === step;
              return (
                <span
                  key={step}
                  className={`px-2 py-1 rounded text-xs border ${done ? 'bg-green-50 border-green-200 text-green-800' : failed ? 'bg-red-50 border-red-200 text-red-700' : current ? 'bg-blue-50 border-blue-200 text-blue-800' : 'bg-gray-50 border-gray-200 text-gray-500'}`}
                >
                  {PIPELINE_STEP_LABELS[step]}
                </span>
              );
            })}
          </div>

          {verdict && (
            <div className="text-sm rounded-lg bg-gray-50 p-3 space-y-1">
              <div>投稿: {verdict.post_status === 'publish' ? '公開' : '下書き'}{selected.wordpress_url && <> — <a href={selected.wordpress_url} target="_blank" rel="noopener noreferrer" className="text-blue-600 underline">投稿を開く</a></>}</div>
              {verdict.draft_reasons?.length > 0 && <div>下書きの理由: {verdict.draft_reasons.join(' / ')}</div>}
              {verdict.warnings?.length > 0 && <div>注意: {verdict.warnings.join(' / ')}</div>}
              {verdict.publish_error && <div className="text-red-700">投稿エラー: {verdict.publish_error}</div>}
            </div>
          )}

          {factCheck && (
            <div className="text-sm">
              <h3 className="font-semibold text-gray-900 mb-1">ファクトチェック</h3>
              {factCheck.checked}件確認（検索 {factCheck.searched}件）・重大な指摘 {factCheck.critical}件・軽微 {factCheck.minor}件・確認できず {factCheck.unverified}件・自動修正 {factCheck.auto_fix_applied ? 'あり' : 'なし'}
            </div>
          )}

          {critique?.issues?.length > 0 && (
            <div className="text-sm">
              <h3 className="font-semibold text-gray-900 mb-1">批評の指摘（{selected.state?.reviewStatus || '書き直し前'}）</h3>
              {critique.summary && <p className="text-gray-500 mb-1">{critique.summary}</p>}
              <ol className="list-decimal list-inside space-y-1">
                {critique.issues.map((issue: any, index: number) => (
                  <li key={index}><span className="font-medium">[{CRITIQUE_LABEL[issue.type] || issue.type}] {issue.section}:</span> {issue.problem}{issue.fix && <span className="text-gray-500"> → {issue.fix}</span>}</li>
                ))}
              </ol>
            </div>
          )}

          {selected.content && (
            <div>
              <div className="flex items-center gap-2 mb-2 text-sm">
                <h3 className="font-semibold text-gray-900">本文</h3>
                <select className="input-field w-auto py-1" value={versionIndex ?? -1} onChange={(e) => setVersionIndex(Number(e.target.value) < 0 ? null : Number(e.target.value))}>
                  <option value={-1}>最新</option>
                  {versions.map((version, index) => <option key={index} value={index}>{version.label}（{version.chars}字）</option>)}
                </select>
              </div>
              <article className="prose prose-sm max-w-none border border-gray-200 rounded-lg p-4 max-h-[70vh] overflow-auto">
                <ReactMarkdown remarkPlugins={[remarkGfm]}>{shownContent}</ReactMarkdown>
              </article>
            </div>
          )}

          <div>
            <h3 className="font-semibold text-gray-900 mb-2 text-sm">工程の記録</h3>
            <table className="w-full text-xs">
              <thead className="text-gray-500"><tr><th className="text-left py-1">工程</th><th className="text-left">回</th><th className="text-left">結果</th><th className="text-left">時間</th><th className="text-left">内容</th></tr></thead>
              <tbody>
                {steps.map((step) => (
                  <tr key={step.id} className="border-t border-gray-100 align-top">
                    <td className="py-1 pr-2 whitespace-nowrap">{PIPELINE_STEP_LABELS[step.step] || step.step}</td>
                    <td className="pr-2">{step.attempt}</td>
                    <td className={`pr-2 ${step.status === 'failed' ? 'text-red-700' : ''}`}>{step.status === 'completed' ? '完了' : step.status === 'failed' ? '失敗' : '実行中'}</td>
                    <td className="pr-2 whitespace-nowrap">{step.finished_at ? `${Math.round((new Date(step.finished_at).getTime() - new Date(step.started_at).getTime()) / 1000)}秒` : '—'}</td>
                    <td className="text-gray-600 break-all">
                      {step.error ? <span className="text-red-700">{step.error}</span> : <code className="whitespace-pre-wrap">{JSON.stringify(step.output, null, 1)?.slice(0, 600)}</code>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
};
