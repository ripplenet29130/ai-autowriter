// scheduler-executor 全体で共有する型・定数・汎用ユーティリティ
import { normalizeAiModel } from '../../../src/shared/aiModelCatalog.ts';

export function getFirstScheduleKeyword(schedule: Schedule): string {
  return String(schedule.keyword || '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)[0] || '';
}

export const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Client-Info, Apikey',
};


export const parseBoolean = (value: unknown, fallback = false): boolean => {
  if (value == null || value === '') return fallback;
  const normalized = String(value).trim().toLowerCase();
  return normalized === '1' || normalized === 'true' || normalized === 'yes' || normalized === 'on';
};


export const SCHEDULE_EXECUTION_LOCK_TTL_SECONDS = 20 * 60;

export const FALLBACK_SCHEDULE_ROW_LOCK_WINDOW_SECONDS = 8 * 60;

export const AI_REQUEST_TIMEOUT_MS = 180 * 1000;

export const STALE_RUNNING_EXECUTION_MINUTES = 12;

export class AiOutputTruncatedError extends Error {
  partialText: string;

  constructor(message: string, partialText: string) {
    super(message);
    this.name = 'AiOutputTruncatedError';
    this.partialText = partialText;
  }
}


export type ScheduleExecutionLock = {
  acquired: boolean;
  scheduleId: string;
  wpConfigId: string;
  lockToken: string | null;
};


export async function fetchWithTimeout(
  url: string,
  init: RequestInit,
  timeoutMs = AI_REQUEST_TIMEOUT_MS
): Promise<Response> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, {
      ...init,
      signal: controller.signal,
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') {
      throw new Error(`AI応答が${Math.round(timeoutMs / 1000)}秒以内に完了しませんでした。`);
    }
    throw error;
  } finally {
    clearTimeout(timeoutId);
  }
}


export interface WordPressConfig {
  id: string;
  account_id?: string;
  user_id?: string;
  name: string;
  url: string;
  username: string;
  password: string; // This maps to 'applicationPassword' in the DB column 'password'
  category: string;
  post_type: string; // Custom post type slug (e.g., 'posts', 'sushirecipe', 'product')
  style_reference_url?: string;
  is_active: boolean;
}


export interface Schedule {
  id: string;
  account_id?: string;
  user_id?: string;
  ai_config_id: string;
  ai_provider_override?: string;
  ai_model_override?: string;
  wp_config_id: string;
  post_time: string;
  frequency: string;
  weekly_day?: number | null;
  monthly_days?: number[] | null;
  status: boolean;
  keyword: string;
  post_status: 'draft' | 'publish';
  start_date?: string;
  end_date?: string;
  chatwork_room_id?: string;
  chatwork_message_template?: string;
  prompt_set_id?: string;
  target_word_count?: number;
  writing_tone?: string;
  title_set_id?: string;
  generation_mode?: 'keyword' | 'title' | 'both';
  keyword_set_id?: string;
  fact_check_auto_fix_enabled?: boolean;
  fact_check_alert_chatwork_room_id?: string;
  fact_check_notify_on_anomaly?: boolean;
  fact_check_notify_on_every_run?: boolean;
  image_generation_enabled?: boolean;
  images_per_article?: number;
}


export class KeywordExhaustedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'KeywordExhaustedError';
  }
}


export function isKeywordExhaustedError(error: unknown): boolean {
  return (
    error instanceof KeywordExhaustedError ||
    (typeof error === 'object' &&
      error !== null &&
      (error as any).name === 'KeywordExhaustedError')
  );
}


export function parseJstDate(input: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input)) return null;
  const [y, m, d] = input.split('-').map(Number);
  const date = new Date(Date.UTC(y, m - 1, d, 0, 0, 0));
  return Number.isNaN(date.getTime()) ? null : date;
}


export function getCurrentJstDate(now = new Date()): Date {
  const jstString = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Tokyo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
  return parseJstDate(jstString) ?? new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}


export function isWithinScheduleDateRange(schedule: Schedule, now = new Date()): boolean {
  const currentJstDate = getCurrentJstDate(now);
  const start = schedule.start_date ? parseJstDate(schedule.start_date) : null;
  const end = schedule.end_date ? parseJstDate(schedule.end_date) : null;

  if (start && currentJstDate < start) return false;
  if (end && currentJstDate > end) return false;
  return true;
}


export interface AIConfig {
  id: string;
  account_id?: string;
  user_id?: string;
  provider: string;
  api_key: string;
  model: string;
  temperature: number;
  max_tokens: number;
  is_active?: boolean;
  image_enabled?: boolean;
  images_per_article?: number;
}


export type WritingTone = 'professional' | 'casual';


export function normalizeAiConfig(config: AIConfig): AIConfig {
  const provider = String(config.provider || '').toLowerCase();
  return { ...config, model: normalizeAiModel(provider, config.model) };
}


export function resolveWritingTone(value: unknown): WritingTone {
  const normalized = String(value || '').trim().toLowerCase();
  if (normalized === 'casual' || normalized === 'friendly' || normalized === 'desu_masu') {
    return 'casual';
  }
  if (normalized === 'professional' || normalized === 'technical' || normalized === 'da_dearu') {
    return 'professional';
  }
  return 'professional';
}


export function normalizeWhitespace(value: string): string {
  return String(value || '').replace(/\s+/g, ' ').trim();
}


export interface OutlineSection {
  title: string;
  level: number;
  description: string;
  isLead: boolean;
  estimatedWordCount: number;
}


export interface ArticleOutline {
  title: string;
  sections: OutlineSection[];
}


export function trimForLog(text: string, maxLength: number): string {
  const normalized = String(text || '').replace(/\s+/g, ' ').trim();
  if (normalized.length <= maxLength) return normalized;
  return `${normalized.slice(0, maxLength)}...`;
}

