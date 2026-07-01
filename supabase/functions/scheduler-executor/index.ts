import { createClient } from 'npm:@supabase/supabase-js@2';
import { DOMParser } from 'https://deno.land/x/deno_dom/deno-dom-wasm.ts';
import { DEFAULT_TARGET_WORD_COUNT } from '../../../src/shared/generationPolicy.ts';
import {
  countGeneratedChars,
  formatArticleBodyForReadability,
  generateOutlineWithAutoModeStyle,
  insertSubheadingsIntoLongSections,
} from '../../../src/shared/articleGenerationCore.ts';
import {
  buildAutoModeQualityInstructions,
  buildAutoOutlineRetryInstructions,
  compactAutoModeInstructions,
  evaluateAutoOutlineQuality,
} from '../../../src/shared/autoModeQuality.ts';
import { DEFAULT_FACT_CHECK_MAX_ITEMS, selectFactCheckItems } from '../../../src/shared/factCheckCore.ts';
import { generateTitleSuggestionsWithSharedCore } from '../../../src/shared/titleGenerationCore.ts';
import { normalizeAiModel, supportsTemperature } from '../../../src/shared/aiModelCatalog.ts';
import {
  applyFactCheckCorrections,
  extractFactsFromContent,
  verifyFactsBatch,
} from './_fact-check-helpers.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Client-Info, Apikey',
};

const parseBoolean = (value: unknown, fallback = false): boolean => {
  if (value == null || value === '') return fallback;
  const normalized = String(value).trim().toLowerCase();
  return normalized === '1' || normalized === 'true' || normalized === 'yes' || normalized === 'on';
};

const SCHEDULE_EXECUTION_LOCK_TTL_SECONDS = 20 * 60;
const FALLBACK_SCHEDULE_ROW_LOCK_WINDOW_SECONDS = 8 * 60;
const AI_REQUEST_TIMEOUT_MS = 180 * 1000;
const STALE_RUNNING_EXECUTION_MINUTES = 12;
let warnedMissingSchedulerLockRpc = false;
let warnedUsingFallbackScheduleRowLock = false;
let warnedSchedulerLockUnavailable = false;

class AiOutputTruncatedError extends Error {
  partialText: string;

  constructor(message: string, partialText: string) {
    super(message);
    this.name = 'AiOutputTruncatedError';
    this.partialText = partialText;
  }
}

type ScheduleExecutionLock = {
  acquired: boolean;
  scheduleId: string;
  wpConfigId: string;
  lockToken: string | null;
};

async function fetchWithTimeout(
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

interface WordPressConfig {
  id: string;
  account_id?: string;
  name: string;
  url: string;
  username: string;
  password: string; // This maps to 'applicationPassword' in the DB column 'password'
  category: string;
  post_type: string; // Custom post type slug (e.g., 'posts', 'sushirecipe', 'product')
  style_reference_url?: string;
  is_active: boolean;
}

interface Schedule {
  id: string;
  account_id?: string;
  user_id?: string;
  ai_config_id: string;
  ai_provider_override?: string;
  ai_model_override?: string;
  wp_config_id: string;
  post_time: string;
  frequency: string;
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

class KeywordExhaustedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'KeywordExhaustedError';
  }
}

function isKeywordExhaustedError(error: unknown): boolean {
  return (
    error instanceof KeywordExhaustedError ||
    (typeof error === 'object' &&
      error !== null &&
      (error as any).name === 'KeywordExhaustedError')
  );
}

function parseJstDate(input: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input)) return null;
  const [y, m, d] = input.split('-').map(Number);
  const date = new Date(Date.UTC(y, m - 1, d, 0, 0, 0));
  return Number.isNaN(date.getTime()) ? null : date;
}

function getCurrentJstDate(now = new Date()): Date {
  const jstString = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Tokyo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
  return parseJstDate(jstString) ?? new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

function isWithinScheduleDateRange(schedule: Schedule, now = new Date()): boolean {
  const currentJstDate = getCurrentJstDate(now);
  const start = schedule.start_date ? parseJstDate(schedule.start_date) : null;
  const end = schedule.end_date ? parseJstDate(schedule.end_date) : null;

  if (start && currentJstDate < start) return false;
  if (end && currentJstDate > end) return false;
  return true;
}

interface AIConfig {
  id: string;
  account_id?: string;
  provider: string;
  api_key: string;
  model: string;
  temperature: number;
  max_tokens: number;
  is_active?: boolean;
  image_enabled?: boolean;
  images_per_article?: number;
}

type WritingTone = 'professional' | 'casual';

function normalizeAiConfig(config: AIConfig): AIConfig {
  const provider = String(config.provider || '').toLowerCase();
  return { ...config, model: normalizeAiModel(provider, config.model) };
}

function resolveWritingTone(value: unknown): WritingTone {
  const normalized = String(value || '').trim().toLowerCase();
  if (normalized === 'casual' || normalized === 'friendly' || normalized === 'desu_masu') {
    return 'casual';
  }
  if (normalized === 'professional' || normalized === 'technical' || normalized === 'da_dearu') {
    return 'professional';
  }
  return 'professional';
}

function normalizeWhitespace(value: string): string {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function truncateForStyleReference(value: string, minLength = 500, maxLength = 800): string {
  const text = normalizeWhitespace(value);
  if (!text) return '';
  if (text.length <= maxLength) return text;

  const candidate = text.slice(0, maxLength);
  const boundary = Math.max(
    candidate.lastIndexOf('。'),
    candidate.lastIndexOf('！'),
    candidate.lastIndexOf('？'),
    candidate.lastIndexOf('. ')
  );

  if (boundary >= minLength) {
    return candidate.slice(0, boundary + 1).trim();
  }
  return candidate.trim();
}

async function fetchStyleReferenceSample(styleReferenceUrl?: string): Promise<string> {
  const url = String(styleReferenceUrl || '').trim();
  if (!url) return '';

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8000);
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; AutomaticWriter/1.0; +https://example.com/bot)',
      },
      signal: controller.signal,
    });
    clearTimeout(timer);

    if (!response.ok) {
      throw new Error(`style reference fetch failed: ${response.status}`);
    }

    const html = await response.text();
    const doc = new DOMParser().parseFromString(html, 'text/html');
    if (!doc) return '';

    const removeTargets = doc.querySelectorAll('script, style, nav, footer, header, noscript, aside, form');
    removeTargets.forEach((node) => (node as any).remove());

    const mainNode =
      doc.querySelector('article') ||
      doc.querySelector('main') ||
      doc.querySelector('[role="main"]') ||
      doc.body;

    const paragraphNodes = mainNode?.querySelectorAll('p') || [];
    let text = Array.from(paragraphNodes)
      .map((node) => normalizeWhitespace(node.textContent))
      .filter((line) => line.length >= 20)
      .join(' ');

    if (!text) {
      text = normalizeWhitespace(mainNode?.textContent || '');
    }

    return truncateForStyleReference(text);
  } catch (error) {
    console.warn('Failed to fetch style reference sample:', error);
    return '';
  }
}

function buildStyleReferenceInstructions(sample: string, styleReferenceUrl?: string): string {
  const normalizedSample = truncateForStyleReference(sample);
  if (!normalizedSample) return '';

  const sourceLine = styleReferenceUrl ? `Reference URL: ${styleReferenceUrl}` : '';
  return [
    'Use the following writing style sample only as a tone and structure reference. Do not copy facts or wording from it.',
    sourceLine,
    'Style sample:',
    normalizedSample,
  ].filter(Boolean).join('\n');
}

type ModelRate = { input: number; output: number };

interface OutlineSection {
  title: string;
  level: number;
  description: string;
  isLead: boolean;
  estimatedWordCount: number;
}

interface ArticleOutline {
  title: string;
  sections: OutlineSection[];
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    const body = await req.text();
    console.log('Raw request body:', body);
    const params = body ? JSON.parse(body) : {};
    console.log('Parsed params:', params);
    const forceExecute = params.forceExecute === true;
    const targetScheduleId = params.scheduleId;
    const allowDuplicateForce = params.allowDuplicateForce === true;

