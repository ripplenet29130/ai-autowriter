// 記事作成の新方式（v2・テスト）: 画面から使う操作
// ジョブの作成・やり直し・キャンセルは Edge Function（article-pipeline）、一覧と詳細は DB から読む
import { supabase } from '../services/supabaseClient';

export type PipelineJobStatus = 'queued' | 'running' | 'completed' | 'failed' | 'cancelled';

export const PIPELINE_STEP_LABELS: Record<string, string> = {
  research: '調査',
  draft: '執筆（1回で書き切る）',
  facts: '根拠メモ',
  plan: '企画',
  write: '執筆',
  condense: '文字数の調整',
  critique: '批評',
  supplement: '補足調査',
  rewrite: '書き直し',
  factcheck: 'ファクトチェック',
  fix: '修正と再確認',
  finalize: '仕上げと投稿',
};

export const PIPELINE_STEP_ORDER = Object.keys(PIPELINE_STEP_LABELS);

export type PipelineWritingStyle = 'oneshot' | 'steps';

// 書き方ごとに通る工程（画面の進み具合の表示用）
export const PIPELINE_STEPS_BY_STYLE: Record<PipelineWritingStyle, string[]> = {
  oneshot: ['research', 'draft', 'factcheck', 'fix', 'finalize'],
  steps: PIPELINE_STEP_ORDER.filter((step) => step !== 'draft'),
};

export interface PipelineJobSettings {
  lengthMode: 'auto' | 'fixed';
  targetWordCount: number;
  tone: 'professional' | 'casual';
  qualityMode: 'high' | 'standard';
  customInstructions: string;
  appendReferences: boolean;
  // oneshot = 広い調査＋1回で書き切る（標準）、steps = 工程を分けて批評・書き直しを重ねる
  writingStyle?: PipelineWritingStyle;
}

export interface PipelineJob {
  id: string;
  keyword: string;
  fixed_title: string | null;
  title: string | null;
  content: string | null;
  status: PipelineJobStatus;
  current_step: string;
  settings: PipelineJobSettings;
  state: any;
  length_plan: any;
  verdict: any;
  quality: any;
  wordpress_post_id: string | null;
  wordpress_url: string | null;
  cost: { total_usd?: number; total_jpy?: number; by_step?: Record<string, number> } | null;
  step_attempts: number;
  error: string | null;
  schedule_id: string | null;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
}

export interface PipelineJobStep {
  id: string;
  step: string;
  attempt: number;
  status: 'running' | 'completed' | 'failed';
  output: any;
  model: string | null;
  tokens: any;
  search_count: number;
  started_at: string;
  finished_at: string | null;
  error: string | null;
}

export interface SelectableConfig {
  id: string;
  label: string;
}

function requireClient() {
  if (!supabase) throw new Error('Supabase が設定されていません');
  return supabase;
}

async function invoke(body: Record<string, unknown>): Promise<any> {
  const client = requireClient();
  const { data, error } = await client.functions.invoke('article-pipeline', { body });
  if (error) {
    const context = (error as { context?: unknown }).context;
    if (context instanceof Response) {
      try {
        const payload = await context.clone().json();
        if (payload?.error) throw new Error(String(payload.error));
      } catch (parsed) {
        if (parsed instanceof Error && parsed.message) throw parsed;
      }
    }
    throw error;
  }
  if (data?.error) throw new Error(String(data.error));
  return data;
}

export const pipelineV2Service = {
  async createJob(params: {
    keyword: string;
    title?: string;
    aiConfigId?: string;
    wordpressConfigId?: string;
    settings: PipelineJobSettings;
  }): Promise<string> {
    const data = await invoke({ action: 'create', ...params });
    return String(data?.jobId || '');
  },

  async retryJob(jobId: string): Promise<void> {
    await invoke({ action: 'retry', jobId });
  },

  async cancelJob(jobId: string): Promise<void> {
    await invoke({ action: 'cancel', jobId });
  },

  async listJobs(limit = 30): Promise<PipelineJob[]> {
    const { data, error } = await requireClient()
      .from('article_jobs')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(limit);
    if (error) throw error;
    return (data || []) as PipelineJob[];
  },

  async listSteps(jobId: string): Promise<PipelineJobStep[]> {
    const { data, error } = await requireClient()
      .from('article_job_steps')
      .select('*')
      .eq('job_id', jobId)
      .order('started_at', { ascending: true });
    if (error) throw error;
    return (data || []) as PipelineJobStep[];
  },

  // Gemini の AI 設定（API キーは読まない）
  async listGeminiConfigs(): Promise<SelectableConfig[]> {
    const { data, error } = await requireClient()
      .from('ai_configs')
      .select('id, provider, model, is_active, user_id, created_at')
      .eq('provider', 'gemini')
      .order('created_at', { ascending: false });
    if (error) throw error;
    return (data || []).map((row: any) => ({
      id: row.id,
      label: `${row.model}${row.is_active ? '（有効）' : ''} — ${String(row.user_id || '').slice(0, 8) || '共通'}`,
    }));
  },

  async listWordPressConfigs(): Promise<SelectableConfig[]> {
    const { data, error } = await requireClient()
      .from('wordpress_configs')
      .select('id, name, url')
      .order('created_at', { ascending: false });
    if (error) throw error;
    return (data || []).map((row: any) => ({ id: row.id, label: `${row.name || '名称なし'}（${row.url}）` }));
  },
};