    if (params.action === 'clear_execution_state' && targetScheduleId) {
      const result = await clearScheduleExecutionState(supabase, targetScheduleId);
      return new Response(
        JSON.stringify({ success: true, action: 'clear_execution_state', ...result }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // 髯ｷ繝ｻ・ｽ・ｦ鬨ｾ繝ｻ繝ｻ・取ｺｽ・ｹ・ｧ繝ｻ・ｸ驛｢譏ｴ繝ｻ邵ｺ驢搾ｽｹ・ｧ陝ｶ譎・峩髯ｷ・ｷ隴ｴ・ｧ隰斐・・ｫ・｢繝ｻ・｢髫ｰ・ｨ繝ｻ・ｰ驍ｵ・ｺ繝ｻ・ｨ驍ｵ・ｺ陷会ｽｱ遯ｶ・ｻ髯橸ｽｳ陞溘ｑ・ｽ・ｾ繝ｻ・ｩ郢晢ｽｻ陋ｹ・ｻ郢晢ｽｰ驛｢譏ｴ繝ｻ邵ｺ驢搾ｽｹ・ｧ繝ｻ・ｰ驛｢譎｢・ｽ・ｩ驛｢・ｧ繝ｻ・ｦ驛｢譎｢・ｽ・ｳ驛｢譎臥櫨繝ｻ・ｮ雋・ｽｯ繝ｻ・｡隶吝ｮ郁・郢晢ｽｻ郢晢ｽｻ
    const processSchedules = async () => {
      const schedulerStartTime = Date.now();
      console.log('Scheduler execution started:', new Date(schedulerStartTime).toISOString());
      await markStaleRunningExecutionsFailed(supabase);
      const stats = {
        totalActive: 0,
        considered: 0,
        executed: 0,
        skipped: 0,
        failed: 0,
      };

      if (forceExecute) {
        console.log(`FORCE EXECUTE MODE: Ignoring time checks (Target: ${targetScheduleId || 'ALL'})`);
      }

      // 1. 驛｢・ｧ繝ｻ・｢驛｢・ｧ繝ｻ・ｯ驛｢譏ｴ繝ｻ邵ｺ繝ｻ・ｹ譎・§遶顔ｾｨI鬮ｫ・ｪ繝ｻ・ｭ髯橸ｽｳ陞｢・ｹ繝ｻ螳壽╂鬮｢ﾂ繝ｻ・ｾ郢晢ｽｻ
      const { data: aiConfigs, error: aiError } = await supabase
        .from('ai_configs')
        .select('*')
        .order('is_active', { ascending: false })
        .order('created_at', { ascending: false });

      if (aiError || !aiConfigs || aiConfigs.length === 0) {
        console.error('No AI config found:', aiError);
        return stats;
      }

      const normalizedAiConfigs = (aiConfigs as AIConfig[]).map((config) => normalizeAiConfig(config));
      const activeAiConfig = normalizedAiConfigs.find((config) => config.is_active) || normalizedAiConfigs[0];
      const aiConfigMap = new Map(normalizedAiConfigs.map((config) => [config.id, config]));
      console.log('Default active AI config:', activeAiConfig.provider, activeAiConfig.model);

      // 1.5 髯ｷ・ｷ郢晢ｽｻ繝ｻ・ｨ繝ｻ・ｮAPI驛｢譎冗樟郢晢ｽｻ驛｢・ｧ繝ｻ・ｯ驛｢譎｢・ｽ・ｳ驛｢譎｢・ｽ・ｻ驛｢・ｧ繝ｻ・ｭ驛｢譎｢・ｽ・ｼ驍ｵ・ｺ繝ｻ・ｮ髯ｷ・ｿ鬮｢ﾂ繝ｻ・ｾ郢晢ｽｻ
      let chatworkApiToken: string | null = null;
      let chatworkRoomId: string | null = null;
      let chatworkMessageTemplate: string | null = null;
      let factCheckAlertChatworkRoomId: string | null = null;
      let factCheckNotifyMode: string | null = null;
      let serpApiKey: string | null = null;
      let googleApiKey: string | null = null;
      let searchEngineId: string | null = null;
      let imageCostUsdPerImage = 0.04;
      let maxPostsPerSitePerRun = 1;
      let maxTotalPostsPerRun = 1;

      const { data: appSettings, error: appSettingsError } = await supabase
        .from('app_settings')
        .select('key, value')
        .in('key', [
          'chatwork_api_token',
          'chatwork_room_id',
          'chatwork_message_template',
          'fact_check_alert_chatwork_room_id',
          'fact_check_notify_mode',
          'serpapi_key',
          'google_custom_search_api_key',
          'google_custom_search_engine_id',
          'image_cost_usd_per_image',
          'scheduler_max_posts_per_run',
          'scheduler_max_total_posts_per_run'
        ]);

      if (appSettingsError) {
        console.error('Error fetching app_settings:', appSettingsError);
      }

      console.log('App settings fetched:', JSON.stringify(appSettings));

      if (appSettings) {
        appSettings.forEach((setting: any) => {
          if (setting.key === 'chatwork_api_token') chatworkApiToken = setting.value;
          if (setting.key === 'chatwork_room_id') chatworkRoomId = setting.value;
          if (setting.key === 'chatwork_message_template') chatworkMessageTemplate = setting.value;
          if (setting.key === 'fact_check_alert_chatwork_room_id') factCheckAlertChatworkRoomId = setting.value;
          if (setting.key === 'fact_check_notify_mode') factCheckNotifyMode = setting.value;
          if (setting.key === 'serpapi_key') serpApiKey = setting.value;
          if (setting.key === 'google_custom_search_api_key') googleApiKey = setting.value;
          if (setting.key === 'google_custom_search_engine_id') searchEngineId = setting.value;
          if (setting.key === 'image_cost_usd_per_image') {
            const n = Number(setting.value);
            if (Number.isFinite(n) && n >= 0) imageCostUsdPerImage = n;
          }
          if (setting.key === 'scheduler_max_posts_per_run') {
            const n = Number(setting.value);
            if (Number.isFinite(n) && n > 0) {
              maxPostsPerSitePerRun = Math.floor(n);
            }
          }
          if (setting.key === 'scheduler_max_total_posts_per_run') {
            const n = Number(setting.value);
            if (Number.isFinite(n) && n > 0) {
              maxTotalPostsPerRun = Math.floor(n);
            }
          }
        });
      }

      console.log('Key values - SerpAPI:', serpApiKey ? 'Found(hidden)' : 'Not Found', 'Google:', googleApiKey ? 'Found(hidden)' : 'Not Found');

      // 2. 驛｢・ｧ繝ｻ・ｹ驛｢・ｧ繝ｻ・ｱ驛｢・ｧ繝ｻ・ｸ驛｢譎｢・ｽ・･驛｢譎｢・ｽ・ｼ驛｢譎｢・ｽ・ｫ髯ｷ・ｿ鬮｢ﾂ繝ｻ・ｾ郢晢ｽｻ
      let { data: schedules, error: schedError } = await supabase
        .from('schedule_settings')
        .select(`*, wordpress_configs!inner(*)`);

      if (schedError) {
        console.error('Database query failed:', schedError);
        return stats;
      }

      schedules = (schedules || []).filter((s: any) => {
        if (forceExecute && targetScheduleId && s.id === targetScheduleId) return true;
        return s.status === true || s.is_active === true;
      });

      if (forceExecute && targetScheduleId) {
        schedules = schedules.filter((s: any) => s.id === targetScheduleId);
      }

      if (!schedules || schedules.length === 0) {
        console.log('No active schedules found');
        return stats;
      }

      stats.totalActive = schedules.length;
      console.log(`Found ${schedules.length} active schedules`);

      const now = new Date();
      const jstFormatter = new Intl.DateTimeFormat('ja-JP', {
        timeZone: 'Asia/Tokyo',
        hour: '2-digit', minute: '2-digit', hour12: false
      });
      const currentTimeJST = jstFormatter.format(now);
      const currentDateTimeJST = new Intl.DateTimeFormat('ja-JP', {
        timeZone: 'Asia/Tokyo',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: false
      }).format(now);
      console.log(`Current JST datetime: ${currentDateTimeJST} (time-check=${currentTimeJST})`);

      // 3. 髯ｷ・ｷ郢晢ｽｻ邵ｺ蟶ｷ・ｹ・ｧ繝ｻ・ｱ驛｢・ｧ繝ｻ・ｸ驛｢譎｢・ｽ・･驛｢譎｢・ｽ・ｼ驛｢譎｢・ｽ・ｫ髯ｷ繝ｻ・ｽ・ｦ鬨ｾ繝ｻ繝ｻ
      const executedWpConfigIds = new Set<string>();
      for (const schedule of schedules) {
        stats.considered += 1;
        const scheduleSetting: Schedule = schedule as any;
        const wpConfig: WordPressConfig = (schedule as any).wordpress_configs;
        const scheduleAccountId = scheduleSetting.account_id || wpConfig.account_id;
        const timeToUse = scheduleSetting.post_time;

        if (!forceExecute && executedWpConfigIds.has(wpConfig.id)) {
          stats.skipped += 1;
          console.log(`Skipping schedule ${scheduleSetting.id}: already executed for site ${wpConfig.id} in this run`);
          continue;
        }

        if (!forceExecute && maxPostsPerSitePerRun > 0) {
          const siteThrottleMinutes = 1;
          const recentExecutionCount = await countExecutionsForWpConfigWithinMinutes(
            supabase,
            wpConfig.id,
            siteThrottleMinutes
          );
          if (recentExecutionCount >= maxPostsPerSitePerRun) {
            stats.skipped += 1;
            console.log(
              `Skipping schedule ${scheduleSetting.id}: site throttle active for ${wpConfig.id} (executions in last ${siteThrottleMinutes} min: ${recentExecutionCount}, limit per site: ${maxPostsPerSitePerRun})`
            );
            continue;
          }
        }

        if (!forceExecute && !isWithinScheduleDateRange(scheduleSetting)) {
          stats.skipped += 1;
          console.log(
            `Skipping schedule ${scheduleSetting.id}: outside configured date range (start=${scheduleSetting.start_date ?? '-'}, end=${scheduleSetting.end_date ?? '-'})`
          );
          continue;
        }

        let shouldExecute = forceExecute || await shouldExecuteNow(timeToUse, currentTimeJST, scheduleSetting.frequency, scheduleSetting.id, supabase);
        const bypassExecutionLock = forceExecute && allowDuplicateForce;

        // Force execution guard: avoid duplicate posts from repeated manual triggers.
        if (forceExecute && shouldExecute && !allowDuplicateForce) {
          const recentlyExecuted = await wasExecutedWithinMinutes(scheduleSetting.id, supabase, 1);
          if (recentlyExecuted) {
            shouldExecute = false;
            console.log(`Skipping force execution for ${wpConfig.name}: executed within last 1 minute`);
          }
        }

        if (shouldExecute) {
          if (!forceExecute && stats.executed >= maxTotalPostsPerRun) {
            stats.skipped += 1;
            console.log(
              `Skipping schedule ${scheduleSetting.id}: max total posts per run reached (${maxTotalPostsPerRun})`
            );
            continue;
          }

          let acquiredExecutionLock: ScheduleExecutionLock | null = null;
          if (!bypassExecutionLock) {
            const lockAcquired = await acquireScheduleExecutionLock(
              supabase,
              scheduleSetting.id,
              wpConfig.id,
              SCHEDULE_EXECUTION_LOCK_TTL_SECONDS
            );
            if (!lockAcquired.acquired) {
              stats.skipped += 1;
              console.log(`Skipping schedule ${scheduleSetting.id}: execution lock is active`);
              if (forceExecute) {
                await recordForceExecutionSkippedByLock(supabase, scheduleSetting, wpConfig);
              }
              continue;
            }
            acquiredExecutionLock = lockAcquired;

            if (!forceExecute) {
              const shouldExecuteAfterLock = await shouldExecuteNow(
                timeToUse,
                currentTimeJST,
                scheduleSetting.frequency,
                scheduleSetting.id,
                supabase
              );

              if (!shouldExecuteAfterLock) {
                stats.skipped += 1;
                console.log(`Skipping schedule ${scheduleSetting.id}: no longer eligible after lock acquisition`);
                await releaseScheduleExecutionLock(
                  supabase,
                  acquiredExecutionLock.scheduleId,
                  acquiredExecutionLock.wpConfigId,
                  acquiredExecutionLock.lockToken
                );
                continue;
              }
            }
          }

          console.log(`Executing schedule for ${wpConfig.name}`);

          // Prefer schedule-specific AI config. Fall back to the active config.
          const accountAiConfigs = normalizedAiConfigs.filter((config) => {
            if (!scheduleAccountId) return true;
            return config.account_id === scheduleAccountId;
          });
          const accountActiveAiConfig = accountAiConfigs.find((config) => config.is_active) || accountAiConfigs[0];

          if (!accountActiveAiConfig) {
            stats.failed += 1;
            console.error(`No AI config found for account ${scheduleAccountId || 'unknown'} schedule ${scheduleSetting.id}`);
            if (acquiredExecutionLock) {
              await releaseScheduleExecutionLock(
                supabase,
                acquiredExecutionLock.scheduleId,
                acquiredExecutionLock.wpConfigId,
                acquiredExecutionLock.lockToken
              );
            }
            continue;
          }

          let accountChatworkApiToken = chatworkApiToken;
          let accountChatworkRoomId = chatworkRoomId;
          let accountChatworkMessageTemplate = chatworkMessageTemplate;
          let accountFactCheckAlertChatworkRoomId = factCheckAlertChatworkRoomId;
          let accountFactCheckNotifyMode = factCheckNotifyMode;
          let accountSerpApiKey = serpApiKey;
          let accountGoogleApiKey = googleApiKey;
          let accountSearchEngineId = searchEngineId;
          let accountImageCostUsdPerImage = imageCostUsdPerImage;
          let accountImageGenerationAllowed = true;

          if (scheduleAccountId) {
            const { data: accountAppSettings, error: accountAppSettingsError } = await supabase
              .from('app_settings')
              .select('key, value')
              .eq('account_id', scheduleAccountId)
              .in('key', [
                'chatwork_api_token',
                'chatwork_room_id',
                'chatwork_message_template',
                'fact_check_alert_chatwork_room_id',
                'fact_check_notify_mode',
                'serpapi_key',
                'google_custom_search_api_key',
                'google_custom_search_engine_id',
                'image_cost_usd_per_image',
              ]);

            if (accountAppSettingsError) {
              console.error(`Error fetching app_settings for account ${scheduleAccountId}:`, accountAppSettingsError);
            }

            (accountAppSettings || []).forEach((setting: any) => {
              if (setting.key === 'chatwork_api_token') accountChatworkApiToken = setting.value;
              if (setting.key === 'chatwork_room_id') accountChatworkRoomId = setting.value;
              if (setting.key === 'chatwork_message_template') accountChatworkMessageTemplate = setting.value;
              if (setting.key === 'fact_check_alert_chatwork_room_id') accountFactCheckAlertChatworkRoomId = setting.value;
              if (setting.key === 'fact_check_notify_mode') accountFactCheckNotifyMode = setting.value;
              if (setting.key === 'serpapi_key') accountSerpApiKey = setting.value;
              if (setting.key === 'google_custom_search_api_key') accountGoogleApiKey = setting.value;
              if (setting.key === 'google_custom_search_engine_id') accountSearchEngineId = setting.value;
              if (setting.key === 'image_cost_usd_per_image') {
                const n = Number(setting.value);
                if (Number.isFinite(n) && n >= 0) accountImageCostUsdPerImage = n;
              }
            });

            const { data: accountRow, error: accountError } = await supabase
              .from('accounts')
              .select('feature_flags')
              .eq('id', scheduleAccountId)
              .maybeSingle();

            if (accountError) {
              console.error(`Error fetching account feature_flags for account ${scheduleAccountId}:`, accountError);
            }

            accountImageGenerationAllowed = accountRow?.feature_flags?.image_generation !== false;
          }

          const requestedAiConfigId = scheduleSetting.ai_config_id;
          const requestedAiConfig = requestedAiConfigId
            ? accountAiConfigs.find((config) => config.id === requestedAiConfigId) || null
            : null;
          const baseAiConfig = requestedAiConfig || accountActiveAiConfig;
          const overrideProvider = String(scheduleSetting.ai_provider_override || '').trim().toLowerCase();
          const overrideModel = String(scheduleSetting.ai_model_override || '').trim();
          let effectiveAiConfig = baseAiConfig;

          if (requestedAiConfig) {
            console.log(
              `Using schedule AI config: ${baseAiConfig.provider} (${baseAiConfig.model}) [${baseAiConfig.id}]`
            );
          } else if (requestedAiConfigId) {
            console.warn(
              `Schedule AI config not found (${requestedAiConfigId}). Falling back to active config ${accountActiveAiConfig.id}`
            );
          } else {
            console.log(`No schedule AI config specified. Using active config ${accountActiveAiConfig.id}`);
          }

          if ((overrideProvider && !overrideModel) || (!overrideProvider && overrideModel)) {
            console.warn(`Ignoring incomplete AI override for schedule ${scheduleSetting.id}: provider="${overrideProvider}" model="${overrideModel}"`);
          } else if (overrideProvider && overrideModel) {
            effectiveAiConfig = normalizeAiConfig({
              ...baseAiConfig,
              provider: overrideProvider,
              model: overrideModel,
            });
            console.log(
              `Applying schedule model override: ${effectiveAiConfig.provider} (${effectiveAiConfig.model}) [auth from ${baseAiConfig.id}]`
            );
          }

          const effectiveScheduleSetting = {
            ...scheduleSetting,
            chatwork_room_id: scheduleSetting.chatwork_room_id || accountChatworkRoomId || '',
            chatwork_message_template: scheduleSetting.chatwork_message_template || accountChatworkMessageTemplate || '',
            fact_check_alert_chatwork_room_id: scheduleSetting.fact_check_alert_chatwork_room_id || accountFactCheckAlertChatworkRoomId || '',
            fact_check_notify_on_every_run: typeof scheduleSetting.fact_check_notify_on_every_run === 'boolean'
              ? scheduleSetting.fact_check_notify_on_every_run
              : accountFactCheckNotifyMode === 'every',
            fact_check_notify_on_anomaly: typeof scheduleSetting.fact_check_notify_on_anomaly === 'boolean'
              ? scheduleSetting.fact_check_notify_on_anomaly
              : accountFactCheckNotifyMode !== 'every',
            ...(accountImageGenerationAllowed
              ? {}
              : {
                  image_generation_enabled: false,
                  images_per_article: 0,
                }),
          };

          try {
            await executeSchedule(
              effectiveScheduleSetting,
              wpConfig,
              effectiveAiConfig,
              supabase,
              accountChatworkApiToken,
              accountSerpApiKey,
              accountGoogleApiKey,
              accountSearchEngineId,
              accountImageCostUsdPerImage,
              schedulerStartTime,
              forceExecute ? 'manual' : 'automatic'
            );
            stats.executed += 1;
            executedWpConfigIds.add(wpConfig.id);
          } catch (error: any) {
            if (isKeywordExhaustedError(error)) {
              console.log(`Skipping schedule ${scheduleSetting.id}: ${error.message}`);
              stats.skipped += 1;
            } else {
              console.error(`Failed to execute schedule for ${wpConfig.name}:`, error);
              await recordScheduleExecutionFailure(
                supabase,
                scheduleSetting,
                wpConfig,
                effectiveAiConfig,
                error,
                forceExecute ? 'manual' : 'automatic'
              );
              await notifyScheduleExecutionFailure(
                effectiveScheduleSetting,
                wpConfig,
                accountChatworkApiToken,
                error
              );
              stats.failed += 1;
            }
          } finally {
            if (acquiredExecutionLock) {
              await releaseScheduleExecutionLock(
                supabase,
                acquiredExecutionLock.scheduleId,
                acquiredExecutionLock.wpConfigId,
                acquiredExecutionLock.lockToken
              );
            }
          }
        } else {
          stats.skipped += 1;
        }
      }

      return stats;
    };

    if (forceExecute) {
      console.log('Starting background execution for Force Run');
      const processPromise = processSchedules().catch((err) => {
        console.error('Background processing error:', err);
      });
      // Supabase Edge Functions / Deno Deploy specific API
      // @ts-ignore
      EdgeRuntime.waitUntil(processPromise);

      return new Response(
        JSON.stringify({
          success: true,
          mode: 'background',
          message: 'Request accepted. Processing started in background. Please check Execution History for results.',
          timestamp: new Date().toISOString(),
        }),
        { status: 202, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    } else {
      console.log('Starting foreground execution for scheduled run');
      const stats = await processSchedules();

      return new Response(
        JSON.stringify({
          success: true,
          mode: 'foreground',
          message: 'Scheduled processing completed.',
          stats,
          timestamp: new Date().toISOString(),
        }),
        { status: 202, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

  } catch (error: any) {
    console.error('Scheduler handler error:', error);
    return new Response(
      JSON.stringify({ success: false, error: error.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});

function isMissingSchedulerLockRpc(error: any): boolean {
  const errorText = [
    String(error?.message || ''),
    String(error?.details || ''),
    String(error?.hint || ''),
  ].join(' ').toLowerCase();

  return (
    errorText.includes('could not find the function') ||
    (errorText.includes('function') && errorText.includes('does not exist'))
  );
}

async function acquireScheduleExecutionLock(
  supabase: any,
  scheduleId: string,
  wpConfigId: string,
  lockSeconds = SCHEDULE_EXECUTION_LOCK_TTL_SECONDS
): Promise<ScheduleExecutionLock> {
  const notAcquired: ScheduleExecutionLock = {
    acquired: false,
    scheduleId,
    wpConfigId,
    lockToken: null,
  };

  const { data, error } = await supabase.rpc('acquire_scheduler_execution_lock', {
    p_schedule_id: scheduleId,
    p_wp_config_id: wpConfigId,
    p_lock_seconds: lockSeconds,
  });

  if (error) {
    if (isMissingSchedulerLockRpc(error)) {
      if (!warnedMissingSchedulerLockRpc) {
        console.warn(
          'Scheduler lock RPC "acquire_scheduler_execution_lock" is not available. ' +
          'Apply latest Supabase migration to enable duplicate-run protection.'
        );
        warnedMissingSchedulerLockRpc = true;
      }
    } else {
      console.error(`Failed to acquire scheduler execution lock for ${scheduleId}:`, error);
    }

    const fallbackAcquired = await acquireScheduleExecutionLockWithScheduleRow(
      supabase,
      scheduleId,
      lockSeconds
    );

    if (fallbackAcquired !== null) {
      if (!warnedUsingFallbackScheduleRowLock) {
        console.warn(
          'Using fallback schedule row lock (schedule_settings.updated_at). ' +
          'Please apply latest Supabase migration for robust lock RPC support.'
        );
        warnedUsingFallbackScheduleRowLock = true;
      }
      return {
        acquired: fallbackAcquired,
        scheduleId,
        wpConfigId,
        lockToken: null,
      };
    }

    if (!warnedSchedulerLockUnavailable) {
      console.warn(
        'Scheduler execution lock is unavailable (RPC + fallback both failed). ' +
        'Proceeding without lock 遯ｶ繝ｻapply latest migration to enable duplicate-run protection.'
      );
      warnedSchedulerLockUnavailable = true;
    }
    return {
      acquired: true,
      scheduleId,
      wpConfigId,
      lockToken: null,
    };
  }

  const lockRow = Array.isArray(data) ? data[0] : data;
  const acquired = lockRow?.acquired === true;
  if (!acquired) return notAcquired;

  console.log(
    `Schedule lock acquired for ${scheduleId} (until ${lockRow?.locked_until || 'unknown'})`
  );
  return {
    acquired: true,
    scheduleId,
    wpConfigId,
    lockToken: lockRow?.lock_token || null,
  };
}

async function releaseScheduleExecutionLock(
  supabase: any,
  scheduleId: string,
  wpConfigId: string,
  lockToken?: string | null
): Promise<void> {
  try {
    if (lockToken) {
      const rpcResult = await supabase.rpc('release_scheduler_execution_lock', {
        p_schedule_id: scheduleId,
        p_wp_config_id: wpConfigId,
        p_lock_token: lockToken,
      });

      if (!rpcResult.error) {
        console.log(`Schedule lock released for ${scheduleId}`);
        return;
      }

      if (!isMissingSchedulerLockRpc(rpcResult.error)) {
        console.warn(`Failed to release scheduler execution lock via RPC for ${scheduleId}:`, rpcResult.error);
      }
    }

    let deleteQuery = supabase
      .from('scheduler_execution_locks')
      .delete()
      .eq('schedule_id', scheduleId)
      .eq('wp_config_id', wpConfigId);

    if (lockToken) {
      deleteQuery = deleteQuery.eq('lock_token', lockToken);
    }

    const { error } = await deleteQuery;
    if (error) {
      console.warn(`Failed to release scheduler execution lock row for ${scheduleId}:`, error);
      return;
    }
    console.log(`Schedule lock row released for ${scheduleId}`);
  } catch (error) {
    console.warn(`Unexpected error releasing scheduler execution lock for ${scheduleId}:`, error);
  }
}

function isMissingUpdatedAtColumn(error: any): boolean {
  const errorText = [
    String(error?.message || ''),
    String(error?.details || ''),
    String(error?.hint || ''),
  ].join(' ').toLowerCase();

  return errorText.includes('updated_at') && errorText.includes('does not exist');
}

function isMissingColumnError(error: any, columnName: string): boolean {
  if (!error) return false;
  const errorText = [
    String(error?.message || ''),
    String(error?.details || ''),
    String(error?.hint || ''),
  ].join(' ').toLowerCase();
  const normalizedColumn = columnName.toLowerCase();
  return errorText.includes(normalizedColumn) && (
    errorText.includes('does not exist') ||
    errorText.includes('schema cache') ||
    errorText.includes('could not find')
  );
}

async function createExecutionProgressHistory(
  supabase: any,
  params: {
    schedule: Schedule;
    wpConfig: WordPressConfig;
    keyword: string;
    title?: string;
    triggerType: 'manual' | 'automatic';
    stage: string;
    message: string;
    progress: number;
    aiConfig: AIConfig;
  }
): Promise<string | null> {
  const payload: Record<string, any> = {
    account_id: params.schedule.account_id || params.wpConfig.account_id || null,
    schedule_id: params.schedule.id,
    wordpress_config_id: params.wpConfig.id,
    executed_at: new Date().toISOString(),
    keyword_used: params.keyword,
    article_title: params.title || '',
    wordpress_post_id: '',
    status: 'running',
    error_message: null,
    cost_breakdown: {
      trigger_type: params.triggerType,
      generation_debug: {
        current_stage: params.stage,
        progress_message: params.message,
        progress_percent: params.progress,
        provider: params.aiConfig.provider || '',
        model: params.aiConfig.model || '',
        started_at: new Date().toISOString(),
      },
    },
    estimated_cost_usd: 0,
  };

  let result = await supabase
    .from('execution_history')
    .insert(payload)
    .select('id')
    .single();

  if (isMissingColumnError(result.error, 'account_id')) {
    delete payload.account_id;
    result = await supabase
      .from('execution_history')
      .insert(payload)
      .select('id')
      .single();
  }

  if (result.error) {
    console.error('Failed to create execution progress history:', result.error);
    return null;
  }

  return result.data?.id || null;
}

async function updateExecutionProgressHistory(
  supabase: any,
  historyId: string | null,
  params: {
    stage: string;
    message: string;
    progress: number;
    title?: string;
    debug?: Record<string, any>;
  }
): Promise<void> {
  if (!historyId) return;

  const generationDebug = {
    ...(params.debug || {}),
    current_stage: params.stage,
    progress_message: params.message,
    progress_percent: params.progress,
    updated_at: new Date().toISOString(),
  };

  const updatePayload: Record<string, any> = {
    status: 'running',
    cost_breakdown: {
      generation_debug: generationDebug,
    },
  };
  if (params.title !== undefined) {
    updatePayload.article_title = params.title;
  }

  const { error } = await supabase
    .from('execution_history')
    .update(updatePayload)
    .eq('id', historyId);

  if (error) {
    console.error('Failed to update execution progress history:', error);
  }
}

async function acquireScheduleExecutionLockWithScheduleRow(
  supabase: any,
  scheduleId: string,
  lockSeconds = SCHEDULE_EXECUTION_LOCK_TTL_SECONDS
): Promise<boolean | null> {
  const lockWindowSeconds = Math.max(
    60,
    Math.min(lockSeconds, FALLBACK_SCHEDULE_ROW_LOCK_WINDOW_SECONDS)
  );
  const nowIso = new Date().toISOString();
  const thresholdIso = new Date(Date.now() - lockWindowSeconds * 1000).toISOString();

  const thresholdAttempt = await supabase
    .from('schedule_settings')
    .update({ updated_at: nowIso })
    .eq('id', scheduleId)
    .lte('updated_at', thresholdIso)
    .select('id')
    .limit(1);

  if (thresholdAttempt.error) {
    if (isMissingUpdatedAtColumn(thresholdAttempt.error)) {
      return null;
    }
    console.error(`Fallback lock acquisition failed for ${scheduleId} (threshold):`, thresholdAttempt.error);
    return null;
  }

  const thresholdData = Array.isArray(thresholdAttempt.data) ? thresholdAttempt.data : [];
  if (thresholdData.length > 0) {
    console.log(`Fallback schedule row lock acquired for ${scheduleId} (window=${lockWindowSeconds}s)`);
    return true;
  }

  const nullAttempt = await supabase
    .from('schedule_settings')
    .update({ updated_at: nowIso })
    .eq('id', scheduleId)
    .is('updated_at', null)
    .select('id')
    .limit(1);

  if (nullAttempt.error) {
    if (isMissingUpdatedAtColumn(nullAttempt.error)) {
      return null;
    }
    console.error(`Fallback lock acquisition failed for ${scheduleId} (null check):`, nullAttempt.error);
    return null;
  }

  const nullData = Array.isArray(nullAttempt.data) ? nullAttempt.data : [];
  if (nullData.length > 0) {
    console.log(`Fallback schedule row lock acquired for ${scheduleId} (window=${lockWindowSeconds}s, null->set)`);
    return true;
  }

  return false;
}

// 髯橸ｽｳ雋・ｽｯ繝ｻ・｡陟募ｨｯ繝ｻ驍ｵ・ｺ繝ｻ・ｹ驍ｵ・ｺ鬮ｦ・ｪ・ゑｽｰ驛｢譏ｶ繝ｻ邵ｺ閾･・ｹ譏ｴ繝ｻ邵ｺ繝ｻ
async function shouldExecuteNow(
  scheduleTime: string,
  currentTime: string,
  frequency: string,
  scheduleId: string,
  supabase: any
): Promise<boolean> {
  const [scheduleHour, scheduleMinute] = scheduleTime.split(':').map(Number);
  const [currentHour, currentMinute] = currentTime.split(':').map(Number);

  const scheduleMinutes = scheduleHour * 60 + scheduleMinute;
  const currentMinutes = currentHour * 60 + currentMinute;

  // 髯橸ｽｳ雋・ｽｯ繝ｻ・｡隶吩ｸｻ・ｳ・ｩ髯ｷ隨ｬ隱薙・・ｼ陜捺ｻ捺ｻ矩し・ｺ陷ｷ・ｶ驍・・・ｹ・ｧ陷ｿ・･繝ｻ・ｮ雋・ｽｯ繝ｻ・｡鬲・ｼ夲ｽｽ・ｼ陝ｲ・ｨ繝ｻ蟶晢ｽｫ・ｦ繝ｻ・ｲ髮弱・・ｽ・｢驍ｵ・ｺ陷会ｽｱ・つ遶丞具ｽｰ驍ｵ・ｺ繝ｻ・､鬮ｫ・ｪ繝ｻ・ｭ髯橸ｽｳ陞｢・ｽ陷・ｽｾ髯具ｽｻ繝ｻ・ｻ驍ｵ・ｺ闕ｵ譎｢・ｽ繝ｻ髯具ｽｻ郢晢ｽｻ繝ｻ・ｻ繝ｻ・･髯ｷﾂ郢晢ｽｻ郢晢ｽｻ鬩包ｽｽ郢晢ｽｻ陝ｲ繝ｻ・ｸ・ｺ繝ｻ・ｧ髯橸ｽｳ雋・ｽｯ繝ｻ・｡陟暮ｯ会ｽｽ蟶晏搦繝ｻ・ｱ髯ｷ・ｿ繝ｻ・ｯ驍ｵ・ｺ陷ｷ・ｶ繝ｻ繝ｻ
  const diff = currentMinutes - scheduleMinutes;

  if (diff < 0 || diff > 5) {
    return false;
  }

  const lastExecution = await getLastAutomaticExecutionForCadence(
    supabase,
    scheduleId,
    scheduleTime
  );

  if (!lastExecution) {
    return true;
  }

  const lastExecutedAt = new Date(lastExecution.executed_at);
  const now = new Date();
  const hoursSinceLastExecution = (now.getTime() - lastExecutedAt.getTime()) / (1000 * 60 * 60);

  // 髫ｴ魃会ｽｽ・･髫ｴ蟷｢・ｽ・ｬ鬮ｫ・ｱ隶抵ｽｭ郢晢ｽｻ鬯ｯ繝ｻ・ｽ・ｻ髯溯ｶ｣・ｽ・ｦ驛｢・ｧ陞ｳ螢ｽ繝ｻ鬮ｫ・ｱ隶抵ｽｭ遶頑･｢譽秘包ｽｻ鬩ｪ・､
  const freqMap: Record<string, string> = {
    '毎日': 'daily',
    '毎週': 'weekly',
    '隔週': 'biweekly',
    '毎月': 'monthly',
  };
  const normalizedFreq = freqMap[frequency] || frequency;

  // JST驍ｵ・ｺ繝ｻ・ｧ驍ｵ・ｺ繝ｻ・ｮ髫ｴ魃会ｽｽ・･髣疲・・ｿ・ｶ繝ｻ・ｯ驕呈汚・ｽ・ｼ郢晢ｽｻ騾｡繝ｻ
  const jstDateFormatter = new Intl.DateTimeFormat('ja-JP', { timeZone: 'Asia/Tokyo', year: 'numeric', month: '2-digit', day: '2-digit' });
  const lastExecutedDate = jstDateFormatter.format(lastExecutedAt);
  const currentDate = jstDateFormatter.format(now);

  console.log(`[Freq Check] ${normalizedFreq}, Hours since: ${hoursSinceLastExecution.toFixed(1)}, Last day: ${lastExecutedDate}, Today: ${currentDate}`);

  if (normalizedFreq === 'daily') {
    // Strict daily behavior in JST: execute only when the date has changed.
    if (lastExecutedDate !== currentDate) {
      return true;
    }
  } else if (normalizedFreq === 'weekly' && hoursSinceLastExecution >= 24 * 6) {
    return true;
  } else if (normalizedFreq === 'biweekly' && hoursSinceLastExecution >= 24 * 12) {
    return true;
  } else if (normalizedFreq === 'monthly' && hoursSinceLastExecution >= 24 * 27) {
    return true;
  }

  return false;
}

function getJstMinutesOfDay(date: Date): number | null {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Tokyo',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(date);
  const hour = Number(parts.find((part) => part.type === 'hour')?.value);
  const minute = Number(parts.find((part) => part.type === 'minute')?.value);
  if (!Number.isFinite(hour) || !Number.isFinite(minute)) return null;
  return hour * 60 + minute;
}

function isExecutionNearScheduleTime(executedAt: string, scheduleTime: string): boolean {
  const [scheduleHour, scheduleMinute] = String(scheduleTime || '').split(':').map(Number);
  if (!Number.isFinite(scheduleHour) || !Number.isFinite(scheduleMinute)) return false;

  const executedMinutes = getJstMinutesOfDay(new Date(executedAt));
  if (executedMinutes == null) return false;

  const scheduleMinutes = scheduleHour * 60 + scheduleMinute;
  const diff = executedMinutes - scheduleMinutes;
  return diff >= 0 && diff <= 5;
}

function isAutomaticExecutionForCadence(row: any, scheduleTime: string): boolean {
  const triggerType = row?.cost_breakdown?.trigger_type;
  if (triggerType === 'manual') return false;
  if (triggerType === 'automatic') return true;

  // Legacy rows did not store trigger_type. Treat only executions that happened
  // during the scheduled time window as automatic cadence runs.
  return isExecutionNearScheduleTime(row?.executed_at, scheduleTime);
}

async function getLastAutomaticExecutionForCadence(
  supabase: any,
  scheduleId: string,
  scheduleTime: string
): Promise<{ executed_at: string } | null> {
  const { data, error } = await supabase
    .from('execution_history')
    .select('executed_at,status,cost_breakdown')
    .eq('schedule_id', scheduleId)
    .eq('status', 'success')
    .order('executed_at', { ascending: false })
    .limit(20);

  if (error) {
    console.warn(`Could not fetch automatic execution history for ${scheduleId}:`, error);
    return null;
  }

  const rows = Array.isArray(data) ? data : [];
  return rows.find((row) => isAutomaticExecutionForCadence(row, scheduleTime)) || null;
}

async function wasExecutedWithinMinutes(
  scheduleId: string,
  supabase: any,
  minutes: number
): Promise<boolean> {
  const { data: lastExecution } = await supabase
    .from('execution_history')
    .select('executed_at')
    .eq('schedule_id', scheduleId)
    .in('status', ['running', 'success'])
    .order('executed_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!lastExecution?.executed_at) return false;
  const last = new Date(lastExecution.executed_at);
  const now = new Date();
  const diffMinutes = (now.getTime() - last.getTime()) / (1000 * 60);
  return diffMinutes >= 0 && diffMinutes < minutes;
}

async function countExecutionsForWpConfigWithinMinutes(
  supabase: any,
  wpConfigId: string,
  minutes: number
): Promise<number> {
  const since = new Date(Date.now() - minutes * 60 * 1000).toISOString();
  const { count, error } = await supabase
    .from('execution_history')
    .select('id', { count: 'exact', head: true })
    .eq('wordpress_config_id', wpConfigId)
    .in('status', ['running', 'success'])
    .gte('executed_at', since);

  if (error) {
    console.error(`Failed to count recent executions for wp_config ${wpConfigId}:`, error);
    return 0;
  }

  return count ?? 0;
}

function resolveAiModelRate(provider: string, model: string): ModelRate {
  const p = String(provider || '').toLowerCase();
  const m = String(model || '').toLowerCase();

  // USD per 1M tokens. Values are rough estimation for budgeting.
  if (p === 'openai') {
    if (m.includes('gpt-5.5')) return { input: 5.00, output: 30.00 };
    if (m.includes('gpt-5.4-mini')) return { input: 0.75, output: 4.50 };
    if (m.includes('gpt-5.4')) return { input: 2.50, output: 15.00 };
    if (m.includes('gpt-5') && m.includes('mini')) return { input: 0.30, output: 2.50 };
    if (m.includes('gpt-5')) return { input: 1.25, output: 10.00 };
    if (m.includes('gpt-4o-mini')) return { input: 0.15, output: 0.60 };
    if (m.includes('gpt-4o')) return { input: 5.00, output: 15.00 };
    return { input: 0.30, output: 2.50 };
  }
  if (p === 'gemini') {
    if (m.includes('3.5-flash')) return { input: 1.50, output: 9.00 };
    if (m.includes('3.1-pro')) return { input: 2.00, output: 12.00 };
    if (m.includes('3.1-flash-lite')) return { input: 0.25, output: 1.50 };
    if (m.includes('2.5-pro')) return { input: 1.25, output: 10.00 };
    if (m.includes('2.5-flash')) return { input: 0.30, output: 2.50 };
    return { input: 0.30, output: 2.50 };
  }
  if (p === 'claude') {
    if (m.includes('opus-4-8')) return { input: 5.00, output: 25.00 };
    if (m.includes('haiku-4-5')) return { input: 1.00, output: 5.00 };
    if (m.includes('opus')) return { input: 15.00, output: 75.00 };
    if (m.includes('haiku')) return { input: 0.80, output: 4.00 };
    return { input: 3.00, output: 15.00 };
  }
  return { input: 1.00, output: 5.00 };
}

function estimateExecutionCostBreakdown(params: {
  provider: string;
  model: string;
  generatedChars: number;
  competitorResearchUsed: boolean;
  factCheckItemsChecked: number;
  imagesGenerated: number;
  imageUnitCostUsd: number;
}) {
  const rate = resolveAiModelRate(params.provider, params.model);
  const generationMultiplier = 1;

  // Rough token estimate assumptions for JP content:
  // 1000 chars ~= input 300 tokens + output 700 tokens.
  const inputTokens = Math.ceil((params.generatedChars / 1000) * 300 * generationMultiplier);
  const outputTokens = Math.ceil((params.generatedChars / 1000) * 700 * generationMultiplier);
  const aiCostUsd =
    (inputTokens / 1_000_000) * rate.input +
    (outputTokens / 1_000_000) * rate.output;

  // SerpAPI pricing varies by plan; this is an estimate for budgeting.
  const researchCostUsd = params.competitorResearchUsed ? 0.005 : 0;

  // Fact-check vendor pricing varies significantly. Keep as unknown in totals.
  const factCheckCostUsd = null;
  const imageCostUsd = params.imagesGenerated > 0
    ? params.imagesGenerated * Math.max(0, params.imageUnitCostUsd)
    : 0;

  const totalEstimatedUsd = aiCostUsd + researchCostUsd + imageCostUsd;

  return {
    ai: {
      provider: params.provider,
      model: params.model,
      tokens: {
        input_estimated: inputTokens,
        output_estimated: outputTokens,
      },
      rate_usd_per_1m_tokens: rate,
      estimated_usd: Number(aiCostUsd.toFixed(6)),
    },
    research: {
      serpapi_used: params.competitorResearchUsed,
      estimated_usd: Number(researchCostUsd.toFixed(6)),
    },
    fact_check: {
      items_checked: params.factCheckItemsChecked,
      estimated_usd: factCheckCostUsd,
    },
    images: {
      generated_count_estimated: params.imagesGenerated,
      unit_cost_usd: Number(params.imageUnitCostUsd.toFixed(6)),
      estimated_usd: Number(imageCostUsd.toFixed(6)),
    },
    assumptions: {
      char_to_token: '1000 chars ~= input 300 + output 700 tokens',
      excludes_unknown_services: ['fact_check'],
      includes: ['ai_generation', 'serpapi', 'image_generation'],
      image_price_source: 'app_settings.image_cost_usd_per_image',
    },
    total_estimated_usd: Number(totalEstimatedUsd.toFixed(6)),
  };
}

// AI provider call helper used by shared generation core.
async function callAI(
  prompt: string,
  aiConfig: AIConfig,
  maxTokens?: number
): Promise<string> {
  const resolvedAiConfig = normalizeAiConfig(aiConfig);
  const provider = String(resolvedAiConfig.provider || '').toLowerCase();
  const model = resolvedAiConfig.model;
  const apiKey = resolvedAiConfig.api_key;
  const temperature = resolvedAiConfig.temperature ?? 0.7;
  const resolvedMaxTokens = maxTokens ?? resolvedAiConfig.max_tokens ?? 2000;

  if (!apiKey) {
    throw new Error(`Missing API key for provider: ${provider}`);
  }

  if (provider === 'openai') {
    const response = await fetchWithTimeout('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model,
        messages: [{ role: 'user', content: prompt }],
        max_completion_tokens: resolvedMaxTokens,
        ...(supportsTemperature('openai', model) ? { temperature } : {}),
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`OpenAI API error: ${response.status} - ${errorText}`);
    }

    const data = await response.json();
    const choice = data?.choices?.[0];
    if (choice?.finish_reason === 'length') {
      throw new Error('OpenAI response was cut off because max_tokens was reached');
    }
    const content = choice?.message?.content;
    if (typeof content === 'string') return content;
    if (Array.isArray(content)) {
      return content
        .map((part: any) => (typeof part?.text === 'string' ? part.text : ''))
        .join('\n')
        .trim();
    }
    throw new Error('OpenAI API returned empty content');
  }

  if (provider === 'claude') {
    const response = await fetchWithTimeout('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model,
        max_tokens: resolvedMaxTokens,
        messages: [{ role: 'user', content: prompt }],
        ...(supportsTemperature('claude', model) ? { temperature } : {}),
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Claude API error: ${response.status} - ${errorText}`);
    }

    const data = await response.json();
    if (data?.stop_reason === 'max_tokens') {
      throw new Error('Claude response was cut off because max_tokens was reached');
    }
    const text = Array.isArray(data?.content)
      ? data.content
        .map((part: any) => (typeof part?.text === 'string' ? part.text : ''))
        .join('\n')
        .trim()
      : '';
    if (!text) throw new Error('Claude API returned empty content');
    return text;
  }

  if (provider === 'gemini') {
    const response = await fetchWithTimeout(
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: {
            temperature,
            maxOutputTokens: resolvedMaxTokens,
          },
        }),
      }
    );

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Gemini API error: ${response.status} - ${errorText}`);
    }

    const data = await response.json();
    const candidate = data?.candidates?.[0];
    const parts = candidate?.content?.parts;
    const text = Array.isArray(parts)
      ? parts
        .map((part: any) => (typeof part?.text === 'string' ? part.text : ''))
        .join('\n')
        .trim()
      : '';
    if (candidate?.finishReason === 'MAX_TOKENS') {
      if (text) {
        throw new AiOutputTruncatedError('Geminiの出力がmaxOutputTokens上限で途中終了しました。', text);
      }
      throw new Error('Geminiの出力がmaxOutputTokens上限で途中終了しました。');
    }
    if (!text) throw new Error('Gemini API returned empty content');
    return text;
  }

  throw new Error(`Unsupported AI provider: ${aiConfig.provider}`);
}

// === 隰ｾ・ｹ闖ｫ・ｮ2: 鬮｢・｢鬨ｾ・｣郢ｧ・ｭ郢晢ｽｼ郢晢ｽｯ郢晢ｽｼ郢晉判豁楢怎・ｺ郢晏･ﾎ晉ｹ昜ｻ｣繝ｻ ===

// 驕ｶ・ｶ陷ｷ蛹ｻ繝ｧ郢晢ｽｼ郢ｧ・ｿ邵ｺ荵晢ｽ蛾ｫ｢・｢鬨ｾ・｣郢ｧ・ｭ郢晢ｽｼ郢晢ｽｯ郢晢ｽｼ郢晏ｳｨ・定ｬ夲ｽｽ陷・ｽｺ
function extractRelatedKeywordsFromCompetitorData(
  competitorData: any,
  mainKeyword: string,
  limit: number = 5
): string[] {
  if (!competitorData?.articles || competitorData.articles.length === 0) return [];

  const wordFrequency = new Map<string, number>();
  const mainKeywordLower = mainKeyword.toLowerCase();

  for (const article of competitorData.articles) {
    // 髫募唱繝ｻ邵ｺ蜉ｱﾂｰ郢ｧ蟲ｨ縺冗ｹ晢ｽｼ郢晢ｽｯ郢晢ｽｼ郢晏ｳｨ・定ｬ夲ｽｽ陷・ｽｺ
    const headings: string[] = article.headings || [];
    for (const heading of headings) {
      // 髫募唱繝ｻ邵ｺ蜉ｱ・定怺蛟ｩ・ｪ讒ｭ竊楢崕繝ｻ迚｡邵ｺ蜉ｱ窶ｻ鬯・ｽｻ陟趣ｽｦ郢ｧ・ｫ郢ｧ・ｦ郢晢ｽｳ郢昴・
      const words = heading
        .replace(/[邵ｲ闊個莉｣ﾂ蠕個髦ｪﾂ蠑ｱﾂ謫ｾ・ｼ闌ｨ・ｼ繝ｻ)\[\]]/g, ' ')
        .split(/[\s邵ｲﾂ,邵ｲ竏壹・]+/)
        .map((w: string) => w.trim())
        .filter((w: string) => w.length >= 2 && w.length <= 20);

      for (const word of words) {
        if (word.toLowerCase() === mainKeywordLower) continue;
        wordFrequency.set(word, (wordFrequency.get(word) || 0) + 1);
      }
    }

    // metaDescription邵ｺ荵晢ｽ臥ｹｧ繧・￥郢晢ｽｼ郢晢ｽｯ郢晢ｽｼ郢晏ｳｨ・定ｬ夲ｽｽ陷・ｽｺ
    if (article.metaDescription) {
      const descWords = article.metaDescription
        .replace(/[。、！？「」『』（）()[\]【】,，.．:：;；/]/g, ' ')
        .split(/\s+/)
        .map((w: string) => w.trim())
        .filter((w: string) => w.length >= 2 && w.length <= 15);

      for (const word of descWords) {
        if (word.toLowerCase() === mainKeywordLower) continue;
        wordFrequency.set(word, (wordFrequency.get(word) || 0) + 1);
      }
    }
  }

  // 陷・ｽｺ霑ｴ・ｾ鬯・ｽｻ陟趣ｽｦ邵ｺ・ｧ郢ｧ・ｽ郢晢ｽｼ郢晏現・邵ｲ竏ｽ・ｸ雍具ｽｽ髦ｪ・帝恆譁絶・
  return Array.from(wordFrequency.entries())
    .filter(([, count]) => count >= 2) // 2陜玲ｨ費ｽｻ・･闕ｳ髮√・霑ｴ・ｾ邵ｺ蜉ｱ笳・ｹｧ繧・・邵ｺ・ｮ邵ｺ・ｿ
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([word]) => word);
}

function extractCompetitorHeadings(competitorData: any, limit: number = 15): string[] {
  if (!competitorData?.articles || competitorData.articles.length === 0) return [];

  const headings: string[] = [];
  const seen = new Set<string>();

  for (const article of competitorData.articles) {
    const articleHeadings = Array.isArray(article?.headings) ? article.headings : [];

    for (const heading of articleHeadings) {
      const normalized = String(heading || '')
        .replace(/<[^>]+>/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();

      if (!normalized || normalized.length < 3 || normalized.length > 120) continue;
      const key = normalized.toLowerCase();
      if (seen.has(key)) continue;

      seen.add(key);
      headings.push(normalized);
      if (headings.length >= limit) return headings;
    }
  }

  return headings;
}

// Google Custom Search API邵ｺ・ｧ鬮｢・｢鬨ｾ・｣郢ｧ・ｭ郢晢ｽｼ郢晢ｽｯ郢晢ｽｼ郢晏ｳｨ・定愾髢・ｾ繝ｻ
async function fetchRelatedKeywordsViaCustomSearch(
  keyword: string,
  googleApiKey: string,
  searchEngineId: string
): Promise<string[]> {
  try {
    const url = `https://www.googleapis.com/customsearch/v1?key=${googleApiKey}&cx=${searchEngineId}&q=${encodeURIComponent(keyword)}&gl=jp&hl=ja&num=5`;
    const res = await fetch(url);
    if (!res.ok) return [];
    const data = await res.json();
    const items = data.items || [];

    const keywords = new Set<string>();
    for (const item of items) {
      // 郢ｧ・ｿ郢ｧ・､郢晏現ﾎ晉ｸｺ・ｨ郢ｧ・ｹ郢昜ｹ昴・郢昴・繝ｨ邵ｺ荵晢ｽ臥ｹｧ・ｭ郢晢ｽｼ郢晢ｽｯ郢晢ｽｼ郢晏ｳｨ・定ｬ夲ｽｽ陷・ｽｺ
      const text = `${item.title || ''} ${item.snippet || ''}`;
      const words = text
        .replace(/[邵ｲ闊個莉｣ﾂ蠕個髦ｪﾂ蠑ｱﾂ謫ｾ・ｼ闌ｨ・ｼ繝ｻ)\[\]邵ｲ繧・繝ｻ・ｼ繝ｻ・ｼ貅ｪﾂ・ｦ]/g, ' ')
        .split(/[\s邵ｲﾂ,]+/)
        .map((w: string) => w.trim())
        .filter((w: string) =>
          w.length >= 2 &&
          w.length <= 15 &&
          w.toLowerCase() !== keyword.toLowerCase()
        );
      words.forEach((w: string) => keywords.add(w));
    }

    return Array.from(keywords).slice(0, 8);
  } catch (err) {
    console.warn('Google Custom Search keyword extraction failed:', err);
    return [];
  }
}

// === 隰ｾ・ｹ闖ｫ・ｮ4: AI郢ｧ・ｿ郢ｧ・､郢晏現ﾎ晞墓ｻ薙・郢晏･ﾎ晉ｹ昜ｻ｣繝ｻ繝ｻ驛√・陷肴・蜃ｽ隰瑚・ﾎ皮ｹ晢ｽｼ郢晉判・ｺ蛹∽ｾ繝ｻ繝ｻ===

async function generateTitleWithAI(
  keyword: string,
  relatedKeywords: string[],
  competitorTitles: string[],
  aiConfig: AIConfig,
  competitorData?: any
): Promise<string> {
  const TITLE_MIN_LENGTH = 16;
  const TITLE_MAX_LENGTH = 80;

  const normalizeTitle = (raw: string): string => {
    let cleaned = String(raw || '').trim()
      .replace(/^Title:\s*/i, '')
      .replace(/^["']|["']$/g, '');

    // Remove leading/trailing brackets ONLY if they wrap the entire string
    if ((cleaned.startsWith('[') && cleaned.endsWith(']')) || (cleaned.startsWith('(') && cleaned.endsWith(')'))) {
      cleaned = cleaned.slice(1, -1);
    }

    // Fix unbalanced brackets at start (common AI artifact: "2026邵ｲ繝ｻ -> "2026")
    cleaned = cleaned.replace(/^[\[\(]+/, '');

    return cleaned.replace(/\s+/g, ' ').trim();
  };

  const includesKeyword = (title: string, baseKeyword: string): boolean => {
    const compactTitle = title.replace(/\s+/g, '');
    const compactKeyword = baseKeyword.replace(/\s+/g, '');
    if (compactKeyword && compactTitle.includes(compactKeyword)) return true;

    const keywordTokens = baseKeyword
      .split(/\s+/)
      .map((t) => t.trim())
      .filter((t) => t.length >= 2);
    return keywordTokens.some((token) => compactTitle.includes(token));
  };

  const isValidSeoTitle = (title: string, baseKeyword: string): boolean => {
    if (!title) return false;
    if (title.length < TITLE_MIN_LENGTH || title.length > TITLE_MAX_LENGTH) return false;
    if (!includesKeyword(title, baseKeyword)) return false;
    if (/^(タイトル|記事タイトル|SEOタイトル)[:：]/.test(title)) return false;
    return true;
  };

  const competitorInputs = Array.isArray(competitorData?.articles) && competitorData.articles.length > 0
    ? competitorData.articles
      .slice(0, 6)
      .map((article: any) => ({
        title: String(article?.title || '').trim(),
        headings: Array.isArray(article?.headings) ? article.headings.slice(0, 6) : [],
      }))
      .filter((item: any) => item.title.length > 0)
    : competitorTitles
      .slice(0, 6)
      .map((title: string) => ({ title: String(title || '').trim() }))
      .filter((item: any) => item.title.length > 0);

  try {
    const suggestions = await generateTitleSuggestionsWithSharedCore({
      keyword,
      relatedKeywords,
      competitors: competitorInputs,
      count: 1,
      callAI: (prompt, maxTokens) => callAI(prompt, aiConfig, Math.max(600, maxTokens)),
    });

    for (const candidate of suggestions) {
      const title = normalizeTitle(candidate.title);
      if (!title) continue;
      if (isValidSeoTitle(title, keyword)) {
        return title;
      }
      console.warn(`AI title rejected by validator: ${title}`);
    }
  } catch (err) {
    console.error('Shared title core failed:', err);
    const detail = formatScheduleFailureReason(err);
    throw new Error(`AI title generation failed: ${detail}`);
  }

  throw new Error('AI title generation did not return a valid title.');
}

// 郢ｧ・ｹ郢ｧ・ｱ郢ｧ・ｸ郢晢ｽ･郢晢ｽｼ郢晢ｽｫ陞ｳ貅ｯ・｡魃会ｽｼ蛹ｻ繝ｻ郢晢ｽｫ郢昶・縺帷ｹ昴・繝｣郢晉､ｼ蜃ｽ隰悟鴻豐ｿ繝ｻ繝ｻ
async function executeSchedule(
  schedule: Schedule,
  wpConfig: WordPressConfig,
  aiConfig: AIConfig,
  supabase: any,
  chatworkApiToken: string | null,
  serpApiKey: string | null,
  googleApiKey: string | null,
  searchEngineId: string | null,
  imageCostUsdPerImage: number,
  schedulerStartTime: number,
  triggerType: 'manual' | 'automatic' = 'automatic'
) {
  // 1. 鬨ｾ蠅難ｽｻ阮吶・驛｢譎｢・ｽ・｢驛｢譎｢・ｽ・ｼ驛｢譎擾ｽｳ・ｨ遶頑･｢謳上・・ｺ驍ｵ・ｺ繝ｻ・･驍ｵ・ｺ郢晢ｽｻ遯ｶ・ｻ驛｢・ｧ繝ｻ・ｿ驛｢譎｢・ｽ・ｼ驛｢・ｧ繝ｻ・ｲ驛｢譏ｴ繝ｻ郢晢ｽｨ郢晢ｽｻ陋ｹ・ｻ邵ｺ蜀暦ｽｹ譎｢・ｽ・ｼ驛｢譎｢・ｽ・ｯ驛｢譎｢・ｽ・ｼ驛｢譎擾ｽｳ・ｨ遶擾ｽｪ驍ｵ・ｺ雋・･繝ｻ驛｢・ｧ繝ｻ・ｿ驛｢・ｧ繝ｻ・､驛｢譎冗樟・取亢繝ｻ陝ｲ・ｨ繝ｻ螳夲ｽｱ雜｣・ｽ・ｺ髯橸ｽｳ郢晢ｽｻ
  let keyword = '';
  let fixedTitle: string | null = null;
  const mode = schedule.generation_mode || 'keyword';
  const hasConfiguredKeyword = String(schedule.keyword || '').split(',').some((k: string) => k.trim());
  const shouldUseTitleSet = Boolean(
    schedule.title_set_id &&
    (mode === 'title' || mode === 'both' || !hasConfiguredKeyword)
  );
  console.log(`Generation Mode: ${mode}`);

  if (shouldUseTitleSet && schedule.title_set_id) {
    // 驛｢・ｧ繝ｻ・ｿ驛｢・ｧ繝ｻ・､驛｢譎冗樟・取刮・ｹ・ｧ繝ｻ・ｻ驛｢譏ｴ繝ｻ郢晢ｽｨ驍ｵ・ｺ闕ｵ譎｢・ｽ閾･・ｹ・ｧ繝ｻ・ｿ驛｢・ｧ繝ｻ・､驛｢譎冗樟・取刮・ｹ・ｧ髮区ｧｫ蠕宣辧霈斐・
    const { data: titleSet } = await supabase
      .from('title_sets')
      .select('titles')
      .eq('id', schedule.title_set_id)
      .maybeSingle();

    if (titleSet && titleSet.titles && titleSet.titles.length > 0) {
      const selectedTitle = await selectUnusedTitle(schedule.id, titleSet.titles, supabase);
      if (selectedTitle) {
        fixedTitle = selectedTitle;
        keyword = selectedTitle; // 驛｢・ｧ繝ｻ・ｿ驛｢・ｧ繝ｻ・､驛｢譎冗樟・取刮・ｹ・ｧ陋幢ｽｵ・朱豪・ｹ・ｧ繝ｻ・､驛｢譎｢・ｽ・ｳ驛｢・ｧ繝ｻ・ｭ驛｢譎｢・ｽ・ｼ驛｢譎｢・ｽ・ｯ驛｢譎｢・ｽ・ｼ驛｢譎擾ｽｳ・ｨ遶雁､・ｸ・ｺ陷会ｽｱ遯ｶ・ｻ髫ｰ繝ｻ・ｽ・ｱ驍ｵ・ｺ郢晢ｽｻ
        console.log(`Title selected: ${fixedTitle}`);
      } else {
        throw new Error('All titles in this title set have already been used.');
      }
    } else {
      throw new Error('Title set is empty or not found.');
    }
  } else if (mode === 'both') {
    // 闕ｳ・｡隴・ｽｹ郢晢ｽ｢郢晢ｽｼ郢昴・ 郢晢ｽｩ郢晢ｽｳ郢敖郢晢｣ｰ邵ｺ・ｧ邵ｺ・ｯ邵ｺ・ｪ邵ｺ荵暦ｽｱ・ｺ陞ｳ螟ょ飭邵ｺ・ｫ郢ｧ・ｿ郢ｧ・､郢晏現ﾎ晁怕・ｪ陷亥現ﾂ竏壺・邵ｺ莉｣・檎ｸｺ・ｰ郢ｧ・ｭ郢晢ｽｼ郢晢ｽｯ郢晢ｽｼ郢晏ｳｨ・定抄・ｿ騾包ｽｨ邵ｲ繝ｻ
    const useTitle = Boolean(schedule.title_set_id);

    if (useTitle && schedule.title_set_id) {
      const { data: titleSet } = await supabase
        .from('title_sets')
        .select('titles')
        .eq('id', schedule.title_set_id)
        .maybeSingle();

      if (titleSet && titleSet.titles && titleSet.titles.length > 0) {
        const selectedTitle = await selectUnusedTitle(schedule.id, titleSet.titles, supabase);
        if (selectedTitle) {
          fixedTitle = selectedTitle;
          keyword = selectedTitle;
          console.log(`Mode "Both" -> Title selected: ${fixedTitle}`);
        }
      }
    }
  }

  // 驛｢・ｧ繝ｻ・ｭ驛｢譎｢・ｽ・ｼ驛｢譎｢・ｽ・ｯ驛｢譎｢・ｽ・ｼ驛｢譎擾ｽｳ・ｨ・守坩・ｹ譎｢・ｽ・ｼ驛｢譎擾ｽｳ・ｨ・つ遶丞｣ｺ遨宣し・ｺ雋・･繝ｻ驛｢・ｧ繝ｻ・ｿ驛｢・ｧ繝ｻ・､驛｢譎冗樟・取辨・ｩ蛹・ｽｽ・ｸ髫ｰ螢ｽ・ｧ・ｭ遶頑･｢譽斐・・ｱ髫ｰ・ｨ郢晢ｽｻ驛｢・ｧ繝ｻ・ｹ驛｢・ｧ繝ｻ・ｭ驛｢譏ｴ繝ｻ郢晢ｽｻ驍ｵ・ｺ陷会ｽｱ隨ｳ繝ｻ謦ｻ繝ｻ・ｴ髯ｷ・ｷ陋ｹ・ｻ郢晢ｽｻ驛｢譎・ｽｼ譁青ｰ驛｢譎｢・ｽ・ｼ驛｢譎｢・ｽ・ｫ驛｢譎√・郢晢ｽ｣驛｢・ｧ繝ｻ・ｯ
  if (!keyword) {
    const allKeywords = (schedule.keyword || '').split(',').map((k: string) => k.trim()).filter((k: string) => k);
    if (allKeywords.length === 0 && fixedTitle) {
      keyword = fixedTitle;
    }
    const selectedKeyword = await selectUnusedKeyword(schedule.id, allKeywords, supabase);

    if (!selectedKeyword && !keyword) {
      throw new KeywordExhaustedError('All keywords in this schedule have already been used.');
    }
    if (selectedKeyword) {
      keyword = selectedKeyword;
    }
    console.log(`Keyword selected: ${keyword}`);
  }

  const progressHistoryId = await createExecutionProgressHistory(supabase, {
    schedule,
    wpConfig,
    keyword,
    title: fixedTitle || '',
    triggerType,
    stage: 'keyword_selected',
    message: 'キーワードまたはタイトルを選択しました',
    progress: 10,
    aiConfig,
  });

  // 1.5 驛｢譎丞ｹｲ・取ｺｽ・ｹ譎｢・ｽ・ｳ驛｢譎丞ｹｲ郢晢ｽｨ驛｢・ｧ繝ｻ・ｻ驛｢譏ｴ繝ｻ郢晢ｽｨ驍ｵ・ｺ繝ｻ・ｮ髯ｷ・ｿ鬮｢ﾂ繝ｻ・ｾ隴会ｽｦ繝ｻ・ｼ陋ｹ・ｻ遶包｣ｰ驛｢・ｧ陟募ｾ後・郢晢ｽｻ郢晢ｽｻ
  let customInstructions = '';
  if (schedule.prompt_set_id) {
    const { data: promptSet } = await supabase
      .from('prompt_sets')
      .select('custom_instructions')
      .eq('id', schedule.prompt_set_id)
      .maybeSingle();

    if (promptSet) {
      customInstructions = promptSet.custom_instructions;
      console.log('Using custom instructions from prompt set');
    }
  }
  await updateExecutionProgressHistory(supabase, progressHistoryId, {
    stage: 'prompt_loaded',
    message: 'プロンプト設定を読み込みました',
    progress: 18,
  });

  let styleReferenceInstructions = '';
  if (wpConfig.style_reference_url) {
    const styleSample = await fetchStyleReferenceSample(wpConfig.style_reference_url);
    if (styleSample) {
      styleReferenceInstructions = buildStyleReferenceInstructions(styleSample, wpConfig.style_reference_url);
      console.log(`Loaded style reference sample from ${wpConfig.style_reference_url}`);
    } else {
      console.warn(`Style reference URL configured but no sample could be extracted: ${wpConfig.style_reference_url}`);
    }
  }
  await updateExecutionProgressHistory(supabase, progressHistoryId, {
    stage: 'style_reference_loaded',
    message: styleReferenceInstructions ? 'スタイル参照を読み込みました' : 'スタイル参照はありません',
    progress: 24,
  });

  // 2. 鬩包ｽｶ繝ｻ・ｶ髯ｷ・ｷ鬩帙・・ｽ・ｪ繝ｻ・ｿ髫ｴ貊ゑｽｽ・ｻ驍ｵ・ｺ繝ｻ・ｮ髯橸ｽｳ雋・ｽｯ繝ｻ・｡鬲・ｼ夲ｽｽ・ｼ郢晢ｽｻuto Mode驍ｵ・ｺ繝ｻ・ｨ髯ｷ・ｷ陟募具ｽｧ驛｢譎｢・ｽ・ｭ驛｢・ｧ繝ｻ・ｸ驛｢譏ｴ繝ｻ邵ｺ莉｣繝ｻ郢晢ｽｻ
  console.log(`Conducting competitor research for: ${keyword}`);
  let competitorData: any = null;
  if (serpApiKey) {
    try {
      competitorData = await conductCompetitorResearchWithFallback(keyword, serpApiKey, 5);
      console.log(`Competitor research completed. Found ${competitorData.articles.length} articles`);
    } catch (researchError) {
      console.warn('Competitor research failed, proceeding without it:', researchError);
    }
  } else {
    console.log('SerpAPI key not found. Skipping competitor research.');
  }
  await updateExecutionProgressHistory(supabase, progressHistoryId, {
    stage: 'competitor_research_done',
    message: competitorData ? `競合調査が完了しました（${competitorData.articles?.length || 0}件）` : '競合調査はスキップしました',
    progress: 35,
  });

  // === 隰ｾ・ｹ闖ｫ・ｮ2: 郢晏現ﾎ樒ｹ晢ｽｳ郢晉甥繝ｻ隴ｫ謦ｰ・ｼ逎ｯ譛ｪ鬨ｾ・｣郢ｧ・ｭ郢晢ｽｼ郢晢ｽｯ郢晢ｽｼ郢晉甥蜿呵墓圜・ｼ繝ｻ===
  console.log(`Enriching keywords for: ${keyword}`);
  const targetWordCount = schedule.target_word_count || DEFAULT_TARGET_WORD_COUNT;
  const writingTone = resolveWritingTone(schedule.writing_tone);
  const keywordArray = (schedule.keyword || '').split(',').map((k: string) => k.trim()).filter((k: string) => k);

  // 鬮｢・｢鬨ｾ・｣郢ｧ・ｭ郢晢ｽｼ郢晢ｽｯ郢晢ｽｼ郢晏ｳｨ・帝・・ｶ陷ｷ蛹ｻ繝ｧ郢晢ｽｼ郢ｧ・ｿ + Google Custom Search 邵ｺ荵晢ｽ芽愾譛ｱ蟇・
  let relatedKeywords: string[] = [];

  if (competitorData) {
    const competitorKeywords = extractRelatedKeywordsFromCompetitorData(competitorData, keyword, 5);
    relatedKeywords.push(...competitorKeywords);
    console.log(`Extracted ${competitorKeywords.length} related keywords from competitor data`);
  }

  if (googleApiKey && searchEngineId) {
    try {
      const searchKeywords = await fetchRelatedKeywordsViaCustomSearch(keyword, googleApiKey, searchEngineId);
      relatedKeywords.push(...searchKeywords);
      console.log(`Fetched ${searchKeywords.length} related keywords from Google Custom Search`);
    } catch (err) {
      console.warn('Google Custom Search failed:', err);
    }
  }
  await updateExecutionProgressHistory(supabase, progressHistoryId, {
    stage: 'keywords_enriched',
    message: `関連キーワードを整理しました（${relatedKeywords.length}件）`,
    progress: 45,
  });

  // Keep keywords compact to avoid over-constraining each section.
  // Use normalized dedupe so near-duplicates do not force unnatural repetition.
  const sectionKeywordCandidates = [keyword, ...keywordArray, ...relatedKeywords]
    .map((k) => String(k || '').trim())
    .filter(Boolean);
  const sectionKeywords: string[] = [];
  const seenSectionKeywordNormalized = new Set<string>();
  for (const candidate of sectionKeywordCandidates) {
    const normalized = candidate.replace(/\s+/g, '').toLowerCase();
    if (!normalized || seenSectionKeywordNormalized.has(normalized)) continue;
    seenSectionKeywordNormalized.add(normalized);
    sectionKeywords.push(candidate);
    if (sectionKeywords.length >= 3) break;
  }
  console.log(`Final section keywords: ${sectionKeywords.join(', ')}`);
  const competitorHeadings = extractCompetitorHeadings(competitorData, 15);
  if (competitorHeadings.length > 0) {
    console.log(`Extracted ${competitorHeadings.length} competitor headings for outline context`);
  }

  // === 隰ｾ・ｹ闖ｫ・ｮ4: AI郢ｧ・ｿ郢ｧ・､郢晏現ﾎ晞墓ｻ薙・ ===
  if (!fixedTitle) {
    await updateExecutionProgressHistory(supabase, progressHistoryId, {
      stage: 'title_generating',
      message: 'AIタイトルを生成しています',
      progress: 50,
    });
    const competitorTitles = (competitorData?.articles || []).map((a: any) => a.title).filter(Boolean);
    const generatedTitle = await generateTitleWithAI(keyword, relatedKeywords, competitorTitles, aiConfig, competitorData);
    fixedTitle = generatedTitle;
    console.log(`AI-generated title: ${fixedTitle}`);
  }
  await updateExecutionProgressHistory(supabase, progressHistoryId, {
    stage: 'title_done',
    message: 'タイトルが決まりました',
    progress: 58,
    title: fixedTitle || '',
  });

  console.log(`Generating outline for: ${keyword}`);
  const runGeneration = async () => {
    console.log('Generating outline with AI generator style...');
    const customInstructionText = customInstructions.trim();
    const baseCustomInstructions = compactAutoModeInstructions([
      customInstructionText,
      styleReferenceInstructions,
      relatedKeywords.length > 0 ? `Related keywords: ${relatedKeywords.slice(0, 8).join(', ')}` : undefined,
    ]);
    const effectiveCustomInstructions = compactAutoModeInstructions([
      baseCustomInstructions,
      buildAutoModeQualityInstructions({
        selectedTitle: fixedTitle || undefined,
        targetWordCount,
      }),
    ]);

    await updateExecutionProgressHistory(supabase, progressHistoryId, {
      stage: 'outline_generating',
      message: 'アウトラインを生成しています',
      progress: 65,
      title: fixedTitle || '',
    });

    let outline = await generateOutlineWithAutoModeStyle({
      keyword,
      targetWordCount,
      fixedTitle,
      customInstructions: effectiveCustomInstructions,
      competitorHeadings,
      relatedKeywords,
      tone: writingTone,
      callAI: (prompt, maxTokens) => callAI(prompt, aiConfig, maxTokens)
    });

    const outlineQuality = evaluateAutoOutlineQuality(outline as any, {
      targetWordCount,
      selectedTitle: fixedTitle || undefined,
    });

    if (!outlineQuality.passed) {
      console.warn('Scheduler auto outline quality gate failed. Regenerating outline:', outlineQuality.issues);
      await updateExecutionProgressHistory(supabase, progressHistoryId, {
        stage: 'outline_regenerating',
        message: `アウトラインを再生成しています（${outlineQuality.issues.join(' / ')}）`,
        progress: 70,
        title: fixedTitle || '',
      });
      outline = await generateOutlineWithAutoModeStyle({
        keyword,
        targetWordCount,
        fixedTitle,
        customInstructions: compactAutoModeInstructions([
          effectiveCustomInstructions,
          buildAutoOutlineRetryInstructions(outlineQuality.issues),
        ]),
        competitorHeadings,
        relatedKeywords,
        tone: writingTone,
        callAI: (prompt, maxTokens) => callAI(prompt, aiConfig, maxTokens)
      });
    }

    await updateExecutionProgressHistory(supabase, progressHistoryId, {
      stage: 'outline_done',
      message: `アウトラインができました（H2:${outline.sections.filter((section) => !section.isLead && section.level !== 3).length} / H3:${outline.sections.filter((section) => section.level === 3).length}）`,
      progress: 75,
      title: fixedTitle || '',
      debug: buildGenerationDebug({
        outline,
        title: fixedTitle || '',
        keyword,
        targetWordCount,
        relatedKeywords,
        competitorHeadings,
      }),
    });

    await updateExecutionProgressHistory(supabase, progressHistoryId, {
      stage: 'article_generating',
      message: '本文を生成しています',
      progress: 82,
      title: fixedTitle || '',
    });
    const generationResult = await generateSchedulerArticleSinglePass({
      outline,
      keyword,
      keywords: sectionKeywords,
      tone: writingTone,
      targetWordCount,
      customInstructions: effectiveCustomInstructions,
      aiConfig,
    });

    await updateExecutionProgressHistory(supabase, progressHistoryId, {
      stage: 'article_done',
      message: `本文生成が完了しました（${generationResult.wordCount}文字）`,
      progress: 88,
      title: fixedTitle || '',
      debug: buildGenerationDebug({
        outline,
        title: fixedTitle || '',
        keyword,
        targetWordCount,
        generatedChars: generationResult.wordCount,
        relatedKeywords,
        competitorHeadings,
      }),
    });

    return { outline, generationResult };
  };

  const scheduleImageGenerationEnabled = schedule.image_generation_enabled === true;
  const scheduleImagesPerArticle = Math.max(
    0,
    Math.min(10, Number.isFinite(Number(schedule.images_per_article)) ? Number(schedule.images_per_article) : Number(aiConfig.images_per_article ?? 0))
  );
  const schedulerRun = await runGeneration();
  const outline = schedulerRun.outline;
  const generationResult = schedulerRun.generationResult;
  await updateExecutionProgressHistory(supabase, progressHistoryId, {
    stage: 'post_processing',
    message: '投稿前の整形と検証を実行しています',
    progress: 92,
    title: fixedTitle || '',
  });

  // === 郢晏干ﾎ溽ｹｧ・ｰ郢晢ｽｩ郢晢｣ｰ騾ｧ繝ｻ縺醍ｹ晢ｽｪ郢晢ｽｼ郢晢ｽｳ郢ｧ・｢郢昴・繝ｻ繝ｻ閧ｲ・｢・ｺ陞ｳ貅倪・陞ｳ貅ｯ・｡魃会ｽｼ繝ｻ===
  function cleanupContentArtifacts(content: string, articleTitle: string): string {
    let text = String(content || '');

    // 1. 髫募唱繝ｻ邵ｺ蜉ｱﾂｰ郢ｧ蟲ｨ縺慕ｹ晢ｽｭ郢晢ｽｳ郢ｧ蟶晏求陷ｴ・ｻ繝ｻ莠･豼髫怜・繝ｻ陷茨ｽｨ髫怜宴・ｸ・｡隴・ｽｹ繝ｻ繝ｻ
    // 隴幢ｽｫ陝・ｽｾ邵ｺ・ｰ邵ｺ莉｣縲堤ｸｺ・ｪ邵ｺ荳環竏ｵ譫夊叉・ｭ邵ｺ・ｫ邵ｺ繧・ｽ玖撻・ｴ陷ｷ蛹ｻ・らｹｧ・ｹ郢晏｣ｹ繝ｻ郢ｧ・ｹ邵ｺ・ｫ驗ゑｽｮ隰蟷｢・ｼ莠包ｽｾ繝ｻ "AGA繝ｻ螟る浹陟包ｽｴ" -> "AGA 霑夲ｽｹ陟包ｽｴ"繝ｻ繝ｻ
    text = text.replace(/^(#{1,6}\s+.+?)[繝ｻ繝ｻ](.+)$/gm, '$1 $2').replace(/^(#{1,6}\s+.+?)[繝ｻ繝ｻ]\s*$/gm, '$1');

    // 1.5 髫募唱繝ｻ邵ｺ蜉ｱ繝ｻ騾｡・ｪ陷ｿ・ｷ郢ｧ蟶晏求陷ｴ・ｻ繝ｻ莠包ｽｾ繝ｻ "## 1. 陝・ｸｻ繝ｻ" -> "## 陝・ｸｻ繝ｻ"繝ｻ繝ｻ
    text = text.replace(/^(#{1,6}\s+)\d+[\.\)\-、:：]\s*(.+)$/gm, '$1$2');

    // 1.6 陞｢鄙ｫ・檎ｸｺ貅ｯ・ｦ蜿･繝ｻ邵ｺ證ｦ・ｼ蛹ｻﾂ蠕個髦ｪ竊醍ｸｺ・ｩ邵ｺ・ｮ隲｡・ｬ陟托ｽｧ髫ｪ莨懈差邵ｺ・ｧ陝倶ｹ昶穐郢ｧ蜈ｷ・ｼ蟲ｨ・定将・ｮ雎・ｽ｣
    // 關薙・ ## 邵ｲ髦ｪﾂ蠕湖鍋ｹ晢ｽｪ郢昴・繝ｨ -> ## 郢晢ｽ｡郢晢ｽｪ郢昴・繝ｨ
    text = text.replace(/^(#{1,6}\s+)[\u300c\u300d\u300e\u300f\u3010\u3011\uff08\uff09\[\]\u3001\u3002\uff01\uff1f]+\s*/gm, '$1');
    // 隴幢ｽｫ陝・ｽｾ邵ｺ・ｮ鬮｢蟲ｨﾂｧ邵ｺ荵昶夢邵ｺ阮呻ｽるｫｯ・､陷ｴ・ｻ繝ｻ莠包ｽｾ繝ｻ ## 郢晢ｽ｡郢晢ｽｪ郢昴・繝ｨ邵ｲ繝ｻ-> ## 郢晢ｽ｡郢晢ｽｪ郢昴・繝ｨ繝ｻ繝ｻ
    text = text.replace(/^(#{1,6}\s+)(.+?)[\u300d\u300f\u3011\uff09]+\s*$/gm, '$1$2');
    // 髫ｪ莨懈差鬮ｯ・､陷ｴ・ｻ陟募ｾ娯・驕ｨ・ｺ邵ｺ・ｫ邵ｺ・ｪ邵ｺ・｣邵ｺ貅ｯ・ｦ蜿･繝ｻ邵ｺ蜉ｱ繝ｻ陷台ｼ∝求
    text = text.replace(/^#{1,6}\s*$/gm, '');

    // 2. 隴幢ｽｬ隴√・繝ｻ鬯・ｽｭ邵ｺ・ｫ郢ｧ・ｿ郢ｧ・､郢晏現ﾎ晉ｸｺ謔滓ｧ邵ｺ・ｾ郢ｧ蠕娯ｻ邵ｺ繝ｻ笳・ｹｧ陋ｾ蜍∬惷・ｻ (陟托ｽｷ陋ｹ荵滓ｲｿ)
    const lines = text.split('\n');
    const firstNonEmpty = lines.findIndex(l => l.trim().length > 0);
    if (firstNonEmpty !== -1) {
      const firstLine = lines[firstNonEmpty].trim();
      const normalize = (s: string) => s.replace(/[^\w\u3040-\u30ff\u3400-\u9fff\u4e00-\u9faf]/g, '').toLowerCase(); // 髫ｪ莨懈差鬮ｯ・､陷ｴ・ｻ

      const normalizedFirst = normalize(firstLine);
      const normalizedTitle = normalize(articleTitle);

      // 郢ｧ・ｿ郢ｧ・､郢晏現ﾎ晉ｸｺ譏ｴ繝ｻ郢ｧ繧・・邵ｲ竏壺穐邵ｺ貅倥・郢ｧ・ｿ郢ｧ・､郢晏現ﾎ昴・邇厄ｽｦ竏ｫ・ｴ繝ｻ竊醍ｸｺ・ｩ邵ｺ・ｮ郢昜ｻ｣縺｡郢晢ｽｼ郢晢ｽｳ郢ｧ蟶晏求陷ｴ・ｻ
      // "20闔会ｽ｣邵ｺ・ｮAGA" vs "20闔会ｽ｣AGA" -> normalization removes symbols but not particles.
      // 驍・ｽ｡隴城豪蝎ｪ邵ｺ・ｪ陋ｹ繝ｻ諤ｧ郢昶・縺臥ｹ昴・縺・
      // Only remove the first line if it closely matches the article title itself.
      // Do NOT remove lead-text sentences that merely contain the keyword.
      if (normalizedFirst.length > 0 && normalizedTitle.length > 0) {
        const isTitleLine =
          normalizedFirst === normalizedTitle ||
          (normalizedTitle.startsWith(normalizedFirst) && normalizedFirst.length >= normalizedTitle.length * 0.8) ||
          (normalizedFirst.startsWith(normalizedTitle) && firstLine.length <= articleTitle.length * 1.3);
        if (isTitleLine) {
          lines.splice(firstNonEmpty, 1);
          text = lines.join('\n');
        }
      }
    }

    // 3. 驕ｨ・ｺ邵ｺ・ｮ髫募唱繝ｻ邵ｺ諤懃ｎ鬮ｯ・､繝ｻ驛・ｽｦ蜿･繝ｻ邵ｺ蜉ｱ繝ｻ騾ｶ・ｴ陟募ｾ娯・陋ｻ・･邵ｺ・ｮ髫募唱繝ｻ邵ｺ蜉ｱ窶ｲ隴夲ｽ･郢ｧ荵昴Τ郢ｧ・ｿ郢晢ｽｼ郢晢ｽｳ繝ｻ繝ｻ
    text = text.replace(/^(#{1,6})(\s+.+)\n+(?=(#{1,6})\s+)/gm, (match, level1, rest, level2) => {
      // H2 immediately followed by H3 is valid nesting — do NOT remove the H2.
      // Only remove a heading when followed by same/shallower level with no body text.
      if (level2.length > level1.length) {
        return match;
      }
      console.log('Removed empty heading:', `${level1}${rest}`.trim());
      return '';
    });

    // 4. 邵ｲ蠕娯穐邵ｺ・ｨ郢ｧ繝ｻ・ｼ螢ｹﾂ髦ｪﾂ讙趣ｽｵ蜊・ｫ蜴・ｽｼ螢ｹﾂ髦ｪ繝ｻ郢晢ｽｬ郢晁ｼ斐≦郢昴・縺醍ｹｧ・ｹ邵ｺ・ｮ鬮ｯ・､陷ｴ・ｻ
    text = text.replace(/^(邵ｺ・ｾ邵ｺ・ｨ郢ｧ・埼お蜊・ｫ鄙ｻ驍ｱ荵怜ｳ｡)[繝ｻ繝ｻ]\s*/gm, '');

    // 5. **繝ｻ莠･・､・ｪ陝・干繝ｻ郢晢ｽｼ郢ｧ・ｯ繝ｻ蟲ｨ繝ｻ鬮ｯ・､陷ｴ・ｻ 遯ｶ繝ｻ陟托ｽｷ髫ｱ・ｿ髫ｪ莨懈差邵ｺ・ｪ邵ｺ邇ｲ謔ｽ隴√・・帝け・ｭ隰悶・
    text = text.replace(/\*\*(.+?)\*\*/g, '$1');
    // 陝・ｽ､驕ｶ荵晢ｼ邵ｺ繝ｻ** 郢ｧ繧句求陷ｴ・ｻ
    text = text.replace(/\*\*/g, '');

    // 6. 連続3行以上の空行を2行に正規化
    text = text.replace(/\n{3,}/g, '\n\n');

    // 7. 段落間の空行を保証: 文章行の直後に見出し・別の文章行が続く場合は空行を挿入
    text = text.replace(/([^\n])(\n)(#{1,6}\s)/g, '$1\n\n$3');
    text = text.replace(/(#{1,6}\s[^\n]+)(\n)([^#\n-*])/g, '$1\n\n$3');

    return text.trim();
  }

  // AI邵ｺ・ｫ郢ｧ蛹ｻ・矩坎蛟・ｽｺ蛹ｺ閠ｳ隰ｨ・ｲ繝ｻ蝓滂ｽｧ遏ｩﾂ・ｰ郢ｧ蝣､・ｶ・ｭ隰問・・邵ｺ・､邵ｺ・､髫ｱ・ｭ邵ｺ・ｿ郢ｧ繝ｻ笘・ｸｺ蜍滄ｫ・叉螂・ｽｼ繝ｻ
  async function refineContentWithAI(
    content: string,
    _title: string,
    _keyword: string,
    _aiConfig: AIConfig
  ): Promise<string> {
    return content;
  }

  async function regenerateHeadingsWithAI(
    content: string,
    _title: string,
    _keyword: string,
    _aiConfig: AIConfig
  ): Promise<string> {
    return content;
  }

  let fullContent = generationResult.fullContent;
  const baseGeneratedContent = generationResult.fullContent;
  const articleTitle = outline.title;

  console.log('Word count check:', {
    target: targetWordCount,
    current: countGeneratedChars(fullContent),
    initial: generationResult.wordCount,
  });

  // === Step 1: 郢晏干ﾎ溽ｹｧ・ｰ郢晢ｽｩ郢晢｣ｰ騾ｧ繝ｻ縺醍ｹ晢ｽｪ郢晢ｽｼ郢晢ｽｳ郢ｧ・｢郢昴・繝ｻ繝ｻ閧ｲ・｢・ｺ陞ｳ貅倥・鬯ｮ蛟ｬﾂ貊ゑｽｼ繝ｻ===
  fullContent = cleanupContentArtifacts(fullContent, articleTitle);
  console.log('Deterministic cleanup applied');

  // H3 subheading insertion: matches manual generation quality
  fullContent = insertSubheadingsIntoLongSections(fullContent, targetWordCount);
  console.log('H3 subheadings inserted');

  // === Step 2: AI邵ｺ・ｫ郢ｧ蛹ｻ・玖ｬ暦ｽｨ隰ｨ・ｲ繝ｻ驛・ｽｪ・ｭ邵ｺ・ｿ郢ｧ繝ｻ笘・ｸｺ蜍滄ｫ・叉鄙ｫ繝ｻ邵ｺ・ｿ繝ｻ繝ｻ===
  // 郢ｧ・ｿ郢ｧ・､郢晢｣ｰ郢ｧ・｢郢ｧ・ｦ郢昜ｺ･・ｯ・ｾ驕ｲ繝ｻ 陷・ｽｦ騾・・蟷戊沂荵敖ｰ郢ｧ繝ｻ20驕伜宴・ｻ・･闕ｳ鬘費ｽｵ遒≫с邵ｺ蜉ｱ窶ｻ邵ｺ繝ｻ笳・ｹｧ蟲ｨ縺帷ｹｧ・ｭ郢昴・繝ｻ
  const elapsedMs = Date.now() - schedulerStartTime;
  const REFINEMENT_TIME_LIMIT_MS = 120_000; // 2陋ｻ繝ｻ
  if (elapsedMs < REFINEMENT_TIME_LIMIT_MS) {
    try {
      const refinedContent = await refineContentWithAI(fullContent, articleTitle, keyword, aiConfig);
      if (refinedContent && refinedContent.length > 500) {
        fullContent = refinedContent;
        console.log('Content refined successfully');
      }
    } catch (refineError) {
      console.warn('Refinement step skipped due to error:', refineError);
    }
  } else {
    console.log('Skipping AI refinement to avoid timeout', { elapsedSeconds: Math.round(elapsedMs / 1000) });
  }

  // === Step 3: 髫募唱繝ｻ邵ｺ蜉ｱ繝ｻ邵ｺ・ｿAI陷蜥ｲ蜃ｽ隰梧腸・ｼ驛√・霎滂ｽｶ邵ｺ蠅馴埔陜溘・・ｼ繝ｻ===
  const elapsedForHeadingMs = Date.now() - schedulerStartTime;
  const HEADING_REGEN_TIME_LIMIT_MS = 150_000; // 2.5陋ｻ繝ｻ
  if (elapsedForHeadingMs < HEADING_REGEN_TIME_LIMIT_MS) {
    try {
      const headingCountBeforeRegeneration = countNonSummaryHeadings(fullContent);
      const regeneratedHeadingContent = await regenerateHeadingsWithAI(fullContent, articleTitle, keyword, aiConfig);
      if (regeneratedHeadingContent && regeneratedHeadingContent.length > 500) {
        const headingCountAfterRegeneration = countNonSummaryHeadings(regeneratedHeadingContent);
        if (
          headingCountBeforeRegeneration >= 2 &&
          headingCountAfterRegeneration < Math.max(2, headingCountBeforeRegeneration - 1)
        ) {
          console.warn('Skipping regenerated headings because heading count dropped too much', {
            before: headingCountBeforeRegeneration,
            after: headingCountAfterRegeneration,
          });
        } else {
          fullContent = regeneratedHeadingContent;
        }
      }
    } catch (headingError) {
      console.warn('Heading regeneration step skipped due to error:', headingError);
    }
  } else {
    console.log('Skipping heading regeneration to avoid timeout', { elapsedSeconds: Math.round(elapsedForHeadingMs / 1000) });
  }

  // === Step 4: Clean up generated content before publishing ===
  fullContent = cleanupContentArtifacts(fullContent, articleTitle);

  // 4.6 Run fact-check as a pre-publish safety step.
  let finalPostStatus = schedule.post_status || 'draft';
  let factCheckReport = null;
  let factCheckItemsChecked = 0;
  const factCheckAlerts: string[] = [];
  let factCheckExecuted = false;
  let factCheckCriticalIssues = 0;
  let factCheckMinorIssues = 0;
  let factCheckChangeSummaries: string[] = [];
  let factCheckAutoFixApplied = false;

  const shouldRunFactCheck = true;
  if (shouldRunFactCheck) {
    console.log(`Starting fact-check for article: ${articleTitle}`);

    try {
      // Prefer account-scoped user settings, then fall back to account app_settings.
      const scheduleUserId = (schedule as any).user_id;
      const scheduleAccountId = (schedule as any).account_id;
      let factCheckSettings: any = null;

      if (!scheduleUserId) {
        console.warn(`Schedule ${schedule.id} has no user_id. Falling back to app_settings for fact-check.`);
      } else {
        let userFactCheckQuery = supabase
          .from('fact_check_settings')
          .select('*')
          .eq('user_id', scheduleUserId)
          .order('updated_at', { ascending: false })
          .limit(1);

        if (scheduleAccountId) {
          userFactCheckQuery = userFactCheckQuery.eq('account_id', scheduleAccountId);
        }

        const { data: userFactCheckSettings } = await userFactCheckQuery.maybeSingle();
        factCheckSettings = userFactCheckSettings;
      }

      if (!factCheckSettings) {
        let appSettingsQuery = supabase
          .from('app_settings')
          .select('key, value')
          .in('key', [
            'perplexity_api_key',
            'fact_check_enabled',
            'fact_check_model_name',
            'fact_check_auto_fix_enabled',
          ]);

        if (scheduleAccountId) {
          appSettingsQuery = appSettingsQuery.eq('account_id', scheduleAccountId);
        }

        const { data: globalRows } = await appSettingsQuery;

        if (globalRows && globalRows.length > 0) {
          const map = new Map<string, string>();
          globalRows.forEach((row: any) => {
            map.set(String(row.key), String(row.value ?? ''));
          });

          const apiKey = map.get('perplexity_api_key');
          if (apiKey) {
            factCheckSettings = {
              enabled: true,
              perplexity_api_key: apiKey,
              model_name: map.get('fact_check_model_name') || 'sonar',
              max_items_to_check: DEFAULT_FACT_CHECK_MAX_ITEMS,
              auto_fix_enabled: parseBoolean(map.get('fact_check_auto_fix_enabled'), false),
            } as any;
          }
        }
      }

      if (factCheckSettings?.enabled && factCheckSettings?.perplexity_api_key) {
        factCheckExecuted = true;
        // Extract likely factual claims from the generated article.
        const factsToCheck = await extractFactsFromContent(fullContent, (schedule as any).fact_check_note);
        const maxItems = DEFAULT_FACT_CHECK_MAX_ITEMS;
        const itemsToCheck = selectFactCheckItems(factsToCheck, maxItems);
        factCheckItemsChecked = itemsToCheck.length;

        console.log(`Found ${factsToCheck.length} facts, checking top ${itemsToCheck.length} in batches`);

        // Verify claims in batches.
        let factCheckResults = await verifyFactsBatch(
          itemsToCheck,
          factCheckSettings.perplexity_api_key,
          keyword,
          factCheckSettings.model_name || 'sonar',
          5
        );

        // Count critical and minor issues before optional auto-fix.
        const criticalIssues = factCheckResults.filter(r =>
          r.verdict === 'incorrect' && r.confidence >= 70
        ).length;
        const minorIssues = factCheckResults.filter(r =>
          r.verdict === 'partially_correct' ||
          (r.verdict === 'incorrect' && r.confidence < 70)
        ).length;
        factCheckCriticalIssues = criticalIssues;
        factCheckMinorIssues = minorIssues;
        const scheduleAutoFixValue = (schedule as any).fact_check_auto_fix_enabled;
        const autoFixEnabled = typeof scheduleAutoFixValue === 'boolean'
          ? scheduleAutoFixValue
          : Boolean(factCheckSettings.auto_fix_enabled);

        console.log(`Fact-check completed: ${criticalIssues} critical, ${minorIssues} minor issues`);

        if (autoFixEnabled && (criticalIssues > 0 || minorIssues > 0)) {
          console.log('Auto-fix mode enabled. Applying AI corrections...');
          const headingCountBeforeAutoFix = countNonSummaryHeadings(fullContent);
          const contentBeforeAutoFix = fullContent;
          const fixedContent = await applyFactCheckCorrections(
            fullContent,
            factCheckResults,
            factCheckSettings.perplexity_api_key,
            keyword,
            factCheckSettings.model_name || 'sonar'
          );

          if (fixedContent && fixedContent.trim().length > 0) {
            const normalizedFixedContent = normalizeGeneratedContentForPublishing(fixedContent, articleTitle);
            const headingCountAfterAutoFix = countNonSummaryHeadings(normalizedFixedContent);
            if (
              headingCountBeforeAutoFix >= 2 &&
              headingCountAfterAutoFix < Math.max(2, headingCountBeforeAutoFix - 1)
            ) {
              console.warn(
                `Auto-fix removed too many headings (before=${headingCountBeforeAutoFix}, after=${headingCountAfterAutoFix}). Keeping pre-fix content.`
              );
            } else {
              fullContent = normalizedFixedContent;
              factCheckChangeSummaries = summarizeFactCheckContentChanges(contentBeforeAutoFix, normalizedFixedContent, 5);
              if (factCheckChangeSummaries.length > 0) {
                factCheckAutoFixApplied = true;
                factCheckAlerts.push(`ファクトチェックの自動修正を適用しました（${factCheckChangeSummaries.length}件）`);
              }
            }
            const recheckFacts = await extractFactsFromContent(fullContent, (schedule as any).fact_check_note);
            const recheckItems = selectFactCheckItems(recheckFacts, maxItems);
            factCheckResults = await verifyFactsBatch(
              recheckItems,
              factCheckSettings.perplexity_api_key,
              keyword,
              factCheckSettings.model_name || 'sonar',
              5
            );

            const reCritical = factCheckResults.filter(r =>
              r.verdict === 'incorrect' && r.confidence >= 70
            ).length;
            const reMinor = factCheckResults.filter(r =>
              r.verdict === 'partially_correct' ||
              (r.verdict === 'incorrect' && r.confidence < 70)
            ).length;
            factCheckCriticalIssues = reCritical;
            factCheckMinorIssues = reMinor;
            console.log(`Re-check after auto-fix: ${reCritical} critical, ${reMinor} minor issues`);
          } else {
            console.warn('Auto-fix returned empty content. Keeping original content.');
          }
        }

        // Recalculate issue counts after optional auto-fix.
        const criticalIssuesAfterFix = factCheckResults.filter(r =>
          r.verdict === 'incorrect' && r.confidence >= 70
        ).length;
        const minorIssuesAfterFix = factCheckResults.filter(r =>
          r.verdict === 'partially_correct' ||
          (r.verdict === 'incorrect' && r.confidence < 70)
        ).length;
        factCheckCriticalIssues = criticalIssuesAfterFix;
        factCheckMinorIssues = minorIssuesAfterFix;

        if (criticalIssuesAfterFix > 0) {
          console.log(`Critical errors found (${criticalIssuesAfterFix}). Forcing draft status.`);
          finalPostStatus = 'draft';
          factCheckAlerts.push(`重大なファクトチェック指摘が残っています（${criticalIssuesAfterFix}件）。下書きに変更しました。`);
        }

        // Save the fact-check report for execution history and alerts.
        const { data: savedReport } = await supabase.from('fact_check_results').insert({
          account_id: scheduleAccountId,
          schedule_id: schedule.id,
          checked_items: factCheckResults,
          total_checked: itemsToCheck.length,
          issues_found: criticalIssuesAfterFix + minorIssuesAfterFix,
          critical_issues: criticalIssuesAfterFix
        }).select().single();

        factCheckReport = savedReport;
      } else {
        console.log('Fact-check settings not configured or API key missing');
        factCheckAlerts.push('ファクトチェック設定またはPerplexity APIキーが未設定です。');
      }
    } catch (factCheckError) {
      console.error('Fact-check failed:', factCheckError);
      const errorText = factCheckError instanceof Error ? factCheckError.message : String(factCheckError || '');
      factCheckAlerts.push(`ファクトチェックに失敗しました: ${errorText}`);
      // Keep the generated article and notify through the configured alert flow.
    }
  }

  // 4.7 Remove manual fact-check markers before publishing.
  fullContent = fullContent.replace(/\[\[(.+?)\]\]/g, '$1');
  const contentBeforeNormalization = fullContent;
  fullContent = formatArticleBodyForReadability(normalizeGeneratedContentForPublishing(fullContent, articleTitle));
  if (contentBeforeNormalization !== fullContent) {
    console.log('Normalized generated content structure before publishing');
  }

  // Final cleanup: remove empty lines between list items after fact-check edits.
  const baselineNormalizedContent = normalizeGeneratedContentForPublishing(baseGeneratedContent, articleTitle);
  const baselineHeadingCount = countNonSummaryHeadings(baselineNormalizedContent);
  const finalHeadingCount = countNonSummaryHeadings(fullContent);
  if (
    baselineHeadingCount >= 2 &&
    finalHeadingCount < Math.max(2, baselineHeadingCount - 1)
  ) {
    console.warn(
      `Final content lost too many headings (baseline=${baselineHeadingCount}, final=${finalHeadingCount}). Restoring baseline heading structure.`
    );
    fullContent = baselineNormalizedContent;
  }

  const finalCharsBeforeCompaction = countGeneratedChars(fullContent);
  fullContent = formatArticleBodyForReadability(compactArticleToTargetLength(fullContent, targetWordCount));
  const finalCharsAfterCompaction = countGeneratedChars(fullContent);
  if (finalCharsAfterCompaction < finalCharsBeforeCompaction) {
    console.log(`Compacted article length: ${finalCharsBeforeCompaction} -> ${finalCharsAfterCompaction}`);
  }

  validateGeneratedArticleCompleteness(fullContent, outline, targetWordCount);

  // 5. Create the WordPress post after cleanup and fact-check.
  let postId: string | null = null;
  let publishErrorMessage: string | null = null;
  let publishedAtIso: string | null = null;

  console.log(`Publishing to WordPress: ${articleTitle} (Status: ${finalPostStatus})`);
  await updateExecutionProgressHistory(supabase, progressHistoryId, {
    stage: 'wordpress_publishing',
    message: finalPostStatus === 'publish' ? 'WordPressへ公開投稿しています' : 'WordPressへ下書き保存しています',
    progress: 96,
    title: articleTitle,
  });
  try {
    postId = await publishToWordPress(
      wpConfig,
      articleTitle,
      fullContent,
      finalPostStatus
    );
    publishedAtIso = new Date().toISOString();
    console.log(`Published: Post ID ${postId}`);
  } catch (publishError: any) {
    publishErrorMessage = publishError?.message || String(publishError);
    console.error('WordPress publish failed:', publishError);
  }

  const articleSnapshotStatus: 'draft' | 'published' | 'failed' = postId
    ? (finalPostStatus === 'publish' ? 'published' : 'draft')
    : 'failed';

  await saveGeneratedArticleSnapshot(supabase, {
    title: articleTitle,
    content: fullContent,
    keywords: sectionKeywords,
    status: articleSnapshotStatus,
    tone: writingTone,
    aiConfig,
    wpConfig,
    postId,
    publishedAt: publishedAtIso,
  });

  // 5.5 Send the standard ChatWork publication notification.
  if (postId && schedule.chatwork_room_id && chatworkApiToken) {
    console.log(`Sending Chatwork notification to rooms: ${schedule.chatwork_room_id}`);
    try {
      const postUrl = `${wpConfig.url}/?p=${postId}`; // Public URL
      await sendChatworkNotifications(
        chatworkApiToken,
        schedule.chatwork_room_id,
        schedule.chatwork_message_template || '',
        articleTitle,
        postUrl,
        keyword,
        schedule.post_status === 'publish' ? '公開' : '下書き'
      );
    } catch (cwError) {
      console.error('Chatwork notification failed:', cwError);
      // Build title and message.
    }
  }

  const rawNotifyEveryRun = (schedule as any).fact_check_notify_on_every_run === true;
  const rawNotifyOnAnomaly = (schedule as any).fact_check_notify_on_anomaly ?? true;
  const factCheckNotifyOnEveryRun = rawNotifyEveryRun;
  const factCheckNotifyOnAnomaly = rawNotifyEveryRun ? false : rawNotifyOnAnomaly;
  const factCheckAlertRoomIds = String((schedule as any).fact_check_alert_chatwork_room_id || schedule.chatwork_room_id || '').trim();
  if (
    shouldRunFactCheck &&
    factCheckAlertRoomIds &&
    chatworkApiToken
  ) {
    const alertUrl = postId ? `${wpConfig.url}/?p=${postId}` : '(投稿URLなし)';
    const postStatusLabel = finalPostStatus === 'publish' ? '公開' : '下書き';
    const factCheckChangeBlock = factCheckAutoFixApplied
      ? `\n自動修正内容:\n${factCheckChangeSummaries.join('\n\n')}`
      : '\n自動修正内容: なし';

    if (factCheckNotifyOnEveryRun) {
      try {
        const summaryTemplate = `ファクトチェック結果通知
スケジュールID: ${schedule.id}
タイトル: {title}
キーワード: {keyword}
投稿URL: {url}
投稿状態: {status}

実行状態: ${factCheckExecuted ? '実行済み' : '未実行'}
チェック件数: ${factCheckItemsChecked}件
重大な指摘: ${factCheckCriticalIssues}件
軽微な指摘: ${factCheckMinorIssues}件${factCheckChangeBlock}`;

        await sendChatworkNotifications(
          chatworkApiToken,
          factCheckAlertRoomIds,
          summaryTemplate,
          articleTitle,
          alertUrl,
          keyword,
          postStatusLabel
        );
      } catch (summaryError) {
        console.error('Fact-check summary notification failed:', summaryError);
      }
    }

    if (factCheckNotifyOnAnomaly && factCheckAlerts.length > 0) {
      console.log(`Sending fact-check alert to rooms: ${factCheckAlertRoomIds}`);
      try {
        const alertTemplate = `ファクトチェック警告通知
スケジュールID: ${schedule.id}
タイトル: {title}
キーワード: {keyword}
投稿URL: {url}
投稿状態: {status}

警告内容:
${factCheckAlerts.map((item, index) => `${index + 1}. ${item}`).join('\n')}${factCheckChangeBlock}`;

        await sendChatworkNotifications(
          chatworkApiToken,
          factCheckAlertRoomIds,
          alertTemplate,
          articleTitle,
          alertUrl,
          keyword,
          postStatusLabel
        );
      } catch (alertError) {
        console.error('Fact-check alert notification failed:', alertError);
        // 鬨ｾ螟り｡崎棔・ｱ隰ｨ蜉ｱ繝ｻ陷茨ｽｨ闖ｴ轣假ｽ､・ｱ隰ｨ蜉ｱ竊鍋ｸｺ蜉ｱ竊醍ｸｺ繝ｻ
      }
    }
  }

  const costBreakdown = estimateExecutionCostBreakdown({
    provider: aiConfig.provider,
    model: aiConfig.model,
    generatedChars: countGeneratedChars(fullContent),
    competitorResearchUsed: Boolean(competitorData?.articles?.length),
    factCheckItemsChecked,
    imagesGenerated: scheduleImageGenerationEnabled && aiConfig.image_enabled ? scheduleImagesPerArticle : 0,
    imageUnitCostUsd: imageCostUsdPerImage,
  });
  (costBreakdown as any).trigger_type = triggerType;
  (costBreakdown as any).generation_debug = buildGenerationDebug({
    outline,
    title: articleTitle,
    keyword,
    targetWordCount,
    generatedChars: countGeneratedChars(fullContent),
    relatedKeywords,
    competitorHeadings,
    publishErrorMessage,
  });

  // 6. 陞ｳ貅ｯ・｡謔滂ｽｱ・･雎・ｽｴ郢ｧ蜑・ｽｿ譎擾ｽｭ繝ｻ
  const executionHistoryPayload: Record<string, any> = {
    account_id: schedule.account_id || wpConfig.account_id || null,
    schedule_id: schedule.id,
    wordpress_config_id: wpConfig.id,
    executed_at: new Date().toISOString(),
    keyword_used: keyword,
    article_title: articleTitle,
    wordpress_post_id: postId ?? '',
    status: postId ? 'success' : 'failed',
    error_message: postId ? null : (publishErrorMessage || 'WordPress publish failed'),
    cost_breakdown: costBreakdown,
    estimated_cost_usd: costBreakdown.total_estimated_usd,
  };
  let executionHistoryResult = progressHistoryId
    ? await supabase
      .from('execution_history')
      .update(executionHistoryPayload)
      .eq('id', progressHistoryId)
      .select('id')
      .single()
    : await supabase
      .from('execution_history')
      .insert(executionHistoryPayload)
      .select('id')
      .single();

  if (isMissingColumnError(executionHistoryResult.error, 'account_id')) {
    console.warn('execution_history.account_id is missing. Retrying history insert without account_id.');
    delete executionHistoryPayload.account_id;
    executionHistoryResult = progressHistoryId
      ? await supabase
        .from('execution_history')
        .update(executionHistoryPayload)
        .eq('id', progressHistoryId)
        .select('id')
        .single()
      : await supabase
        .from('execution_history')
        .insert(executionHistoryPayload)
        .select('id')
        .single();
  }

  const { data: executionHistory, error: executionHistoryError } = executionHistoryResult;

  if (executionHistoryError) {
    console.error('Failed to save execution history:', executionHistoryError);
  }

  if (!postId) {
    throw new Error(`WordPress publish failed: ${publishErrorMessage || 'Unknown error'}`);
  }

  return {
    wordpress_config_id: wpConfig.id,
    wordpress_config_name: wpConfig.name,
    success: true,
    keyword,
    title: articleTitle,
    post_id: postId
  };
}

// 髫ｴ蟷｢・ｽ・ｪ髣厄ｽｴ繝ｻ・ｿ鬨ｾ蛹・ｽｽ・ｨ驛｢・ｧ繝ｻ・ｭ驛｢譎｢・ｽ・ｼ驛｢譎｢・ｽ・ｯ驛｢譎｢・ｽ・ｼ驛｢譎擾ｽｳ・ｨ繝ｻ蟶晢ｽｩ蛹・ｽｽ・ｸ髫ｰ螢ｹ繝ｻ
async function selectUnusedKeyword(
  scheduleId: string,
  allKeywords: string[],
  supabase: any
): Promise<string | null> {
  const { data: history } = await supabase
    .from('execution_history')
    .select('keyword_used')
    .eq('schedule_id', scheduleId);

  const usedKeywords = new Set((history || []).map((h: any) => h.keyword_used));
  const availableKeywords = allKeywords.filter(k => !usedKeywords.has(k));

  if (availableKeywords.length === 0) {
    console.log(`All keywords used for schedule ${scheduleId}. Posting will be skipped until keywords are reset.`);
    return null;
  }

  // 郢晢ｽｪ郢ｧ・ｹ郢晉｣ｯ・ｰ繝ｻ 隴幢ｽｪ闖ｴ・ｿ騾包ｽｨ邵ｺ・ｮ陷育｣ｯ・ｰ・ｭ郢ｧ蟶昶・邵ｺ・ｶ
  return availableKeywords[0];
}

// 髫ｴ蟷｢・ｽ・ｪ髣厄ｽｴ繝ｻ・ｿ鬨ｾ蛹・ｽｽ・ｨ驛｢・ｧ繝ｻ・ｿ驛｢・ｧ繝ｻ・､驛｢譎冗樟・取刮・ｹ・ｧ陝ｶ譏ｶ繝ｻ髫ｰ螢ｹ繝ｻ
async function selectUnusedTitle(
  scheduleId: string,
  allTitles: string[],
  supabase: any
): Promise<string | null> {
  const { data: history } = await supabase
    .from('execution_history')
    .select('article_title')
    .eq('schedule_id', scheduleId);

  // 髯橸ｽｳ隰疲ｺ倥・驍ｵ・ｺ繝ｻ・ｫ髣包ｽｳ・つ鬮｢・ｾ繝ｻ・ｴ驍ｵ・ｺ陷ｷ・ｶ繝ｻ迢暦ｽｹ・ｧ繝ｻ・ｿ驛｢・ｧ繝ｻ・､驛｢譎冗樟・取刮・ｹ・ｧ陝ｶ譎乗ｱる辨貅倥・
  const usedTitles = new Set((history || []).map((h: any) => h.article_title));
  const availableTitles = allTitles.filter(t => !usedTitles.has(t));

  if (availableTitles.length === 0) {
    console.log('All titles used, resetting list');
    if (allTitles.length === 0) return null;
    return allTitles[0];
  }

  // 郢晢ｽｪ郢ｧ・ｹ郢晉｣ｯ・ｰ繝ｻ 隴幢ｽｪ闖ｴ・ｿ騾包ｽｨ邵ｺ・ｮ陷育｣ｯ・ｰ・ｭ郢ｧ蟶昶・邵ｺ・ｶ
  return availableTitles[0];
}

async function getTermIdBySlugOrName(
  config: WordPressConfig,
  restBase: string,
  categoryIdentifier: string
): Promise<number | null> {
  const auth = btoa(`${config.username}:${config.password}`);

  try {
    // 驍ｵ・ｺ繝ｻ・ｾ驍ｵ・ｺ陞｢・ｹ邵ｺ蟶ｷ・ｹ譎｢・ｽ・ｩ驛｢譏ｴ繝ｻ邵ｺ蝣､・ｸ・ｺ繝ｻ・ｧ髫ｶﾂ隲帙・・ｽ・ｴ繝ｻ・｢
    let response = await fetch(
      `${config.url}/wp-json/wp/v2/${restBase}?slug=${encodeURIComponent(categoryIdentifier)}`,
      { headers: { 'Authorization': `Basic ${auth}` } }
    );

    if (response.ok) {
      const data = await response.json();
      if (data.length > 0) {
        console.log(`Found category by slug "${categoryIdentifier}": ID ${data[0].id}`);
        return data[0].id;
      }
    }

    // 驛｢・ｧ繝ｻ・ｹ驛｢譎｢・ｽ・ｩ驛｢譏ｴ繝ｻ邵ｺ蝣､・ｸ・ｺ繝ｻ・ｧ鬮ｫ遨ゑｽｹ譏ｶ蜻ｽ驍ｵ・ｺ闕ｵ譎｢・ｽ閾･・ｸ・ｺ繝ｻ・ｪ驍ｵ・ｺ闔会ｽ｣繝ｻ讙趣ｽｸ・ｺ繝ｻ・ｰ髯ｷ・ｷ隶朱｡披・驍ｵ・ｺ繝ｻ・ｧ髫ｶﾂ隲帙・・ｽ・ｴ繝ｻ・｢
    response = await fetch(
      `${config.url}/wp-json/wp/v2/${restBase}?search=${encodeURIComponent(categoryIdentifier)}`,
      { headers: { 'Authorization': `Basic ${auth}` } }
    );

    if (response.ok) {
      const data = await response.json();
      // 髯橸ｽｳ隰疲ｺ倥・髣包ｽｳ・つ鬮｢・ｾ繝ｻ・ｴ驛｢・ｧ陷ｻ閧ｲ邊滄し・ｺ郢晢ｽｻ
      const exactMatch = data.find((cat: any) =>
        cat.name.toLowerCase() === categoryIdentifier.toLowerCase()
      );
      if (exactMatch) {
        console.log(`Found category by name "${categoryIdentifier}": ID ${exactMatch.id}`);
        return exactMatch.id;
      }
      // 髯橸ｽｳ隰疲ｺ倥・髣包ｽｳ・つ鬮｢・ｾ繝ｻ・ｴ驍ｵ・ｺ陟募ｨｯ繝ｻ驍ｵ・ｺ闔会ｽ｣繝ｻ讙趣ｽｸ・ｺ繝ｻ・ｰ髫ｴ蟠｢ﾂ髯具ｽｻ隴擾ｽｴ郢晢ｽｻ鬩搾ｽｨ陷亥沺・｣・｡驛｢・ｧ陞ｳ螟ｲ・ｽ・ｿ隴∫ｵｶ繝ｻ
      if (data.length > 0) {
        console.log(`Found category by partial match "${categoryIdentifier}": ID ${data[0].id}`);
        return data[0].id;
      }
    }

    console.warn(`Category "${categoryIdentifier}" not found`);
    return null;
  } catch (error) {
    console.error(`Error searching for category "${categoryIdentifier}":`, error);
    return null;
  }
}

// WordPress髫ｰ螢ｽ繝ｻ繝ｻ・ｨ繝ｻ・ｿ
function splitLongParagraphForReadability(text: string): string[] {
  const normalized = String(text || '').replace(/\s+/g, ' ').trim();
  if (!normalized) return [];

  const sentences = normalized
    .split(/(?<=[邵ｲ繧托ｽｼ繝ｻ・ｼ繝ｻ?])\s*/g)
    .map((s) => s.trim())
    .filter(Boolean);

  if (sentences.length <= 2) return [normalized];

  const chunks: string[] = [];
  let buffer: string[] = [];
  let charCount = 0;

  for (const sentence of sentences) {
    buffer.push(sentence);
    charCount += sentence.length;

    if (buffer.length >= 2 || charCount >= 140) {
      chunks.push(buffer.join(''));
      buffer = [];
      charCount = 0;
    }
  }

  if (buffer.length > 0) {
    chunks.push(buffer.join(''));
  }

  return chunks.length > 0 ? chunks : [normalized];
}

function renderBufferedBlock(lines: string[]): string[] {
  const cleaned = (lines || [])
    .map((line) => String(line || '').trim())
    .filter((line) => line.length > 0);
  if (cleaned.length === 0) return [];

  const isUnorderedList = cleaned.every((line) => /^[-*+]\s+/.test(line));
  if (isUnorderedList) {
    const items = cleaned
      .map((line) => line.replace(/^[-*+]\s+/, '').trim())
      .filter(Boolean)
      .map((item) => `<li>${item}</li>`)
      .join('\n');
    return [`<ul>\n${items}\n</ul>`];
  }

  const isOrderedList = cleaned.every((line) => /^\d+[.)]\s+/.test(line));
  if (isOrderedList) {
    const items = cleaned
      .map((line) => line.replace(/^\d+[.)]\s+/, '').trim())
      .filter(Boolean)
      .map((item) => `<li>${item}</li>`)
      .join('\n');
    return [`<ol>\n${items}\n</ol>`];
  }

  const merged = cleaned.join(' ').replace(/\s+/g, ' ').trim();
  return splitLongParagraphForReadability(merged).map((paragraph) => `<p>${paragraph}</p>`);
}

function wrapPlainTextBlocksWithParagraphs(text: string): string {
  const lines = String(text || '')
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .split('\n');

  const output: string[] = [];
  let buffer: string[] = [];

  const flushBuffer = () => {
    const rendered = renderBufferedBlock(buffer);
    if (rendered.length > 0) {
      output.push(...rendered);
    }
    buffer = [];
  };

  for (const rawLine of lines) {
    const line = String(rawLine || '').trim();
    if (!line) {
      flushBuffer();
      continue;
    }

    if (/^<h[1-6][^>]*>[\s\S]*<\/h[1-6]>$/i.test(line)) {
      flushBuffer();
      output.push(line);
      continue;
    }

    if (/^<(ul|ol|li|p|blockquote|pre|table)\b/i.test(line)) {
      flushBuffer();
      output.push(line);
      continue;
    }

    buffer.push(line);
  }

  flushBuffer();
  return output.join('\n\n').replace(/\n{3,}/g, '\n\n').trim();
}

function formatContentForWordPress(rawContent: string): string {
  let text = String(rawContent ?? '');

  // Markdown headings -> HTML headings (陝ｶ・ｸ邵ｺ・ｫ陞溽判驪､)
  text = text
    .replace(/^\s*######\s+(.+)$/gm, '<h6>$1</h6>')
    .replace(/^\s*#####\s+(.+)$/gm, '<h5>$1</h5>')
    .replace(/^\s*####\s+(.+)$/gm, '<h4>$1</h4>')
    .replace(/^\s*###\s+(.+)$/gm, '<h3>$1</h3>')
    .replace(/^\s*##\s+(.+)$/gm, '<h2>$1</h2>')
    .replace(/^\s*#\s+(.+)$/gm, '<h1>$1</h1>');

  // Markdown emphasis -> HTML繝ｻ驛・ｽｦ蜿･繝ｻ邵ｺ諤懶ｽ､逕ｻ驪､陟募ｾ後堤ｹｧ繧会ｽ｢・ｺ陞ｳ貅倪・陞ｳ貅ｯ・｡魃会ｽｼ繝ｻ
  text = text
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>');

  // 陞溽判驪､雋堺ｸ奇ｽ檎ｸｺ・ｮ陝・ｽ､驕ｶ荵晢ｼ邵ｺ繝ｻ** 郢ｧ蟶晏求陷ｴ・ｻ
  text = text.replace(/\*\*/g, '');

  // 隴幢ｽｬ隴√・・定ｰｿ・ｵ髣懶ｽｽ陋ｹ謔ｶ・邵ｺ・ｦ邵ｲ竏ｬ・ｩ・ｰ邵ｺ・ｾ邵ｺ・｣邵ｺ・ｦ髫穂ｹ昶斡郢ｧ蜿･謦ｫ鬯伜ｾ鯉ｽ帝ｫｦ・ｲ邵ｺ繝ｻ
  return wrapPlainTextBlocksWithParagraphs(text);
}

function normalizeComparableText(value: string): string {
  return String(value || '')
    .replace(/^#{1,6}\s+/, '')
    .replace(/^<h[1-6][^>]*>/i, '')
    .replace(/<\/h[1-6]>$/i, '')
    .replace(/^(タイトル|見出し|heading|title)\s*[:：]\s*/i, '')
    .replace(/^[Tt]itle[:：]\s*/, '')
    .toLowerCase()
    .replace(/[\s\u3000]/g, '')
    .replace(/[「」『』（）()【】\[\]"'`]/g, '')
    .replace(/[、。,.・:：]/g, '')
    .trim();
}

function extractHeadingText(line: string): string {
  const trimmed = String(line || '').trim();
  const markdown = trimmed.match(/^#{1,6}\s+(.+)$/);
  if (markdown?.[1]) return markdown[1].trim();
  const html = trimmed.match(/^<h[1-6][^>]*>([\s\S]*?)<\/h[1-6]>$/i);
  if (html?.[1]) return html[1].replace(/<[^>]+>/g, '').trim();
  return trimmed;
}

function isHeadingLine(line: string): boolean {
  const trimmed = String(line || '').trim();
  return /^#{1,6}\s+.+$/.test(trimmed) || /^<h[1-6][^>]*>[\s\S]*<\/h[1-6]>$/i.test(trimmed);
}

function findNextNonEmptyLineIndex(lines: string[], startIndex: number): number {
  for (let i = startIndex; i < lines.length; i++) {
    if (String(lines[i] || '').trim()) return i;
  }
  return -1;
}

function isLikelyBodyLine(line: string): boolean {
  const text = String(line || '').trim();
  if (!text) return false;
  if (isHeadingLine(text)) return false;
  if (/^[-*+]\s|^\d+[.)]\s|^[・●■◆]\s?/.test(text)) return true;
  return text.length >= 20 || /[。！？!?]$/.test(text);
}

function looksLikeStandaloneHeadingLine(line: string): boolean {
  const text = String(line || '').trim();
  if (!text) return false;
  if (isHeadingLine(text)) return false;
  if (/^[-*+]\s|^\d+[.)]\s|^[・●■◆]\s?/.test(text)) return false;
  if (/^https?:\/\//i.test(text)) return false;
  if (text.length < 5 || text.length > 90) return false;
  if (/[。！？!?]$/.test(text)) return false;
  return /[A-Za-z0-9\u3040-\u30ff\u3400-\u9fff]/.test(text);
}

function isSummaryHeadingText(text: string): boolean {
  const normalized = normalizeComparableText(text);
  if (!normalized) return false;
  const tokens = ['まとめ', '結論', '要約', '総括', 'summary', 'conclusion'];
  return tokens.some((token) => normalized.includes(normalizeComparableText(token)));
}

function findHeadingOnlySections(content: string): string[] {
  const lines = String(content || '').split('\n');
  const headings: Array<{ index: number; level: number; title: string }> = [];
  for (let i = 0; i < lines.length; i++) {
    const line = String(lines[i] || '').trim();
    if (!isHeadingLine(line)) continue;
    const title = extractHeadingText(line);
    if (!title) continue;
    headings.push({ index: i, level: getHeadingLevel(line), title });
  }

  const missing: string[] = [];
  for (let i = 0; i < headings.length; i++) {
    const current = headings[i];
    const nextSameOrHigher = headings.find((candidate, candidateIndex) =>
      candidateIndex > i && candidate.level <= current.level
    );
    const end = nextSameOrHigher ? nextSameOrHigher.index : lines.length;
    const body = lines
      .slice(current.index + 1, end)
      .filter((line) => !isHeadingLine(line))
      .join('\n')
      .trim();
    const minChars = isSummaryHeadingText(current.title) ? 20 : 40;
    if (countGeneratedChars(body) < minChars) {
      missing.push(current.title);
    }
  }
  return missing;
}

function sanitizeHeadingLabel(text: string): string {
  return String(text || '')
    .replace(/^[\d０-９]+[.)．、:：]\s*/, '')
    .replace(/^[・●■◆]\s*/, '')
    .replace(/[。！？!?]\s*$/, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

function expandSimpleH2Heading(title: string): string {
  const current = sanitizeHeadingLabel(title);
  if (!current || isSummaryHeadingText(current)) return current;
  return current;
}

function getHeadingLevel(line: string): number {
  const trimmed = String(line || '').trim();
  const markdown = trimmed.match(/^(#{1,6})\s+(.+)$/);
  if (markdown?.[1]) return markdown[1].length;
  const html = trimmed.match(/^<h([1-6])[^>]*>[\s\S]*<\/h[1-6]>$/i);
  if (html?.[1]) return Number(html[1]);
  return 0;
}

function rewriteHeadingLine(originalLine: string, level: number, title: string): string {
  const safeLevel = Math.min(6, Math.max(1, Math.floor(level)));
  const safeTitle = String(title || '').trim();
  if (!safeTitle) return originalLine;

  if (/^<h[1-6][^>]*>[\s\S]*<\/h[1-6]>$/i.test(String(originalLine || '').trim())) {
    return `<h${safeLevel}>${safeTitle}</h${safeLevel}>`;
  }
  return `${'#'.repeat(safeLevel)} ${safeTitle}`;
}

function normalizeHeadingHierarchy(lines: string[]): string[] {
  const output = [...lines];

  for (let i = 0; i < output.length; i += 1) {
    const rawLine = String(output[i] || '');
    const trimmed = rawLine.trim();
    if (!isHeadingLine(trimmed)) continue;

    let level = getHeadingLevel(trimmed);
    if (!Number.isFinite(level) || level <= 0) continue;

    let title = sanitizeHeadingLabel(extractHeadingText(trimmed));
    if (!title) continue;

    // Keep H2/H3 hierarchy. Only normalize overly deep headings into H3.
    if (level === 1) {
      level = 2;
    } else if (level > 3) {
      level = 3;
    }

    if (!isSummaryHeadingText(title)) {
      title = expandSimpleH2Heading(title);
    }

    output[i] = rewriteHeadingLine(rawLine, level, title);
  }

  return output;
}

function countNonSummaryHeadings(content: string): number {
  const lines = String(content || '')
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .split('\n');

  let count = 0;
  for (const rawLine of lines) {
    const trimmed = String(rawLine || '').trim();
    if (!trimmed) continue;

    let level = 0;
    const markdownMatch = trimmed.match(/^(#{1,6})\s+.+$/);
    if (markdownMatch?.[1]) {
      level = markdownMatch[1].length;
    } else {
      const htmlMatch = trimmed.match(/^<h([1-6])[^>]*>[\s\S]*<\/h[1-6]>$/i);
      if (htmlMatch?.[1]) {
        level = Number(htmlMatch[1]);
      }
    }

    if (!Number.isFinite(level) || level < 2) continue;
    const headingText = extractHeadingText(trimmed);
    if (!headingText || isSummaryHeadingText(headingText)) continue;
    count += 1;
  }

  return count;
}

function removeDuplicateSummarySections(lines: string[]): string[] {
  const headingRows: Array<{ start: number; end: number; headingText: string; bodyLength: number }> = [];

  for (let i = 0; i < lines.length; i++) {
    const text = String(lines[i] || '').trim();
    if (!isHeadingLine(text)) continue;

    let nextHeading = lines.length;
    for (let j = i + 1; j < lines.length; j++) {
      const nextText = String(lines[j] || '').trim();
      if (isHeadingLine(nextText)) {
        nextHeading = j;
        break;
      }
    }

    const bodyLength = lines
      .slice(i + 1, nextHeading)
      .join(' ')
      .replace(/\s+/g, '')
      .length;

    headingRows.push({
      start: i,
      end: nextHeading,
      headingText: extractHeadingText(text),
      bodyLength,
    });
  }

  const summaryRows = headingRows.filter((row) => isSummaryHeadingText(row.headingText));
  if (summaryRows.length <= 1) return lines;

  const keepRow = summaryRows
    .slice()
    .sort((a, b) => b.bodyLength - a.bodyLength)[0];
  const removeRanges = summaryRows
    .filter((row) => row.start !== keepRow.start)
    .map((row) => ({ start: row.start, end: row.end }));

  if (removeRanges.length === 0) return lines;

  const filtered = lines.filter((_, index) => {
    return !removeRanges.some((range) => index >= range.start && index < range.end);
  });

  console.log(`Removed duplicate summary sections: ${removeRanges.length} removed`);
  return filtered;
}

function shouldRemoveLeadingTitleLine(line: string, articleTitle: string): boolean {
  const raw = extractHeadingText(line);
  if (!raw) return false;

  const looksHeadingLike = isHeadingLine(line) || (
    raw.length <= 80 &&
    !/[邵ｲ繧托ｽｼ繝ｻ・ｼ繝ｻ!?]$/.test(raw) &&
    /[A-Za-z0-9\u3040-\u30ff\u3400-\u9fff]/.test(raw)
  );
  if (!looksHeadingLike) return false;

  const normalizedLine = normalizeComparableText(raw);
  const normalizedTitle = normalizeComparableText(articleTitle);
  if (!normalizedLine || !normalizedTitle) return false;

  const withoutSummary = normalizeComparableText(raw.replace(/繝ｻ驛・ｽｦ竏ｫ・ｴ繝ｻ・ｼ讎蚕(髫補悪・ｴﾐｫ)|邵ｲ蜊・ｦ竏ｫ・ｴ繝ｻﾂ謗・囎竏ｫ・ｴ繝ｻ/g, ''));
  if (normalizedLine === normalizedTitle) return true;
  if (withoutSummary === normalizedTitle) return true;
  // Only remove via prefix match when the line is close in length to the title
  // (prevents removing lead sentences that start with the keyword).
  const lineIsShortEnough = raw.length <= articleTitle.length * 1.3 + 10;
  if (lineIsShortEnough && (normalizedLine.startsWith(normalizedTitle) || normalizedTitle.startsWith(normalizedLine))) return true;

  const hasSummarySuffix = /(繝ｻ驛・ｽｦ竏ｫ・ｴ繝ｻ・ｼ讎蚕(髫補悪・ｴﾐｫ)|邵ｲ蜊・ｦ竏ｫ・ｴ繝ｻﾂ謗・囎竏ｫ・ｴ繝ｻ)/.test(raw);
  if (hasSummarySuffix && (normalizedLine.includes(normalizedTitle) || withoutSummary.includes(normalizedTitle))) {
    return true;
  }

  // Fuzzy near-duplicate check
  const minComparable = Math.min(normalizedLine.length, normalizedTitle.length);
  if (minComparable >= 10) {
    let commonPrefixLen = 0;
    while (
      commonPrefixLen < minComparable &&
      normalizedLine[commonPrefixLen] === normalizedTitle[commonPrefixLen]
    ) {
      commonPrefixLen += 1;
    }
    const prefixRate = commonPrefixLen / Math.max(1, minComparable);
    if (prefixRate >= 0.72) return true;
  }
  return false;
}

function normalizeGeneratedContentForPublishing(rawContent: string, articleTitle: string): string {
  let text = String(rawContent ?? '')
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .replace(/\uFEFF/g, '')
    .trim();

  if (!text) return '';
  let lines = text.split('\n');

  // In WordPress, post title is handled separately; drop accidental leading H1 in body.
  const firstHeadingIndex = findNextNonEmptyLineIndex(lines, 0);
  if (firstHeadingIndex !== -1 && getHeadingLevel(lines[firstHeadingIndex]) === 1) {
    lines.splice(firstHeadingIndex, 1);
  }

  const firstLineIndex = findNextNonEmptyLineIndex(lines, 0);
  if (firstLineIndex !== -1 && shouldRemoveLeadingTitleLine(lines[firstLineIndex], articleTitle)) {
    lines.splice(firstLineIndex, 1);
  }
  for (let pass = 0; pass < 2; pass += 1) {
    const idx = findNextNonEmptyLineIndex(lines, 0);
    if (idx === -1) break;
    if (!shouldRemoveLeadingTitleLine(lines[idx], articleTitle)) break;
    lines.splice(idx, 1);
  }

  for (let i = 0; i < lines.length; i++) {
    const current = String(lines[i] || '').trim();
    if (!looksLikeStandaloneHeadingLine(current)) continue;

    const nextIndex = findNextNonEmptyLineIndex(lines, i + 1);
    if (nextIndex === -1) continue;
    const next = String(lines[nextIndex] || '').trim();
    if (isHeadingLine(next)) continue;
    if (!isLikelyBodyLine(next)) continue;

    const normalizedHeading = expandSimpleH2Heading(current) || sanitizeHeadingLabel(current) || current;
    lines[i] = `## ${normalizedHeading}`;
  }

  lines = normalizeHeadingHierarchy(lines);
  lines = removeDuplicateSummarySections(lines);

  const withoutEmptyHeadings: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    const rawLine = String(lines[i] || '');
    const trimmed = rawLine.trim();
    if (!trimmed) {
      withoutEmptyHeadings.push(rawLine);
      continue;
    }

    if (!isHeadingLine(trimmed)) {
      withoutEmptyHeadings.push(rawLine);
      continue;
    }

    const nextIndex = findNextNonEmptyLineIndex(lines, i + 1);
    if (nextIndex === -1) continue;
    const next = String(lines[nextIndex] || '').trim();
    if (isHeadingLine(next)) continue;

    withoutEmptyHeadings.push(rawLine);
  }

  lines = withoutEmptyHeadings;
  lines = normalizeHeadingHierarchy(lines);
  lines = removeDuplicateSummarySections(lines);
  let cleaned = lines.join('\n').replace(/\n{3,}/g, '\n\n').trim();

  const postLines = cleaned.split('\n');
  const postFirstHeadingIndex = findNextNonEmptyLineIndex(postLines, 0);
  if (postFirstHeadingIndex !== -1 && getHeadingLevel(postLines[postFirstHeadingIndex]) === 1) {
    postLines.splice(postFirstHeadingIndex, 1);
  }
  const postFirstLineIndex = findNextNonEmptyLineIndex(postLines, 0);
  if (postFirstLineIndex !== -1 && shouldRemoveLeadingTitleLine(postLines[postFirstLineIndex], articleTitle)) {
    postLines.splice(postFirstLineIndex, 1);
  }
  cleaned = postLines.join('\n').replace(/\n{3,}/g, '\n\n').trim();

  return cleaned;
}

function extractExcerpt(content: string, maxLength = 180): string {
  const plain = String(content || '')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/\*\*/g, '')
    .replace(/\*/g, '')
    .replace(/!\[[^\]]*]\([^)]+\)/g, '')
    .replace(/\[[^\]]+]\([^)]+\)/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();
  if (plain.length <= maxLength) return plain;
  return `${plain.slice(0, maxLength)}...`;
}

function inferLengthCategory(charCount: number): 'short' | 'medium' | 'long' {
  if (charCount < 1200) return 'short';
  if (charCount < 2400) return 'medium';
  return 'long';
}

async function saveGeneratedArticleSnapshot(
  supabase: any,
  params: {
    title: string;
    content: string;
    keywords: string[];
    status: 'draft' | 'published' | 'failed';
    tone: WritingTone;
    aiConfig: AIConfig;
    wpConfig: WordPressConfig;
    postId?: string | null;
    publishedAt?: string | null;
  }
): Promise<string | null> {
  const wordCount = countGeneratedChars(params.content);
  const readingTime = Math.max(1, Math.round(wordCount / 500));

  const payload = {
    title: params.title,
    content: params.content,
    excerpt: extractExcerpt(params.content),
    keywords: params.keywords,
    category: params.wpConfig.category || '',
    status: params.status,
    tone: params.tone,
    length: inferLengthCategory(wordCount),
    ai_provider: params.aiConfig.provider || '',
    ai_model: params.aiConfig.model || '',
    published_at: params.publishedAt ?? null,
    wordpress_post_id: params.postId ?? '',
    wordpress_config_id: params.wpConfig.id,
    reading_time: readingTime,
    word_count: wordCount,
    trend_data: {},
  };

  const { data, error } = await supabase
    .from('articles')
    .insert(payload)
    .select('id')
    .single();

  if (error) {
    console.error('Failed to save generated article snapshot:', error);
    return null;
  }

  const articleId = data?.id ? String(data.id) : null;
  if (articleId) {
    console.log(`Saved generated article snapshot: ${articleId}`);
  }
  return articleId;
}

async function publishToWordPress(
  config: WordPressConfig,
  title: string,
  content: string,
  status: string
): Promise<string> {
  const auth = btoa(`${config.username}:${config.password}`);

  // 驛｢・ｧ繝ｻ・ｫ驛｢・ｧ繝ｻ・ｹ驛｢・ｧ繝ｻ・ｿ驛｢譎｢・｣・ｰ髫ｰ螢ｽ繝ｻ繝ｻ・ｨ繝ｻ・ｿ驛｢・ｧ繝ｻ・ｿ驛｢・ｧ繝ｻ・､驛｢譎丞ｹｲ遶頑･｢豎槭・・ｾ髯滂ｽ｢隲帛･・ｽｼ・ｰ驍ｵ・ｺ雋・･笙驛｢譎｢・ｽ・ｳ驛｢譎擾ｽｳ・ｨ郢晢ｽｻ驛｢・ｧ繝ｻ・､驛｢譎｢・ｽ・ｳ驛｢譎冗樟繝ｻ螳夲ｽｮ蝣､霍昴・・ｯ郢晢ｽｻ
  const postType = config.post_type || 'posts';
  const wpApiUrl = `${config.url}/wp-json/wp/v2/${postType}`;
  console.log(`Publishing to WordPress: ${wpApiUrl}`);

  const termAssignment = config.category
    ? await resolveTermAssignmentForPostType(config, postType, config.category)
    : null;

  // 驛｢・ｧ繝ｻ・ｫ驛｢譏ｴ繝ｻ邵ｺ荵滂ｽｹ譎｢・ｽ・ｪID驍ｵ・ｺ繝ｻ・ｮ髯ｷ・ｿ鬮｢ﾂ繝ｻ・ｾ隴会ｽｦ繝ｻ・ｼ陜捺ｺｽ繝ｻ髯区ｻゑｽｽ・､ID驍ｵ・ｲ遶丞｣ｹ笳矩Δ譎｢・ｽ・ｩ驛｢譏ｴ繝ｻ邵ｺ蝣､・ｸ・ｲ遶乗辨蛟ｹ髯ｷ鮃ｹ莠らｫ頑･｢豎槭・・ｾ髯滂ｽ｢隲幢ｽｶ繝ｻ・ｼ郢晢ｽｻ
  let categoryIds: number[] = [];
  if (config.category) {
    const trimmed = config.category.trim();

    // 驍ｵ・ｺ繝ｻ・ｾ驍ｵ・ｺ陞｢・ｽ霎溷､雁ｱ舌・・､ID驍ｵ・ｺ繝ｻ・ｨ驍ｵ・ｺ陷会ｽｱ遯ｶ・ｻ驛｢譏懶ｽｻ・｣郢晢ｽｻ驛｢・ｧ繝ｻ・ｹ驛｢・ｧ陞ｳ螟ｲ・ｽ・ｩ繝ｻ・ｦ驍ｵ・ｺ繝ｻ・ｿ驛｢・ｧ郢晢ｽｻ
    const parsed = parseInt(trimmed, 10);
    if (!isNaN(parsed)) {
      categoryIds = [parsed];
      console.log(`Using category ID: ${parsed}`);
    } else {
      // 驛｢・ｧ繝ｻ・ｹ驛｢譎｢・ｽ・ｩ驛｢譏ｴ繝ｻ邵ｺ蝣､・ｸ・ｺ繝ｻ・ｾ驍ｵ・ｺ雋・･繝ｻ髯ｷ・ｷ隶朱｡披・驍ｵ・ｺ繝ｻ・ｨ驍ｵ・ｺ陷会ｽｱ遯ｶ・ｻ髫ｶﾂ隲帙・・ｽ・ｴ繝ｻ・｢
      console.log(`Looking up category by slug/name: ${trimmed}`);
      const categoryId = await getCategoryIdBySlugOrName(config, trimmed);
      if (categoryId) {
        categoryIds = [categoryId];
        console.log(`Found category ID: ${categoryId} for "${trimmed}"`);
      } else {
        console.warn(`Category "${trimmed}" not found. WordPress will use default category.`);
      }
    }
  }

  const postPayload: Record<string, any> = {
    title,
    content: formatContentForWordPress(content),
    status,
  };
  if (termAssignment) {
    postPayload[termAssignment.field] = termAssignment.ids;
    console.log(`Using taxonomy field "${termAssignment.field}" for "${config.category}": ${termAssignment.ids.join(', ')}`);
  } else {
    postPayload.categories = categoryIds;
  }
  const requestBody = JSON.stringify(postPayload);

  const postWithEndpoint = async (
    endpoint: string
  ): Promise<{ ok: true; postId: string } | { ok: false; status: number; text: string }> => {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Basic ${auth}`
      },
      body: requestBody
    });

    if (!response.ok) {
      const text = await response.text();
      return { ok: false, status: response.status, text };
    }

    const data = await response.json();
    return { ok: true, postId: String(data.id) };
  };

  const primary = await postWithEndpoint(wpApiUrl);
  if (primary.ok) {
    return primary.postId;
  }

  const primaryErrorText = String(primary.text || '');
  const shouldFallbackToPosts = postType !== 'posts' && (
    primary.status === 404 ||
    /rest_no_route|invalid[_ ]post[_ ]type|post[_ ]type/i.test(primaryErrorText)
  );

  if (!shouldFallbackToPosts) {
    throw new Error(`WordPress API error: ${primary.status} - ${primaryErrorText}`);
  }

  const fallbackUrl = `${config.url}/wp-json/wp/v2/posts`;
  console.warn(`Primary post_type "${postType}" failed. Falling back to default posts endpoint: ${fallbackUrl}`);
  const fallback = await postWithEndpoint(fallbackUrl);
  if (fallback.ok) {
    return fallback.postId;
  }

  throw new Error(
    `WordPress API error on both endpoints. primary(${wpApiUrl}): ${primary.status} - ${primaryErrorText}; ` +
    `fallback(${fallbackUrl}): ${fallback.status} - ${fallback.text}`
  );
}


function formatOutlineForSinglePass(outline: ArticleOutline): string {
  return (outline.sections || [])
    .map((section, index) => {
      const level = section.isLead ? 'lead' : section.level === 3 ? 'H3' : 'H2';
      const indent = section.level === 3 ? '   ' : '';
      const chars = section.estimatedWordCount ? ` (${section.estimatedWordCount}字)` : '';
      const description = section.description ? ` — ${section.description}` : '';
      return `${indent}${index + 1}. [${level}] ${section.title}${chars}${description}`;
    })
    .join('\n');
}

function validateGeneratedArticleCompleteness(
  content: string,
  outline: ArticleOutline,
  targetWordCount: number
): void {
  const normalized = String(content || '').trim();
  const charCount = countGeneratedChars(normalized);
  const minChars = Math.max(500, Math.round(Math.max(800, targetWordCount) * 0.75));
  if (charCount < minChars) {
    throw new Error(`Generated article is too short (${charCount}/${targetWordCount} chars). AI output may have stopped midway.`);
  }

  const expectedHeadings = (outline.sections || []).filter((section) => !section.isLead).length;
  const actualHeadings = countNonSummaryHeadings(normalized);
  const minHeadings = Math.min(Math.max(2, Math.floor(expectedHeadings * 0.5)), expectedHeadings);
  if (expectedHeadings >= 3 && actualHeadings < minHeadings) {
    throw new Error(`Generated article is missing headings (${actualHeadings}/${expectedHeadings}). AI output may be incomplete.`);
  }

  const headingOnlySections = findHeadingOnlySections(normalized);
  if (headingOnlySections.length > 0) {
    throw new Error(`Generated article has headings without body text: ${headingOnlySections.slice(0, 5).join(', ')}`);
  }

  // Only flag truncation when the last paragraph looks genuinely cut off:
  // skip heading lines, list items, and short label-like lines.
  const lines = normalized.split('\n').map((line) => line.trim()).filter(Boolean);
  const lastTextLine = lines
    .slice()
    .reverse()
    .find((line) => !/^#{1,6}\s/.test(line) && !/^[-*]\s/.test(line) && line.length >= 20) || '';
  if (lastTextLine && !/[。！？.!?」』）)\w]$/.test(lastTextLine)) {
    console.warn(`Generated article may end mid-sentence: ${trimForLog(lastTextLine, 120)}`);
  }
}

function compactArticleToTargetLength(content: string, targetWordCount: number): string {
  const maxChars = Math.round(Math.max(800, targetWordCount) * 1.2);
  let text = String(content || '').trim();
  if (!text || countGeneratedChars(text) <= maxChars) return text;

  const blocks = text.split(/\n{2,}/).map((block) => block.trim()).filter(Boolean);
  const compacted: string[] = [];
  for (const block of blocks) {
    const isHeading = isHeadingLine(block);
    if (isHeading) {
      compacted.push(block);
      continue;
    }

    const sentences = block
      .split(/(?<=[。！？!?])\s*/)
      .map((sentence) => sentence.trim())
      .filter(Boolean);
    const reduced = sentences.length >= 3
      ? sentences.slice(0, Math.max(1, Math.ceil(sentences.length * 0.65))).join('')
      : block;
    compacted.push(reduced);
  }

  text = compacted.join('\n\n').trim();
  if (countGeneratedChars(text) <= maxChars) return text;

  const sections: Array<{ blocks: string[]; isSummary: boolean; hasHeading: boolean }> = [];
  for (const block of compacted) {
    if (isHeadingLine(block)) {
      sections.push({
        blocks: [block],
        isSummary: isSummaryHeadingText(extractHeadingText(block)),
        hasHeading: true,
      });
      continue;
    }

    const currentSection = sections[sections.length - 1];
    if (currentSection) {
      currentSection.blocks.push(block);
    } else {
      sections.push({ blocks: [block], isSummary: false, hasHeading: false });
    }
  }

  const summaryCharBudget = sections
    .filter((section) => section.isSummary)
    .reduce((sum, section) => sum + countGeneratedChars(section.blocks.join('\n\n')), 0);
  const nonSummaryMaxChars = Math.max(0, maxChars - summaryCharBudget);
  const shortenedSections: string[][] = [];
  let nonSummaryChars = 0;

  for (const section of sections) {
    const sectionText = section.blocks.join('\n\n');
    const sectionChars = countGeneratedChars(sectionText);

    if (section.isSummary) {
      shortenedSections.push(section.blocks);
      continue;
    }

    if (section.hasHeading && section.blocks.length <= 1) {
      continue;
    }

    if (nonSummaryChars + sectionChars > nonSummaryMaxChars) {
      continue;
    }

    shortenedSections.push(section.blocks);
    nonSummaryChars += sectionChars;
  }

  return shortenedSections.flat().join('\n\n').trim() || text;
}

async function generateSchedulerArticleSinglePass(params: {
  outline: ArticleOutline;
  keyword: string;
  keywords: string[];
  tone: WritingTone;
  targetWordCount: number;
  customInstructions?: string;
  aiConfig: AIConfig;
}): Promise<{ sectionsWithContent: any[]; fullContent: string; wordCount: number }> {
  const outlineText = formatOutlineForSinglePass(params.outline);
  const keywordLine = Array.from(new Set([params.keyword, ...(params.keywords || [])]
    .map((item) => String(item || '').trim())
    .filter(Boolean)))
    .slice(0, 6)
    .join(', ');
  const toneInstruction = params.tone === 'casual'
    ? 'Tone: natural, approachable Japanese. Use desu/masu consistently, but do not sound childish. Keep sentences short and easy to follow.'
    : 'Tone: natural professional Japanese for business readers. Write like an experienced practitioner answering a reader consultation. Avoid stiff report-like prose, manual-like prose, sales copy, and overusing overly polite phrases such as 「いたします」「させていただきます」「となります」. Keep sentences short, use concrete verbs, and make the next judgment/action clear for the reader.';
  const hardMaxChars = Math.round(params.targetWordCount * 1.2);
  const hardMinChars = Math.round(params.targetWordCount * 0.85);
  const prompt = [
    'Write a complete Japanese article in Markdown.',
    '',
    `Title: ${params.outline.title}`,
    `Main keyword: ${params.keyword}`,
    keywordLine ? `Related keywords: ${keywordLine}` : '',
    `Target length: ${params.targetWordCount} Japanese characters. Stay between ${hardMinChars} and ${hardMaxChars} characters. Stop writing once the article reaches ${hardMaxChars} characters — do NOT exceed this limit.`,
    toneInstruction,
    '',
    'Hard requirements:',
    '- Output only the article body. Do not include explanations, JSON, code fences, or notes.',
    '- Do not repeat the title as an H1.',
    '- Follow the outline structure exactly. Write every [H2] entry as "##" and every [H3] entry as "###". Do NOT skip any heading.',
    '- [H3] entries (indented in the outline) are sub-sections of the preceding [H2]. Always place them inside that H2 section.',
    '- Write 2 to 3 short lead paragraphs BEFORE the first "##" heading.',
    '- H2 sections: 1-2 paragraphs of body text (2-4 sentences each).',
    '- H3 sections: 1-2 paragraphs of body text (2-4 sentences each). Keep each H3 concise to stay within the character limit.',
    '- Prefer clear, short Japanese sentences. Split long sentences instead of stacking abstract nouns.',
    '- Explain technical terms briefly when they may be unfamiliar to a general reader.',
    '- Separate EVERY paragraph with a blank line (one empty line between paragraphs).',
    '- Separate headings from surrounding paragraphs with a blank line.',
    '- Avoid unfinished sentences and placeholder text.',
    '- Never output only headings or an outline. Every heading must be followed by body text before the next heading.',
    '',
    'Outline (indented entries = H3 sub-sections):',
    outlineText,
    '',
    params.customInstructions ? `Additional instructions:\n${params.customInstructions}` : '',
  ].filter(Boolean).join('\n');

  const maxTokens = Math.min(
    12000,
    Math.max(3000, Math.ceil(params.targetWordCount * 2.5))
  );

  let rawText: string;
  try {
    rawText = await callAI(prompt, params.aiConfig, maxTokens);
  } catch (firstError: any) {
    if (firstError?.partialText && typeof firstError.partialText === 'string') {
      // Gemini hit maxOutputTokens — retry with a higher limit before giving up
      const retryMaxTokens = Math.min(16000, maxTokens * 2);
      console.warn(`[singlepass] Gemini hit maxOutputTokens (${maxTokens}), retrying with ${retryMaxTokens}`);
      try {
        rawText = await callAI(prompt, params.aiConfig, retryMaxTokens);
      } catch (retryError: any) {
        // Both attempts hit the limit — use whichever partial text is longer
        const partial1 = typeof firstError.partialText === 'string' ? firstError.partialText : '';
        const partial2 = typeof retryError?.partialText === 'string' ? retryError.partialText : '';
        const bestPartial = countGeneratedChars(partial2) >= countGeneratedChars(partial1) ? partial2 : partial1;
        const minAcceptable = Math.max(400, Math.round(params.targetWordCount * 0.5));
        if (countGeneratedChars(bestPartial) >= minAcceptable) {
          console.warn(`[singlepass] Both attempts hit token limit; using partial text (${countGeneratedChars(bestPartial)} chars)`);
          rawText = bestPartial;
        } else {
          throw retryError;
        }
      }
    } else {
      throw firstError;
    }
  }

  let fullContent = formatArticleBodyForReadability(String(rawText || '').trim());
  if (!fullContent) {
    throw new Error('Single-pass article generation returned empty content');
  }
  try {
    validateGeneratedArticleCompleteness(fullContent, params.outline, params.targetWordCount);
  } catch (validationError) {
    const message = validationError instanceof Error ? validationError.message : String(validationError || '');
    const shouldRetry =
      message.includes('headings without body text') ||
      message.includes('missing headings') ||
      message.includes('too short');

    if (!shouldRetry) {
      throw validationError;
    }

    const retryPrompt = [
      prompt,
      '',
      'Retry instructions:',
      '- The previous output failed quality validation because one or more headings had no body text.',
      '- Do not return an outline. Write the finished article body.',
      '- After every "##" or "###" heading, write at least two complete Japanese sentences before the next heading.',
      '- If the length is tight, make each section shorter, but never leave a heading blank.',
    ].join('\n');
    const retryMaxTokens = Math.min(16000, Math.ceil(maxTokens * 1.5));
    console.warn(`[singlepass] Article validation failed; retrying with stricter body instructions: ${message}`);

    const retryText = await callAI(retryPrompt, params.aiConfig, retryMaxTokens);
    fullContent = formatArticleBodyForReadability(String(retryText || '').trim());
    if (!fullContent) {
      throw validationError;
    }
    validateGeneratedArticleCompleteness(fullContent, params.outline, params.targetWordCount);
  }

  return {
    sectionsWithContent: [],
    fullContent,
    wordCount: countGeneratedChars(fullContent),
  };
}
// Chatwork鬯ｨ・ｾ陞溘ｊ・｡蝓ｼ・ｨ・ｾ遶擾ｽｽ繝ｻ・ｿ繝ｻ・｡
async function sendChatworkNotifications(
  apiToken: string,
  roomIdsStr: string,
  template: string,
  title: string,
  url: string,
  keyword: string,
  status: string
): Promise<void> {
  const roomIds = roomIdsStr.split(',').map(id => id.trim()).filter(id => id);

  if (roomIds.length === 0) return;

  // 驛｢譎｢・ｽ・｡驛｢譏ｴ繝ｻ邵ｺ譎会ｽｹ譎｢・ｽ・ｼ驛｢・ｧ繝ｻ・ｸ驍ｵ・ｺ繝ｻ・ｮ髫ｶ蝣､霍昴・・ｯ郢晢ｽｻ
  let body = template;
  if (!body) {
    body = `予約投稿が完了しました。

タイトル:
{title}

キーワード:
{keyword}

投稿URL:
{url}

投稿状態:
{status}`;
  }

  // 髯樊ｺｽ蛻､霎溷､績繝ｻ・ｮ髫ｰ・ｰ郢晢ｽｻ
  body = body
    .replace(/{title}/g, title)
    .replace(/{url}/g, url)
    .replace(/{status}/g, status);

  const keywordValue = String(keyword || '').trim();
  const normalizedLines = body.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
  const filteredLines: string[] = [];

  for (const rawLine of normalizedLines) {
    const line = String(rawLine || '');

    if (!keywordValue && line.includes('{keyword}')) {
      continue;
    }

    const replaced = line.replace(/{keyword}/g, keywordValue);
    if (!keywordValue) {
      const trimmed = replaced.trim();
      if (/^(?:キーワード|Keyword)[:：]?\s*$/i.test(trimmed)) {
        continue;
      }
    }

    filteredLines.push(replaced);
  }

  body = filteredLines.join('\n').replace(/\n{3,}/g, '\n\n').trim();

  const errors = [];

  for (const roomId of roomIds) {
    try {
      const response = await fetch(`https://api.chatwork.com/v2/rooms/${roomId}/messages`, {
        method: 'POST',
        headers: {
          'X-ChatWorkToken': apiToken,
          'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8'
        },
        body: `body=${encodeURIComponent(body)}`
      });

      if (!response.ok) {
        const text = await response.text();
        throw new Error(`Status ${response.status}: ${text}`);
      }
      console.log(`Chatwork message sent to room ${roomId}`);
    } catch (error) {
      console.error(`Failed to send to Chatwork room ${roomId}:`, error);
      errors.push(error);
    }
  }
}

function isLikelyJwt(value: string): boolean {
  const token = String(value || '').trim();
  if (!token) return false;
  const parts = token.split('.');
  return parts.length === 3 && parts.every((part) => part.length > 0);
}

function trimForLog(text: string, maxLength: number): string {
  const normalized = String(text || '').replace(/\s+/g, ' ').trim();
  if (normalized.length <= maxLength) return normalized;
  return `${normalized.slice(0, maxLength)}...`;
}

function formatScheduleFailureReason(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error || '');
  const message = trimForLog(raw, 700) || 'Unknown error';
  const lower = message.toLowerCase();

  if (
    message.includes('H3') ||
    message.includes('見出し') ||
    message.includes('アウトライン') ||
    lower.includes('outline')
  ) {
    return `アウトラインまたは見出し生成で失敗しました: ${message}`;
  }

  return message;
}

function getFirstScheduleKeyword(schedule: Schedule): string {
  return String(schedule.keyword || '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)[0] || '';
}

function buildGenerationDebug(params: {
  outline?: ArticleOutline | null;
  title?: string;
  keyword?: string;
  targetWordCount?: number;
  generatedChars?: number;
  relatedKeywords?: string[];
  competitorHeadings?: string[];
  publishErrorMessage?: string | null;
}) {
  const sections = params.outline?.sections || [];
  const h2 = sections.filter((section) => section.level !== 3 && !section.isLead);
  const h3 = sections.filter((section) => section.level === 3);

  return {
    title: params.title || '',
    keyword: params.keyword || '',
    target_word_count: params.targetWordCount || null,
    generated_chars: params.generatedChars || 0,
    h2_count: h2.length,
    h3_count: h3.length,
    headings: sections.map((section) => ({
      level: section.isLead ? 'lead' : `h${section.level === 3 ? 3 : 2}`,
      title: section.title,
      estimated_word_count: section.estimatedWordCount,
    })),
    related_keywords: (params.relatedKeywords || []).slice(0, 12),
    competitor_headings_sample: (params.competitorHeadings || []).slice(0, 12),
    publish_error_message: params.publishErrorMessage || null,
  };
}

function isPublishFailureAlreadyRecorded(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error || '');
  return message.startsWith('WordPress publish failed:');
}

async function markStaleRunningExecutionsFailed(supabase: any): Promise<void> {
  const thresholdIso = new Date(Date.now() - STALE_RUNNING_EXECUTION_MINUTES * 60 * 1000).toISOString();
  const reason = `実行が${STALE_RUNNING_EXECUTION_MINUTES}分以上進まなかったため停止扱いにしました。AI応答待ち、Edge Functionのタイムアウト、または外部API停止の可能性があります。`;

  try {
    const { data, error } = await supabase
      .from('execution_history')
      .update({
        status: 'failed',
        error_message: reason,
      })
      .eq('status', 'running')
      .lt('executed_at', thresholdIso)
      .select('id');

    if (error) {
      console.warn('Failed to mark stale running executions:', error);
      return;
    }

    if (Array.isArray(data) && data.length > 0) {
      console.warn(`Marked ${data.length} stale running execution(s) as failed.`);
    }
  } catch (error) {
    console.warn('Unexpected error while marking stale running executions:', error);
  }
}

async function clearScheduleExecutionState(
  supabase: any,
  scheduleId: string
): Promise<{ locksDeleted: number; runningMarkedFailed: number }> {
  const reason = '実行ロックを手動解除したため、この実行を停止扱いにしました。';
  let locksDeleted = 0;
  let runningMarkedFailed = 0;

  try {
    const { data: lockRows, error: lockError } = await supabase
      .from('scheduler_execution_locks')
      .delete()
      .eq('schedule_id', scheduleId)
      .select('schedule_id');

    if (lockError) {
      console.warn(`Failed to delete scheduler execution locks for ${scheduleId}:`, lockError);
    } else {
      locksDeleted = Array.isArray(lockRows) ? lockRows.length : 0;
    }
  } catch (error) {
    console.warn(`Unexpected error deleting scheduler execution locks for ${scheduleId}:`, error);
  }

  try {
    const { data: runningRows, error: runningError } = await supabase
      .from('execution_history')
      .update({
        status: 'failed',
        error_message: reason,
      })
      .eq('schedule_id', scheduleId)
      .eq('status', 'running')
      .select('id');

    if (runningError) {
      console.warn(`Failed to mark running execution histories failed for ${scheduleId}:`, runningError);
    } else {
      runningMarkedFailed = Array.isArray(runningRows) ? runningRows.length : 0;
    }
  } catch (error) {
    console.warn(`Unexpected error marking running histories failed for ${scheduleId}:`, error);
  }

  console.log(`Cleared execution state for ${scheduleId}: locks=${locksDeleted}, running=${runningMarkedFailed}`);
  return { locksDeleted, runningMarkedFailed };
}

async function recordScheduleExecutionFailure(
  supabase: any,
  schedule: Schedule,
  wpConfig: WordPressConfig,
  aiConfig: AIConfig,
  error: unknown,
  triggerType: 'manual' | 'automatic' = 'automatic'
): Promise<void> {
  if (isPublishFailureAlreadyRecorded(error)) return;

  const reason = formatScheduleFailureReason(error);
  try {
    const failureHistoryPayload: Record<string, any> = {
      account_id: schedule.account_id || wpConfig.account_id || null,
      schedule_id: schedule.id,
      wordpress_config_id: wpConfig.id,
      executed_at: new Date().toISOString(),
      keyword_used: getFirstScheduleKeyword(schedule),
      article_title: '',
      wordpress_post_id: '',
      status: 'failed',
      error_message: reason,
      cost_breakdown: {
        trigger_type: triggerType,
        generation_debug: {
          failure_stage: 'generation_or_quality_check',
          provider: aiConfig.provider || '',
          model: aiConfig.model || '',
          target_word_count: schedule.target_word_count || null,
          writing_tone: schedule.writing_tone || '',
          reason,
        },
      },
      estimated_cost_usd: 0,
    };
    let runningHistoryId: string | null = null;
    let insertResult = await supabase
      .from('execution_history')
      .select('id')
      .eq('schedule_id', schedule.id)
      .eq('status', 'running')
      .order('executed_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (!insertResult.error && insertResult.data?.id) {
      runningHistoryId = insertResult.data.id;
      insertResult = await supabase
        .from('execution_history')
        .update(failureHistoryPayload)
        .eq('id', runningHistoryId);
    } else {
      insertResult = await supabase
        .from('execution_history')
        .insert(failureHistoryPayload);
    }

    if (isMissingColumnError(insertResult.error, 'account_id')) {
      console.warn('execution_history.account_id is missing. Retrying failed history save without account_id.');
      delete failureHistoryPayload.account_id;
      insertResult = runningHistoryId
        ? await supabase
          .from('execution_history')
          .update(failureHistoryPayload)
          .eq('id', runningHistoryId)
        : await supabase
          .from('execution_history')
          .insert(failureHistoryPayload);
    }

    const { error: insertError } = insertResult;

    if (insertError) {
      console.error('Failed to save failed execution history:', insertError);
    }
  } catch (historyError) {
    console.error('Failed to record scheduler failure:', historyError);
  }
}

async function recordForceExecutionSkippedByLock(
  supabase: any,
  schedule: Schedule,
  wpConfig: WordPressConfig
): Promise<void> {
  const reason = '前回の予約投稿実行ロックがまだ有効です。前の処理が実行中、または異常終了後のロック期間待ちです。数分後に再実行するか、ロックを解除してください。';
  const payload: Record<string, any> = {
    account_id: schedule.account_id || wpConfig.account_id || null,
    schedule_id: schedule.id,
    wordpress_config_id: wpConfig.id,
    executed_at: new Date().toISOString(),
    keyword_used: getFirstScheduleKeyword(schedule),
    article_title: '',
    wordpress_post_id: '',
    status: 'failed',
    error_message: reason,
    cost_breakdown: {
      trigger_type: 'manual',
      generation_debug: {
        failure_stage: 'execution_lock',
        current_stage: 'execution_lock',
        progress_message: reason,
        progress_percent: 0,
        reason,
      },
    },
    estimated_cost_usd: 0,
  };

  try {
    let result = await supabase
      .from('execution_history')
      .insert(payload);

    if (isMissingColumnError(result.error, 'account_id')) {
      delete payload.account_id;
      result = await supabase
        .from('execution_history')
        .insert(payload);
    }

    if (result.error) {
      console.error('Failed to save force execution lock skip history:', result.error);
    }
  } catch (error) {
    console.error('Failed to record force execution lock skip:', error);
  }
}

// 驛｢・ｧ繝ｻ・ｫ驛｢譏ｴ繝ｻ邵ｺ荵滂ｽｹ譎｢・ｽ・ｪ驛｢譎｢・ｽ・ｼID驛｢・ｧ陋幢ｽｵ邵ｺ蟶ｷ・ｹ譎｢・ｽ・ｩ驛｢譏ｴ繝ｻ邵ｺ蝣､・ｸ・ｺ繝ｻ・ｾ驍ｵ・ｺ雋・･繝ｻ髯ｷ・ｷ隶朱｡披・驍ｵ・ｺ闕ｵ譎｢・ｽ闃ｽ諢ｾ鬮｢ﾂ繝ｻ・ｾ郢晢ｽｻ
async function getCategoryIdBySlugOrName(
  config: WordPressConfig,
  categoryIdentifier: string
): Promise<number | null> {
  return getTermIdBySlugOrName(config, 'categories', categoryIdentifier);
}

async function getTaxonomyCandidatesForPostType(
  config: WordPressConfig,
  postType: string
): Promise<Array<{ field: string; restBase: string }>> {
  const candidates: Array<{ field: string; restBase: string }> = [];
  const addCandidate = (field: string, restBase: string) => {
    if (!field || !restBase) return;
    if (candidates.some((item) => item.field === field || item.restBase === restBase)) return;
    candidates.push({ field, restBase });
  };

  if (postType === 'posts') {
    addCandidate('categories', 'categories');
    return candidates;
  }

  const normalizedPostType = String(postType || '').trim();
  const auth = btoa(`${config.username}:${config.password}`);
  try {
    const optionsResponse = await fetch(
      `${config.url}/wp-json/wp/v2/${postType}`,
      {
        method: 'OPTIONS',
        headers: { 'Authorization': `Basic ${auth}` }
      }
    );
    if (optionsResponse.ok) {
      const schema = await optionsResponse.json();
      const properties = schema?.schema?.properties || schema?.endpoints?.[0]?.schema?.properties || {};
      const ignoredFields = new Set([
        'id', 'date', 'date_gmt', 'guid', 'modified', 'modified_gmt', 'slug', 'status',
        'type', 'link', 'title', 'content', 'excerpt', 'author', 'featured_media',
        'comment_status', 'ping_status', 'template', 'meta', 'permalink_template',
        'generated_slug', 'tags'
      ]);

      for (const [fieldName, definition] of Object.entries(properties)) {
        if (ignoredFields.has(fieldName)) continue;
        const item = definition as any;
        const itemType = item?.items?.type || item?.items?.[0]?.type;
        if (item?.type === 'array' && (itemType === 'integer' || itemType === 'number')) {
          addCandidate(fieldName, fieldName);
        }
      }
    }
  } catch (error) {
    console.warn(`Failed to inspect REST schema for post type "${postType}":`, error);
  }

  try {
    const response = await fetch(
      `${config.url}/wp-json/wp/v2/taxonomies?type=${encodeURIComponent(postType)}`,
      { headers: { 'Authorization': `Basic ${auth}` } }
    );
    if (!response.ok) return candidates;

    const taxonomies = await response.json();
    for (const [taxonomyName, taxonomy] of Object.entries(taxonomies || {})) {
      const item = taxonomy as any;
      if (item?.visibility?.show_in_rest === false) continue;
      if (item?.hierarchical === false) continue;
      const restBase = String(item?.rest_base || taxonomyName || '').trim();
      const field = restBase;
      addCandidate(field, restBase);
      addCandidate(String(taxonomyName), restBase);
    }
  } catch (error) {
    console.warn(`Failed to fetch taxonomies for post type "${postType}":`, error);
  }

  try {
    const response = await fetch(
      `${config.url}/wp-json/wp/v2/taxonomies`,
      { headers: { 'Authorization': `Basic ${auth}` } }
    );
    if (response.ok) {
      const taxonomies = await response.json();
      for (const [taxonomyName, taxonomy] of Object.entries(taxonomies || {})) {
        const item = taxonomy as any;
        if (item?.visibility?.show_in_rest === false) continue;
        if (item?.hierarchical === false) continue;
        const types = Array.isArray(item?.types) ? item.types.map(String) : [];
        if (!types.includes(postType)) continue;
        const restBase = String(item?.rest_base || taxonomyName || '').trim();
        addCandidate(restBase, restBase);
        addCandidate(String(taxonomyName), restBase);
      }
    }
  } catch (error) {
    console.warn(`Failed to match all taxonomies for post type "${postType}":`, error);
  }

  [
    `${normalizedPostType}_category`,
    `${normalizedPostType}_cat`,
    `${normalizedPostType}-category`,
    `${normalizedPostType}-cat`,
    `${normalizedPostType}_categories`,
    `${normalizedPostType}-categories`,
  ].forEach((candidate) => addCandidate(candidate, candidate));

  if (candidates.length === 0) {
    addCandidate('categories', 'categories');
  }
  console.log(`Taxonomy candidates for post type "${postType}":`, candidates);
  return candidates;
}

async function resolveTermAssignmentForPostType(
  config: WordPressConfig,
  postType: string,
  categoryIdentifier: string
): Promise<{ field: string; ids: number[] } | null> {
  const trimmed = String(categoryIdentifier || '').trim();
  if (!trimmed) return null;

  const candidates = await getTaxonomyCandidatesForPostType(config, postType);
  const explicitMatch = trimmed.match(/^([A-Za-z0-9_-]+)\s*[:：]\s*(.+)$/);
  if (explicitMatch) {
    const explicitField = explicitMatch[1].trim();
    const explicitTerm = explicitMatch[2].trim();
    const explicitId = await getTermIdBySlugOrName(config, explicitField, explicitTerm);
    if (explicitId) {
      return { field: explicitField, ids: [explicitId] };
    }
    console.warn(`Explicit taxonomy "${explicitField}" did not contain term "${explicitTerm}"`);
  }

  const parsed = parseInt(trimmed, 10);
  if (!isNaN(parsed)) {
    return { field: candidates[0]?.field || 'categories', ids: [parsed] };
  }

  for (const candidate of candidates) {
    const termId = await getTermIdBySlugOrName(config, candidate.restBase, trimmed);
    if (termId) {
      return { field: candidate.field, ids: [termId] };
    }
  }

  return null;
}

async function notifyScheduleExecutionFailure(
  schedule: Schedule,
  wpConfig: WordPressConfig,
  chatworkApiToken: string | null,
  error: unknown
): Promise<void> {
  const roomIds = String(schedule.fact_check_alert_chatwork_room_id || schedule.chatwork_room_id || '').trim();
  if (!chatworkApiToken || !roomIds) return;

  const reason = formatScheduleFailureReason(error);
  const keyword = getFirstScheduleKeyword(schedule);
  const template = `[info][title]予約投稿の実行に失敗しました[/title]
スケジュールID: ${schedule.id}
サイト: ${wpConfig.name}
URL: ${wpConfig.url}
キーワード: {keyword}
状態: 失敗

理由:
${reason}

記事生成または品質チェックの段階で停止しました。WordPressへの投稿前に止まっているため、AI生成内容、見出し構成、文字数制限、または品質チェック条件を確認してください。[/info]`;

  try {
    await sendChatworkNotifications(
      chatworkApiToken,
      roomIds,
      template,
      '予約投稿の実行に失敗しました',
      wpConfig.url,
      keyword,
      '失敗'
    );
  } catch (notifyError) {
    console.error('Schedule failure notification failed:', notifyError);
  }
}

function summarizeFactCheckContentChanges(
  beforeContent: string,
  afterContent: string,
  maxItems = 5
): string[] {
  const beforeLines = String(beforeContent || '').replace(/\r\n/g, '\n').split('\n');
  const afterLines = String(afterContent || '').replace(/\r\n/g, '\n').split('\n');
  const maxLines = Math.max(beforeLines.length, afterLines.length);
  const summaries: string[] = [];

  for (let i = 0; i < maxLines && summaries.length < maxItems; i += 1) {
    const beforeRaw = beforeLines[i] ?? '';
    const afterRaw = afterLines[i] ?? '';
    const beforeLine = trimForLog(beforeRaw, 120);
    const afterLine = trimForLog(afterRaw, 120);
    if (beforeLine === afterLine) continue;

    summaries.push(
      `${summaries.length + 1}. L${i + 1}\n` +
      `修正前: ${beforeLine || '(空行)'}\n` +
      `修正後: ${afterLine || '(空行)'}`
    );
  }

  return summaries;
}

type KeyCandidate = { label: 'anon' | 'service'; value: string };
type AuthAttempt = { name: string; headers: Record<string, string> };

function buildCompetitorSearchAuthAttempts(anonKeyRaw: string | null, serviceRoleKeyRaw: string | null): AuthAttempt[] {
  const candidates: KeyCandidate[] = [
    { label: 'anon', value: String(anonKeyRaw || '').trim() },
    { label: 'service', value: String(serviceRoleKeyRaw || '').trim() },
  ].filter((candidate) => candidate.value.length > 0);

  const apiCandidates = [
    candidates.find((candidate) => candidate.label === 'service'),
    candidates.find((candidate) => candidate.label === 'anon'),
  ].filter(Boolean) as KeyCandidate[];

  const jwtCandidates = candidates.filter((candidate) => isLikelyJwt(candidate.value));
  const nonJwtCandidates = candidates.filter((candidate) => !isLikelyJwt(candidate.value));
  const authCandidates = [...jwtCandidates, ...nonJwtCandidates];

  const attempts: AuthAttempt[] = [];
  const seen = new Set<string>();

  const pushAttempt = (name: string, headers: Record<string, string>) => {
    const fingerprint = `${name}:${Object.keys(headers).sort().join('|')}:${headers.apikey?.length ?? 0}:${headers.Authorization ? 1 : 0}`;
    if (seen.has(fingerprint)) return;
    seen.add(fingerprint);
    attempts.push({ name, headers });
  };

  for (const apiCandidate of apiCandidates) {
    for (const authCandidate of authCandidates) {
      pushAttempt(
        `auth-${authCandidate.label}-apikey-${apiCandidate.label}`,
        {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${authCandidate.value}`,
          'apikey': apiCandidate.value,
        }
      );
    }

    for (const authCandidate of authCandidates) {
      pushAttempt(
        `auth-only-${authCandidate.label}`,
        {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${authCandidate.value}`,
        }
      );
    }

    pushAttempt(
      `apikey-only-${apiCandidate.label}`,
      {
        'Content-Type': 'application/json',
        'apikey': apiCandidate.value,
      }
    );
  }

  if (attempts.length === 0) {
    attempts.push({
      name: 'no-auth-header',
      headers: { 'Content-Type': 'application/json' },
    });
  }

  return attempts;
}

async function conductCompetitorResearchViaEdgeFunction(
  keyword: string,
  serpApiKey: string,
  limit: number = 5
) {
  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY');
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

  if (!supabaseUrl) {
    throw new Error('SUPABASE_URL is missing');
  }

  if (!anonKey && !serviceRoleKey) {
    throw new Error('SUPABASE_ANON_KEY or SUPABASE_SERVICE_ROLE_KEY is missing');
  }

  const endpoint = `${supabaseUrl}/functions/v1/competitor-search`;
  const body = JSON.stringify({ keyword, limit, serpApiKey });
  const attempts = buildCompetitorSearchAuthAttempts(anonKey, serviceRoleKey);
  const errors: string[] = [];

  for (const attempt of attempts) {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: attempt.headers,
      body,
    });

    if (response.ok) {
      const data = await response.json();
      return {
        articles: Array.isArray(data?.topArticles) ? data.topArticles : [],
        averageLength: Number.isFinite(Number(data?.averageLength)) ? Number(data.averageLength) : 0,
        commonTopics: Array.isArray(data?.commonTopics) ? data.commonTopics : [],
      };
    }

    const text = await response.text();
    const reason = `${attempt.name} -> ${response.status} ${trimForLog(text, 220)}`;
    errors.push(reason);

    // For deterministic request errors, fail fast.
    if (response.status >= 400 && response.status < 500 && response.status !== 401 && response.status !== 403) {
      throw new Error(`competitor-search error: ${reason}`);
    }
  }

  throw new Error(
    `competitor-search auth failed after ${attempts.length} attempts. ` +
    `Details: ${errors.join(' | ')}. ` +
    `If this persists, deploy competitor-search with verify_jwt disabled.`
  );
}

async function conductCompetitorResearchWithFallback(
  keyword: string,
  serpApiKey: string,
  limit: number = 5
) {
  try {
    const deepResult = await conductCompetitorResearchViaEdgeFunction(keyword, serpApiKey, limit);
    if (deepResult.articles.length > 0) {
      console.log(`Deep competitor research completed via competitor-search (${deepResult.articles.length} articles)`);
      return deepResult;
    }
    console.warn('competitor-search returned no articles. Falling back to inline scraper.');
  } catch (error) {
    console.warn('competitor-search failed. Falling back to inline scraper:', error);
  }

  return await conductCompetitorResearch(keyword, serpApiKey, limit);
}

// 鬩包ｽｶ繝ｻ・ｶ髯ｷ・ｷ鬩帙・・ｽ・ｪ繝ｻ・ｿ髫ｴ貊ゑｽｽ・ｻ驛｢譎渉・･・取刮・ｹ譏懶ｽｻ・｣郢晢ｽｻ鬯ｮ・｢繝ｻ・｢髫ｰ・ｨ繝ｻ・ｰ郢晢ｽｻ郢晢ｽｻerpAPI鬩搾ｽｨ隶吝ｮ茨ｽｽ・ｰ郢晢ｽｻ郢晢ｽｻ
async function conductCompetitorResearch(keyword: string, serpApiKey: string, limit: number = 5) {
  const searchUrl = `https://serpapi.com/search.json?engine=google&q=${encodeURIComponent(keyword)}&api_key=${serpApiKey}&gl=jp&hl=ja&num=${limit}`;

  const searchRes = await fetch(searchUrl);
  if (!searchRes.ok) {
    throw new Error(`SerpAPI error: ${searchRes.status}`);
  }

  const searchData = await searchRes.json();
  const results = searchData.organic_results || [];

  const articles = [];

  for (const item of results.slice(0, limit)) {
    const url = item.link;
    console.log(`Scraping: ${url}`);

    try {
      const controller = new AbortController();
      const id = setTimeout(() => controller.abort(), 8000);

      const res = await fetch(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
        },
        signal: controller.signal
      });
      clearTimeout(id);

      if (!res.ok) throw new Error(`Fetch failed: ${res.status}`);

      const html = await res.text();

      // 鬩阪・・ｽ・｡髫ｴ蝓手ｱｪ陜趣ｽｪ驍ｵ・ｺ繝ｻ・ｪ鬮ｫ蜍溷罰郢晢ｽｻ驍ｵ・ｺ驍・ｽｲ雎∵･｢諤弱・・ｺ郢晢ｽｻ陜捺ｻゑｽｽ・ｭ繝ｻ・｣鬮ｫ蜍溯㊥繝ｻ・｡繝ｻ・ｨ髴托ｽｴ繝ｻ・ｾ驛｢譎冗函郢晢ｽｻ驛｢・ｧ繝ｻ・ｹ郢晢ｽｻ郢晢ｽｻ
      const h2Matches = html.match(/<h2[^>]*>([^<]+)<\/h2>/gi) || [];
      const h3Matches = html.match(/<h3[^>]*>([^<]+)<\/h3>/gi) || [];

      const headings = [...h2Matches, ...h3Matches]
        .map(h => h.replace(/<\/?[^>]+(>|$)/g, '').trim())
        .filter(h => h.length > 2 && h.length < 100)
        .slice(0, 10);

      articles.push({
        title: item.title,
        url: url,
        domain: new URL(url).hostname,
        headings: headings.length > 0 ? headings : [item.title],
        metaDescription: item.snippet || ''
      });
    } catch (err: any) {
      console.error(`Scraping failed for ${url}:`, err.message);
      articles.push({
        title: item.title,
        url: url,
        domain: new URL(url).hostname,
        headings: [item.title],
        metaDescription: item.snippet || ''
      });
    }
  }

  return {
    articles,
    averageLength: 2500,
    commonTopics: []
  };
}
