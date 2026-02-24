import { createClient } from 'npm:@supabase/supabase-js@2';
import { DEFAULT_TARGET_WORD_COUNT } from '../../../src/shared/generationPolicy.ts';
import {
  countGeneratedChars,
  generateArticleFromOutlineWithSharedCore,
  generateOutlineWithAutoModeStyle,
} from '../../../src/shared/articleGenerationCore.ts';
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

const parseNumber = (value: unknown, fallback: number): number => {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
};

interface WordPressConfig {
  id: string;
  name: string;
  url: string;
  username: string;
  password: string; // This maps to 'applicationPassword' in the DB column 'password'
  category: string;
  post_type: string; // Custom post type slug (e.g., 'posts', 'sushirecipe', 'product')
  is_active: boolean;
}

interface Schedule {
  id: string;
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
  image_generation_enabled?: boolean;
  images_per_article?: number;
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
  provider: string;
  api_key: string;
  model: string;
  temperature: number;
  max_tokens: number;
  is_active?: boolean;
  image_enabled?: boolean;
  images_per_article?: number;
}

type WritingTone = 'professional' | 'casual' | 'technical' | 'friendly';

const INVALID_GEMINI_MODELS = new Set([
  'gemini-1.0-pro',
  'gemini-1.5-pro-latest',
  'gemini-3.0-pro',
  'gemini-3.0-flash',
]);

function normalizeAiConfig(config: AIConfig): AIConfig {
  const provider = String(config.provider || '').toLowerCase();
  if (provider !== 'gemini') return config;
  if (!INVALID_GEMINI_MODELS.has(String(config.model || ''))) return config;
  return { ...config, model: 'gemini-2.5-flash' };
}

function resolveWritingTone(value: unknown): WritingTone {
  const normalized = String(value || '').trim().toLowerCase();
  if (
    normalized === 'professional' ||
    normalized === 'casual' ||
    normalized === 'technical' ||
    normalized === 'friendly'
  ) {
    return normalized;
  }
  if (normalized === 'desu_masu') return 'friendly';
  if (normalized === 'da_dearu') return 'professional';
  return 'professional';
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

    // 蜃ｦ逅・Ο繧ｸ繝・け繧帝撼蜷梧悄髢｢謨ｰ縺ｨ縺励※螳夂ｾｩ・医ヰ繝・け繧ｰ繝ｩ繧ｦ繝ｳ繝牙ｮ溯｡檎畑・・
    const processSchedules = async () => {
      const schedulerStartTime = Date.now();
      console.log('Scheduler execution started:', new Date(schedulerStartTime).toISOString());
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

      // 1. 繧｢繧ｯ繝・ぅ繝悶↑AI險ｭ螳壹ｒ蜿門ｾ・
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

      // 1.5 蜷・ｨｮAPI繝医・繧ｯ繝ｳ繝ｻ繧ｭ繝ｼ縺ｮ蜿門ｾ・
      let chatworkApiToken: string | null = null;
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

      // 2. 繧ｹ繧ｱ繧ｸ繝･繝ｼ繝ｫ蜿門ｾ・
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

      // 3. 蜷・せ繧ｱ繧ｸ繝･繝ｼ繝ｫ蜃ｦ逅・
      const executedWpConfigIds = new Set<string>();
      for (const schedule of schedules) {
        stats.considered += 1;
        const scheduleSetting: Schedule = schedule as any;
        const wpConfig: WordPressConfig = (schedule as any).wordpress_configs;
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

          console.log(`Executing schedule for ${wpConfig.name}`);

          // Prefer schedule-specific AI config. Fall back to the active config.
          const requestedAiConfigId = scheduleSetting.ai_config_id;
          const requestedAiConfig = requestedAiConfigId ? aiConfigMap.get(requestedAiConfigId) : null;
          const baseAiConfig = requestedAiConfig || activeAiConfig;
          const overrideProvider = String(scheduleSetting.ai_provider_override || '').trim().toLowerCase();
          const overrideModel = String(scheduleSetting.ai_model_override || '').trim();
          let effectiveAiConfig = baseAiConfig;

          if (requestedAiConfig) {
            console.log(
              `Using schedule AI config: ${baseAiConfig.provider} (${baseAiConfig.model}) [${baseAiConfig.id}]`
            );
          } else if (requestedAiConfigId) {
            console.warn(
              `Schedule AI config not found (${requestedAiConfigId}). Falling back to active config ${activeAiConfig.id}`
            );
          } else {
            console.log(`No schedule AI config specified. Using active config ${activeAiConfig.id}`);
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

          try {
            await executeSchedule(
              scheduleSetting,
              wpConfig,
              effectiveAiConfig,
              supabase,
              chatworkApiToken,
              serpApiKey,
              googleApiKey,
              searchEngineId,
              imageCostUsdPerImage,
              schedulerStartTime
            );
            stats.executed += 1;
            executedWpConfigIds.add(wpConfig.id);
          } catch (error: any) {
            console.error(`Failed to execute schedule for ${wpConfig.name}:`, error);
            stats.failed += 1;
          }
        } else {
          stats.skipped += 1;
        }
      }

      return stats;
    };

    // 4. Background Execution Logic using EdgeRuntime.waitUntil
    // This allows returning a response immediately while processing continues in the background.
    // Critical for preventing 504 Gateway Timeouts on long-running tasks.
    const processPromise = processSchedules().catch((err) => {
      console.error('Background processing error:', err);
    });

    if (forceExecute) {
      console.log('Starting background execution for Force Run');
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
      // For cron triggers, we can just await it (platform handles timeout differently)
      // OR use waitUntil as well to be safe. Let's use await for cron to get logs in the same invocation if possible,
      // but consistent behavior is better. Let's use waitUntil for everything to be safe.
      // @ts-ignore
      EdgeRuntime.waitUntil(processPromise);

      return new Response(
        JSON.stringify({
          success: true,
          mode: 'background',
          message: 'Scheduled processing started in background.',
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

// 螳溯｡後☆縺ｹ縺阪°繝√ぉ繝・け
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

  // 螳溯｡檎峩蜑搾ｼ域掠縺吶℃繧句ｮ溯｡鯉ｼ峨ｒ髦ｲ豁｢縺励√°縺､險ｭ螳壽凾蛻ｻ縺九ｉ5蛻・ｻ･蜀・・遽・峇縺ｧ螳溯｡後ｒ險ｱ蜿ｯ縺吶ｋ
  const diff = currentMinutes - scheduleMinutes;

  if (diff < 0 || diff > 5) {
    return false;
  }

  const { data: lastExecution } = await supabase
    .from('execution_history')
    .select('executed_at')
    .eq('schedule_id', scheduleId)
    .order('executed_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!lastExecution) {
    return true;
  }

  const lastExecutedAt = new Date(lastExecution.executed_at);
  const now = new Date();
  const hoursSinceLastExecution = (now.getTime() - lastExecutedAt.getTime()) / (1000 * 60 * 60);

  // 譌･譛ｬ隱槭・鬆ｻ蠎ｦ繧定恭隱槭↓螟画鋤
  const freqMap: Record<string, string> = {
    '毎日': 'daily',
    '毎週': 'weekly',
    '隔週': 'biweekly',
    '毎月': 'monthly',
  };
  const normalizedFreq = freqMap[frequency] || frequency;

  // JST縺ｧ縺ｮ譌･莉俶ｯ碑ｼ・畑
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

async function wasExecutedWithinMinutes(
  scheduleId: string,
  supabase: any,
  minutes: number
): Promise<boolean> {
  const { data: lastExecution } = await supabase
    .from('execution_history')
    .select('executed_at')
    .eq('schedule_id', scheduleId)
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
    if (m.includes('gpt-5') && m.includes('mini')) return { input: 0.30, output: 2.50 };
    if (m.includes('gpt-5')) return { input: 1.25, output: 10.00 };
    if (m.includes('gpt-4o-mini')) return { input: 0.15, output: 0.60 };
    if (m.includes('gpt-4o')) return { input: 5.00, output: 15.00 };
    return { input: 0.30, output: 2.50 };
  }
  if (p === 'gemini') {
    if (m.includes('2.5-pro')) return { input: 1.25, output: 10.00 };
    if (m.includes('2.5-flash')) return { input: 0.30, output: 2.50 };
    return { input: 0.30, output: 2.50 };
  }
  if (p === 'claude') {
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
  const provider = String(aiConfig.provider || '').toLowerCase();
  const model = aiConfig.model;
  const apiKey = aiConfig.api_key;
  const temperature = aiConfig.temperature ?? 0.7;
  const resolvedMaxTokens = maxTokens ?? aiConfig.max_tokens ?? 2000;

  if (!apiKey) {
    throw new Error(`Missing API key for provider: ${provider}`);
  }

  if (provider === 'openai') {
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model,
        messages: [{ role: 'user', content: prompt }],
        temperature,
        max_tokens: resolvedMaxTokens,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`OpenAI API error: ${response.status} - ${errorText}`);
    }

    const data = await response.json();
    const content = data?.choices?.[0]?.message?.content;
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
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model,
        max_tokens: resolvedMaxTokens,
        temperature,
        messages: [{ role: 'user', content: prompt }],
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Claude API error: ${response.status} - ${errorText}`);
    }

    const data = await response.json();
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
    const response = await fetch(
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
    const parts = data?.candidates?.[0]?.content?.parts;
    const text = Array.isArray(parts)
      ? parts
        .map((part: any) => (typeof part?.text === 'string' ? part.text : ''))
        .join('\n')
        .trim()
      : '';
    if (!text) throw new Error('Gemini API returned empty content');
    return text;
  }

  throw new Error(`Unsupported AI provider: ${aiConfig.provider}`);
}

// === 改修2: 関連キーワード抽出ヘルパー ===

// 競合データから関連キーワードを抽出
function extractRelatedKeywordsFromCompetitorData(
  competitorData: any,
  mainKeyword: string,
  limit: number = 5
): string[] {
  if (!competitorData?.articles || competitorData.articles.length === 0) return [];

  const wordFrequency = new Map<string, number>();
  const mainKeywordLower = mainKeyword.toLowerCase();

  for (const article of competitorData.articles) {
    // 見出しからキーワードを抽出
    const headings: string[] = article.headings || [];
    for (const heading of headings) {
      // 見出しを単語に分割して頻度カウント
      const words = heading
        .replace(/[【】「」『』（）()\[\]]/g, ' ')
        .split(/[\s　,、・]+/)
        .map((w: string) => w.trim())
        .filter((w: string) => w.length >= 2 && w.length <= 20);

      for (const word of words) {
        if (word.toLowerCase() === mainKeywordLower) continue;
        wordFrequency.set(word, (wordFrequency.get(word) || 0) + 1);
      }
    }

    // metaDescriptionからもキーワードを抽出
    if (article.metaDescription) {
      const descWords = article.metaDescription
        .replace(/[【】「」『』（）()\[\]。、！？]/g, ' ')
        .split(/[\s　,]+/)
        .map((w: string) => w.trim())
        .filter((w: string) => w.length >= 2 && w.length <= 15);

      for (const word of descWords) {
        if (word.toLowerCase() === mainKeywordLower) continue;
        wordFrequency.set(word, (wordFrequency.get(word) || 0) + 1);
      }
    }
  }

  // 出現頻度でソートし、上位を返す
  return Array.from(wordFrequency.entries())
    .filter(([, count]) => count >= 2) // 2回以上出現したもののみ
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

// Google Custom Search APIで関連キーワードを取得
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
      // タイトルとスニペットからキーワードを抽出
      const text = `${item.title || ''} ${item.snippet || ''}`;
      const words = text
        .replace(/[【】「」『』（）()\[\]。、！？…]/g, ' ')
        .split(/[\s　,]+/)
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

// === 改修4: AIタイトル生成ヘルパー（自動生成モード準拠） ===

async function generateTitleWithAI(
  keyword: string,
  relatedKeywords: string[],
  competitorTitles: string[],
  aiConfig: AIConfig,
  competitorData?: any
): Promise<string> {
  const TITLE_MIN_LENGTH = 24;
  const TITLE_MAX_LENGTH = 68;
  const TITLE_RETRY_COUNT = 4;

  const normalizeTitle = (raw: string): string => {
    let cleaned = String(raw || '').trim()
      .replace(/^タイトル[:：]\s*/i, '')
      .replace(/^["']|["']$/g, '');

    // Remove leading/trailing brackets ONLY if they wrap the entire string
    if (/^[「『【].*[」』】]$/.test(cleaned)) {
      cleaned = cleaned.replace(/^[「『【]|([」』】])$/g, '');
    }

    // Fix unbalanced brackets at start (common AI artifact: "2026】" -> "2026")
    cleaned = cleaned.replace(/^[^【]*】/, '');

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

  const isGenericTitleOnly = (title: string, currentYear: number): boolean => {
    const normalized = title.replace(/\s+/g, '');
    const genericPattern = new RegExp(`^(?:${currentYear}年)?(?:最新版|最新|まとめ|完全版)$`);
    return genericPattern.test(normalized);
  };

  const isValidSeoTitle = (title: string, baseKeyword: string, currentYear: number): boolean => {
    if (!title) return false;
    if (title.length < TITLE_MIN_LENGTH || title.length > TITLE_MAX_LENGTH) return false;
    if (!includesKeyword(title, baseKeyword)) return false;
    if (isGenericTitleOnly(title, currentYear)) return false;
    if (/完全ガイド[｜|]\s*失敗しない選び方と費用比較/.test(title)) return false;
    const hasFreshness = new RegExp(`${currentYear}年|最新版|最新`).test(title);
    const hasReaderValue = /(選び方|比較|ポイント|費用|効果|注意点|評判|おすすめ|解説|ガイド|始め方)/.test(title);
    if (!hasFreshness && !hasReaderValue) return false;
    return true;
  };

  const buildFallbackTitle = (baseKeyword: string, currentYear: number): string => {
    const compactKeyword = baseKeyword.replace(/\s+/g, ' ').trim();
    const candidates = [
      `${currentYear}年版 ${compactKeyword}の選び方｜後悔しない比較ポイント`,
      `${currentYear}年最新 ${compactKeyword}を選ぶコツと注意点`,
      `${compactKeyword}で迷わないための基礎知識と比較の視点（${currentYear}年版）`,
      `${currentYear}年 ${compactKeyword}の評判と費用を整理する`,
      `${compactKeyword}の比較ポイントを解説｜自分に合う選び方`,
      `${currentYear}年版 ${compactKeyword}を始める前に知るべきこと`,
    ];
    const valid = candidates.filter((c) => c.length >= TITLE_MIN_LENGTH && c.length <= TITLE_MAX_LENGTH);
    if (valid.length > 0) {
      const randomIndex = Math.floor(Math.random() * valid.length);
      return valid[randomIndex];
    }
    return `${currentYear}年版 ${compactKeyword}の選び方`;
  };

  const relatedKwText = relatedKeywords.length > 0
    ? `\n\n【関連キーワード/トピック（SEO強化）】\n${relatedKeywords.slice(0, 8).join('、')}`
    : '';

  // 競合タイトル＋見出し情報を含める（自動生成モードと同等）
  let competitorText = '';
  if (competitorData?.articles && competitorData.articles.length > 0) {
    const articles = competitorData.articles.slice(0, 5);
    competitorText = `\n\n【競合他社のタイトルと構成】\n${articles.map((a: any) => {
      const headings = (a.headings || []).slice(0, 5).join(', ');
      return `- タイトル: ${a.title}${headings ? `\n  (主な見出し: ${headings})` : ''}`;
    }).join('\n')}`;
  } else if (competitorTitles.length > 0) {
    competitorText = `\n\n【競合他社のタイトル】\n${competitorTitles.slice(0, 5).map((t, i) => `${i + 1}. ${t}`).join('\n')}`;
  }

  const currentYear = new Date().getFullYear();
  const prompt = `
以下のキーワードと競合他社のタイトルを参考に、SEO的に強力で思わずクリックしたくなる魅力的なブログ記事のタイトルを1つだけ生成してください。

【メインキーワード】
${keyword}${relatedKwText}${competitorText}

【重要指示】
- タイトルのみ出力してください（他のテキスト、説明、記号は不要）
- 28〜52文字程度が理想（多少の前後は許容）
- メインキーワードを自然に含める
- 読者の悩みやニーズに刺さるキャッチーな表現にする
- 「${currentYear}年」「最新」は必要な場合のみ自然に使う（毎回必須ではない）
- 競合他社と差別化し、独自性や優位性が感じられるようにする
- 「〇〇とは？」「〇〇は？」のような疑問形だけのタイトルは禁止
- 「完全ガイド｜失敗しない選び方と費用比較」のような定型語尾は避ける
- 関連キーワードは自然な範囲で使う（無理に詰め込まない）

タイトル:
`.trim();

  for (let attempt = 1; attempt <= TITLE_RETRY_COUNT; attempt++) {
    try {
      const result = await callAI(prompt, aiConfig, 280);
      const title = normalizeTitle(result);
      if (isValidSeoTitle(title, keyword, currentYear)) {
        return title;
      }
      console.warn(`AI title rejected (attempt ${attempt}/${TITLE_RETRY_COUNT}): ${title}`);
    } catch (err) {
      console.warn(`AI title generation failed (attempt ${attempt}/${TITLE_RETRY_COUNT}):`, err);
    }
  }

  const fallbackTitle = buildFallbackTitle(keyword, currentYear);
  console.warn(`Using fallback title: ${fallbackTitle}`);
  return fallbackTitle;
}

// スケジュール実行（マルチステップ生成版）
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
  schedulerStartTime: number
) {
  // 1. 逕滓・繝｢繝ｼ繝峨↓蝓ｺ縺･縺・※繧ｿ繝ｼ繧ｲ繝・ヨ・医く繝ｼ繝ｯ繝ｼ繝峨∪縺溘・繧ｿ繧､繝医Ν・峨ｒ豎ｺ螳・
  let keyword = '';
  let fixedTitle: string | null = null;
  const mode = schedule.generation_mode || 'keyword';
  console.log(`Generation Mode: ${mode}`);

  if (mode === 'title' && schedule.title_set_id) {
    // 繧ｿ繧､繝医Ν繧ｻ繝・ヨ縺九ｉ繧ｿ繧､繝医Ν繧貞叙蠕・
    const { data: titleSet } = await supabase
      .from('title_sets')
      .select('titles')
      .eq('id', schedule.title_set_id)
      .maybeSingle();

    if (titleSet && titleSet.titles && titleSet.titles.length > 0) {
      const selectedTitle = await selectUnusedTitle(schedule.id, titleSet.titles, supabase);
      if (selectedTitle) {
        fixedTitle = selectedTitle;
        keyword = selectedTitle; // 繧ｿ繧､繝医Ν繧偵Γ繧､繝ｳ繧ｭ繝ｼ繝ｯ繝ｼ繝峨→縺励※謇ｱ縺・
        console.log(`Title selected: ${fixedTitle}`);
      } else {
        throw new Error('使用可能なタイトルがありません（すべて使用済み）');
      }
    } else {
      throw new Error('有効なタイトルセットが見つかりません');
    }
  } else if (mode === 'both') {
    // 両方モード: ランダムではなく決定的にタイトル優先、なければキーワードを使用。
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

  // 繧ｭ繝ｼ繝ｯ繝ｼ繝峨Δ繝ｼ繝峨√∪縺溘・繧ｿ繧､繝医Ν驕ｸ謚槭↓螟ｱ謨・繧ｹ繧ｭ繝・・縺励◆蝣ｴ蜷医・繝輔か繝ｼ繝ｫ繝舌ャ繧ｯ
  if (!keyword) {
    const allKeywords = (schedule.keyword || '').split(',').map((k: string) => k.trim()).filter((k: string) => k);
    const selectedKeyword = await selectUnusedKeyword(schedule.id, allKeywords, supabase);

    if (!selectedKeyword) {
      throw new Error('使用可能なキーワードがありません');
    }
    keyword = selectedKeyword;
    console.log(`Keyword selected: ${keyword}`);
  }

  // 1.5 繝励Ο繝ｳ繝励ヨ繧ｻ繝・ヨ縺ｮ蜿門ｾ暦ｼ医≠繧後・・・
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

  // 2. 遶ｶ蜷郁ｪｿ譟ｻ縺ｮ螳溯｡鯉ｼ・uto Mode縺ｨ蜷後§繝ｭ繧ｸ繝・け・・
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

  // === 改修2: トレンド分析（関連キーワード取得） ===
  console.log(`Enriching keywords for: ${keyword}`);
  const targetWordCount = schedule.target_word_count || DEFAULT_TARGET_WORD_COUNT;
  const writingTone = resolveWritingTone(schedule.writing_tone);
  const keywordArray = (schedule.keyword || '').split(',').map((k: string) => k.trim()).filter((k: string) => k);

  // 関連キーワードを競合データ + Google Custom Search から収集
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

  // === 改修4: AIタイトル生成 ===
  if (!fixedTitle) {
    const competitorTitles = (competitorData?.articles || []).map((a: any) => a.title).filter(Boolean);
    const generatedTitle = await generateTitleWithAI(keyword, relatedKeywords, competitorTitles, aiConfig, competitorData);
    fixedTitle = generatedTitle;
    console.log(`AI-generated title: ${fixedTitle}`);
  }

  console.log(`Generating outline for: ${keyword}`);
  const runGeneration = async () => {
    console.log('Generating outline with AI generator style...');
    const instructionParts: string[] = [];
    const customInstructionText = customInstructions.trim();
    if (customInstructionText) instructionParts.push(customInstructionText);
    if (relatedKeywords.length > 0) {
      instructionParts.push(`関連キーワード候補: ${relatedKeywords.slice(0, 8).join('、')}`);
    }
    const effectiveCustomInstructions = instructionParts.join('\n\n').trim() || undefined;

    const outline = await generateOutlineWithAutoModeStyle({
      keyword,
      targetWordCount,
      fixedTitle,
      customInstructions: effectiveCustomInstructions,
      competitorHeadings,
      callAI: (prompt, maxTokens) => callAI(prompt, aiConfig, maxTokens)
    });

    const generationResult = await generateArticleFromOutlineWithSharedCore({
      outline,
      keywords: sectionKeywords,
      tone: writingTone,
      targetWordCount,
      customInstructions: effectiveCustomInstructions,
      defaultMaxTokens: aiConfig.max_tokens || 2000,
      qualityRetryCount: 2,
      callAI: (prompt, maxTokens) => callAI(prompt, aiConfig, maxTokens)
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

  // === プログラム的クリーンアップ（確実に実行） ===
  function cleanupContentArtifacts(content: string, articleTitle: string): string {
    let text = String(content || '');

    // 1. 見出しからコロンを除去（半角・全角両方）
    // 末尾だけでなく、文中にある場合もスペースに置換（例: "AGA：特徴" -> "AGA 特徴"）
    text = text.replace(/^(#{1,6}\s+.+?)[：:](.+)$/gm, '$1 $2').replace(/^(#{1,6}\s+.+?)[：:]\s*$/gm, '$1');

    // 1.5 見出しの番号を除去（例: "## 1. 導入" -> "## 導入"）
    text = text.replace(/^(#{1,6}\s+)\d+[\.．]\s*(.+)$/gm, '$1$2');

    // 2. 本文冒頭にタイトルが含まれていたら除去 (強化版)
    const lines = text.split('\n');
    const firstNonEmpty = lines.findIndex(l => l.trim().length > 0);
    if (firstNonEmpty !== -1) {
      const firstLine = lines[firstNonEmpty].trim();
      const normalize = (s: string) => s.replace(/[^\w\u3040-\u30ff\u3400-\u9fff\u4e00-\u9faf]/g, '').toLowerCase(); // 記号除去

      const normalizedFirst = normalize(firstLine);
      const normalizedTitle = normalize(articleTitle);

      // タイトルそのもの、またはタイトル＋要約などのパターンを除去
      // "20代のAGA" vs "20代AGA" -> normalization removes symbols but not particles.
      // 簡易的な包含チェック
      if (normalizedFirst.length > 0 && normalizedTitle.length > 0) {
        if (normalizedFirst === normalizedTitle ||
          normalizedFirst.startsWith(normalizedTitle) ||
          normalizedTitle.startsWith(normalizedFirst) ||
          (normalizedFirst.includes(normalizedTitle) && firstLine.length < articleTitle.length * 2) ||
          (normalizedFirst.includes('要約') && normalizedFirst.includes(normalizedTitle.substring(0, Math.min(10, normalizedTitle.length))))
        ) {
          lines.splice(firstNonEmpty, 1);
          text = lines.join('\n');
        }
      }
    }

    // 3. 空の見出し削除（見出しの直後に別の見出しが来るパターン）
    text = text.replace(/^(#{1,6}\s+.+)\n+(?=#{1,6}\s+)/gm, (match, heading) => {
      // 見出しの直後にまた見出し → この見出しは中身がないので削除
      console.log('Removed empty heading:', heading.trim());
      return '';
    });

    // 4. 「まとめ：」「結論：」プレフィックスの除去
    text = text.replace(/^(まとめ|結論|総括)[：:]\s*/gm, '');

    // 5. 連続する空行を2行まで制限
    text = text.replace(/\n{3,}/g, '\n\n');

    return text.trim();
  }

  // AIによる記事推敲（構造を維持しつつ読みやすさ向上）
  async function refineContentWithAI(
    content: string,
    title: string,
    keyword: string,
    aiConfig: AIConfig
  ): Promise<string> {
    if (!content || content.length < 100) return content;

    console.log('Refining content with AI...');

    const prompt = `
あなたはプロの編集者です。以下のブログ記事の原稿を推敲してください。

【絶対に守るルール】
- 記事の構成（見出しの順番、セクション数）は一切変えないでください
- すべての ## や ### の見出し行はそのまま残してください（削除・統合禁止）
- 見出しのMarkdown記法（## や ###）は絶対に削除しないでください
- 文章の意味や情報は変えないでください

【やってほしいこと】
1. 長い段落（3文以上続く部分）を意味の区切りで分割し、空行を入れて読みやすくする
2. 箇条書きの前後に空行を入れる
3. 文章の接続が不自然な箇所を軽く整える（意味は変えない）

【原稿】
${content}

【出力】
修正後のMarkdownのみを出力してください。コードブロックで囲まないでください。
`.trim();

    try {
      const result = await callAI(prompt, aiConfig, 4000);
      // 安全チェック: ## が元の記事にあるのに結果にない場合は採用しない
      const originalH2Count = (content.match(/^##\s+/gm) || []).length;
      const resultH2Count = (result.match(/^##\s+/gm) || []).length;
      if (originalH2Count > 0 && resultH2Count === 0) {
        console.warn('AI refinement stripped all headings, discarding result');
        return content;
      }
      return result;
    } catch (error) {
      console.warn('AI refinement failed, returning original content:', error);
      return content;
    }
  }

  type HeadingSection = {
    lineIndex: number;
    level: number;
    title: string;
    bodySnippet: string;
  };

  function normalizeHeadingComparableText(text: string): string {
    return String(text || '')
      .toLowerCase()
      .replace(/[「」『』【】"'`]/g, '')
      .replace(/[｜|:：\-‐‑–—]/g, '')
      .replace(/\s+/g, '')
      .trim();
  }

  function isSummaryHeadingText(text: string): boolean {
    return /^(まとめ|おわりに|最後に|結論|総括|summary|conclusion)$/i.test(String(text || '').trim());
  }

  function extractHeadingSections(content: string): HeadingSection[] {
    const lines = String(content || '').split('\n');
    const headingRows: Array<{ lineIndex: number; level: number; title: string }> = [];

    for (let i = 0; i < lines.length; i++) {
      const line = String(lines[i] || '').trim();
      const match = line.match(/^(#{2,3})\s+(.+)$/);
      if (!match) continue;
      headingRows.push({
        lineIndex: i,
        level: match[1].length,
        title: String(match[2] || '').trim(),
      });
    }

    return headingRows.map((row, idx) => {
      const nextHeadingIndex = idx + 1 < headingRows.length ? headingRows[idx + 1].lineIndex : lines.length;
      const body = lines
        .slice(row.lineIndex + 1, nextHeadingIndex)
        .join(' ')
        .replace(/\s+/g, ' ')
        .trim();
      return {
        lineIndex: row.lineIndex,
        level: row.level,
        title: row.title,
        bodySnippet: body.slice(0, 220),
      };
    });
  }

  function extractJsonArrayFromText(text: string): string | null {
    const trimmed = String(text || '').trim();
    if (!trimmed) return null;

    const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
    if (fenced?.[1]) return fenced[1].trim();

    const start = trimmed.indexOf('[');
    const end = trimmed.lastIndexOf(']');
    if (start !== -1 && end !== -1 && end > start) {
      return trimmed.slice(start, end + 1);
    }
    return null;
  }

  function sanitizeRegeneratedHeading(raw: string): string {
    let text = String(raw || '')
      .replace(/^#{1,6}\s+/, '')
      .replace(/^[\d０-９]+[\.．、)\]]\s*/, '')
      .replace(/[：:]\s*$/, '')
      .replace(/\s{2,}/g, ' ')
      .trim();

    if (text.length > 40) {
      const parts = text.split(/[｜|:：]/).map((p) => p.trim()).filter(Boolean);
      const compact = parts.find((p) => p.length >= 8 && p.length <= 40);
      if (compact) text = compact;
      if (text.length > 40) text = text.slice(0, 40).trim();
    }

    return text;
  }

  async function regenerateHeadingsWithAI(
    content: string,
    title: string,
    keyword: string,
    aiConfig: AIConfig
  ): Promise<string> {
    const sections = extractHeadingSections(content);
    if (sections.length < 2) return content;

    const targetSections = sections.filter((section) => !isSummaryHeadingText(section.title));
    if (targetSections.length === 0) return content;

    console.log(`Regenerating headings with AI (${targetSections.length} headings)...`);

    const sectionLines = targetSections
      .map((section, index) => {
        const snippet = section.bodySnippet ? `\n本文要約: ${section.bodySnippet}` : '';
        return `${index + 1}. H${section.level}: ${section.title}${snippet}`;
      })
      .join('\n\n');

    const prompt = `
あなたは日本語SEO記事の編集者です。次の見出しを、本文内容に沿って自然な表現へ修正してください。

【絶対条件】
- 見出しの順番は変えない
- 見出し数は変えない
- 各見出しのH2/H3レベルは維持する
- 本文は一切変更しない（見出し文言のみ変更）
- 記事タイトルの焼き直し（例: 「記事タイトル - 〇〇」）は禁止
- 「完全ガイド｜失敗しない選び方と費用比較」のような定型語尾は禁止
- キーワード羅列だけの見出しは禁止
- 見出しは6〜36文字を目安にする

【記事タイトル】
${title}

【主キーワード】
${keyword}

【対象見出し】
${sectionLines}

【出力形式】
JSON配列のみ（説明文は不要）。要素数は ${targetSections.length} 固定。
各要素は {"level": 2 or 3, "title": "..."}。
`.trim();

    try {
      const result = await callAI(prompt, aiConfig, 1400);
      const jsonText = extractJsonArrayFromText(result);
      if (!jsonText) {
        console.warn('Heading regeneration skipped: AI result did not contain JSON array');
        return content;
      }

      const parsed = JSON.parse(jsonText);
      if (!Array.isArray(parsed) || parsed.length !== targetSections.length) {
        console.warn(
          `Heading regeneration skipped: invalid JSON length (expected=${targetSections.length}, actual=${Array.isArray(parsed) ? parsed.length : 'non-array'})`
        );
        return content;
      }

      const normalizedTitle = normalizeHeadingComparableText(title);
      const lines = content.split('\n');
      let updated = 0;

      for (let i = 0; i < targetSections.length; i++) {
        const original = targetSections[i];
        const candidate = parsed[i] || {};
        const candidateLevel = Number(candidate.level);
        const candidateTitle = sanitizeRegeneratedHeading(String(candidate.title || ''));
        if (!candidateTitle) continue;
        if (candidateTitle.length < 6) continue;
        if (Number.isFinite(candidateLevel) && candidateLevel !== original.level) continue;

        const normalizedCandidate = normalizeHeadingComparableText(candidateTitle);
        if (!normalizedCandidate) continue;
        if (normalizedTitle && (normalizedCandidate === normalizedTitle || normalizedCandidate.startsWith(normalizedTitle))) continue;
        if (/完全ガイド[｜|]\s*失敗しない選び方と費用比較/.test(candidateTitle)) continue;

        if (normalizeHeadingComparableText(candidateTitle) === normalizeHeadingComparableText(original.title)) continue;
        lines[original.lineIndex] = `${'#'.repeat(original.level)} ${candidateTitle}`;
        updated++;
      }

      if (updated === 0) {
        console.log('Heading regeneration produced no valid updates');
        return content;
      }

      console.log(`Heading regeneration applied (${updated} headings updated)`);
      return lines.join('\n');
    } catch (error) {
      console.warn('Heading regeneration failed, using original headings:', error);
      return content;
    }
  }

  let fullContent = generationResult.fullContent;
  const articleTitle = outline.title;

  console.log(`Word count check: target=${targetWordCount}, current=${countGeneratedChars(fullContent)}, initial=${generationResult.wordCount}`);

  // === Step 1: プログラム的クリーンアップ（確実・高速） ===
  fullContent = cleanupContentArtifacts(fullContent, articleTitle);
  console.log('Deterministic cleanup applied');

  // === Step 2: AIによる推敲（読みやすさ向上のみ） ===
  // タイムアウト対策: 処理開始から120秒以上経過していたらスキップ
  const elapsedMs = Date.now() - schedulerStartTime;
  const REFINEMENT_TIME_LIMIT_MS = 120_000; // 2分
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
    console.log(`Skipping AI refinement to avoid timeout (elapsed: ${Math.round(elapsedMs / 1000)}s)`);
  }

  // === Step 3: 見出しのみAI再生成（自然さ改善） ===
  const elapsedForHeadingMs = Date.now() - schedulerStartTime;
  const HEADING_REGEN_TIME_LIMIT_MS = 150_000; // 2.5分
  if (elapsedForHeadingMs < HEADING_REGEN_TIME_LIMIT_MS) {
    try {
      const regeneratedHeadingContent = await regenerateHeadingsWithAI(fullContent, articleTitle, keyword, aiConfig);
      if (regeneratedHeadingContent && regeneratedHeadingContent.length > 500) {
        fullContent = regeneratedHeadingContent;
      }
    } catch (headingError) {
      console.warn('Heading regeneration step skipped due to error:', headingError);
    }
  } else {
    console.log(`Skipping heading regeneration to avoid timeout (elapsed: ${Math.round(elapsedForHeadingMs / 1000)}s)`);
  }

  // === Step 4: 再度クリーンアップ（AI推敲・見出し再生成で再混入した場合の保険） ===
  fullContent = cleanupContentArtifacts(fullContent, articleTitle);

  // 4.6 繝輔ぃ繧ｯ繝医メ繧ｧ繝・け螳溯｡後→譚｡莉ｶ蛻・ｲ・
  let finalPostStatus = schedule.post_status || 'draft';
  let factCheckReport = null;
  let factCheckItemsChecked = 0;

  if ((schedule as any).enable_fact_check) {
    console.log(`Starting fact-check for article: ${articleTitle}`);

    try {
      // 繝輔ぃ繧ｯ繝医メ繧ｧ繝・け險ｭ螳壹ｒ蜿門ｾ・
      const scheduleUserId = (schedule as any).user_id;
      if (!scheduleUserId) {
        console.warn(`Skipping fact-check for schedule ${schedule.id}: missing user_id`);
      } else {
        let { data: factCheckSettings } = await supabase
          .from('fact_check_settings')
          .select('*')
          .eq('user_id', scheduleUserId)
          .order('updated_at', { ascending: false })
          .limit(1)
          .maybeSingle();

        if (!factCheckSettings) {
          const { data: globalRows } = await supabase
            .from('app_settings')
            .select('key, value')
            .in('key', [
              'perplexity_api_key',
              'fact_check_enabled',
              'fact_check_model_name',
              'fact_check_max_items',
              'fact_check_auto_fix_enabled',
            ]);

          if (globalRows && globalRows.length > 0) {
            const map = new Map<string, string>();
            globalRows.forEach((row: any) => {
              map.set(String(row.key), String(row.value ?? ''));
            });

            const apiKey = map.get('perplexity_api_key');
            if (apiKey) {
              factCheckSettings = {
                enabled: parseBoolean(map.get('fact_check_enabled'), true),
                perplexity_api_key: apiKey,
                model_name: map.get('fact_check_model_name') || 'sonar',
                max_items_to_check: parseNumber(map.get('fact_check_max_items'), 10),
                auto_fix_enabled: parseBoolean(map.get('fact_check_auto_fix_enabled'), false),
              } as any;
            }
          }
        }

        if (factCheckSettings?.enabled && factCheckSettings?.perplexity_api_key) {
          // 險倅ｺ九°繧峨ヵ繧｡繧ｯ繝域ュ蝣ｱ繧呈歓蜃ｺ
          const factsToCheck = await extractFactsFromContent(fullContent, (schedule as any).fact_check_note);
          const maxItems = factCheckSettings.max_items_to_check || 10;
          const itemsToCheck = factsToCheck.slice(0, maxItems);
          factCheckItemsChecked = itemsToCheck.length;

          console.log(`Found ${factsToCheck.length} facts, checking top ${itemsToCheck.length} in batches`);

          // バッチ検証実行（5件ずつ）
          let factCheckResults = await verifyFactsBatch(
            itemsToCheck,
            factCheckSettings.perplexity_api_key,
            keyword,
            factCheckSettings.model_name || 'sonar',
            5
          );

          // 重大な誤りをカウント
          const criticalIssues = factCheckResults.filter(r =>
            r.verdict === 'incorrect' && r.confidence >= 70
          ).length;
          const minorIssues = factCheckResults.filter(r =>
            r.verdict === 'partially_correct' ||
            (r.verdict === 'incorrect' && r.confidence < 70)
          ).length;

          console.log(`Fact-check completed: ${criticalIssues} critical, ${minorIssues} minor issues`);

          if (factCheckSettings.auto_fix_enabled && (criticalIssues > 0 || minorIssues > 0)) {
            console.log('Auto-fix mode enabled. Applying AI corrections...');
            const fixedContent = await applyFactCheckCorrections(
              fullContent,
              factCheckResults,
              factCheckSettings.perplexity_api_key,
              keyword,
              factCheckSettings.model_name || 'sonar'
            );

            if (fixedContent && fixedContent.trim().length > 0) {
              fullContent = fixedContent;
              const recheckFacts = await extractFactsFromContent(fullContent, (schedule as any).fact_check_note);
              const recheckItems = recheckFacts.slice(0, maxItems);
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
              console.log(`Re-check after auto-fix: ${reCritical} critical, ${reMinor} minor issues`);
            } else {
              console.warn('Auto-fix returned empty content. Keeping original content.');
            }
          }

          // 条件分岐: 重大な誤りがあれば強制的に下書き
          const criticalIssuesAfterFix = factCheckResults.filter(r =>
            r.verdict === 'incorrect' && r.confidence >= 70
          ).length;
          const minorIssuesAfterFix = factCheckResults.filter(r =>
            r.verdict === 'partially_correct' ||
            (r.verdict === 'incorrect' && r.confidence < 70)
          ).length;

          if (criticalIssuesAfterFix > 0) {
            console.log(`Critical errors found (${criticalIssuesAfterFix}). Forcing draft status.`);
            finalPostStatus = 'draft';
          }

          // 結果を保存
          const { data: savedReport } = await supabase.from('fact_check_results').insert({
            schedule_id: schedule.id,
            checked_items: factCheckResults,
            total_checked: itemsToCheck.length,
            issues_found: criticalIssuesAfterFix + minorIssuesAfterFix,
            critical_issues: criticalIssuesAfterFix
          }).select().single();

          factCheckReport = savedReport;
        } else {
          console.log('Fact-check settings not configured or API key missing');
        }
      }
    } catch (factCheckError) {
      console.error('Fact-check failed:', factCheckError);
      // 繝輔ぃ繧ｯ繝医メ繧ｧ繝・け繧ｨ繝ｩ繝ｼ縺ｯ蜈ｨ菴薙・蜃ｦ逅・ｒ豁｢繧√↑縺・
    }
  }

  // 4.7 [[]]險俶ｳ輔・繧ｯ繝ｪ繝ｼ繝ｳ繧｢繝・・
  fullContent = fullContent.replace(/\[\[(.+?)\]\]/g, '$1');
  const contentBeforeNormalization = fullContent;
  fullContent = normalizeGeneratedContentForPublishing(fullContent, articleTitle);
  if (contentBeforeNormalization !== fullContent) {
    console.log('Normalized generated content structure before publishing');
  }

  // 5. WordPress投稿（失敗時も記事スナップショットを保存）
  let postId: string | null = null;
  let publishErrorMessage: string | null = null;
  let publishedAtIso: string | null = null;

  console.log(`Publishing to WordPress: ${articleTitle} (Status: ${finalPostStatus})`);
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

  // 5.5 Chatwork通知（投稿成功時のみ）
  if (postId && schedule.chatwork_room_id && chatworkApiToken) {
    console.log(`Sending Chatwork notification to rooms: ${schedule.chatwork_room_id}`);
    try {
      const postUrl = `${wpConfig.url}/?p=${postId}`; // 簡易URL
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
      // 通知失敗は全体失敗にしない
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

  // 6. 実行履歴を保存
  const { data: executionHistory, error: executionHistoryError } = await supabase
    .from('execution_history')
    .insert({
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
    })
    .select('id')
    .single();

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

// 譛ｪ菴ｿ逕ｨ繧ｭ繝ｼ繝ｯ繝ｼ繝峨ｒ驕ｸ謚・
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
    console.log('All keywords used, resetting list');
    // 全件使用後はリスト先頭から再開
    if (allKeywords.length === 0) return null;
    return allKeywords[0];
  }

  // リスト順: 未使用の先頭を選ぶ
  return availableKeywords[0];
}

// 譛ｪ菴ｿ逕ｨ繧ｿ繧､繝医Ν繧帝∈謚・
async function selectUnusedTitle(
  scheduleId: string,
  allTitles: string[],
  supabase: any
): Promise<string | null> {
  const { data: history } = await supabase
    .from('execution_history')
    .select('article_title')
    .eq('schedule_id', scheduleId);

  // 螳悟・縺ｫ荳閾ｴ縺吶ｋ繧ｿ繧､繝医Ν繧帝勁螟・
  const usedTitles = new Set((history || []).map((h: any) => h.article_title));
  const availableTitles = allTitles.filter(t => !usedTitles.has(t));

  if (availableTitles.length === 0) {
    console.log('All titles used, resetting list');
    if (allTitles.length === 0) return null;
    return allTitles[0];
  }

  // リスト順: 未使用の先頭を選ぶ
  return availableTitles[0];
}

// 繧ｫ繝・ざ繝ｪ繝ｼID繧偵せ繝ｩ繝・げ縺ｾ縺溘・蜷榊燕縺九ｉ蜿門ｾ・
async function getCategoryIdBySlugOrName(
  config: WordPressConfig,
  categoryIdentifier: string
): Promise<number | null> {
  const auth = btoa(`${config.username}:${config.password}`);

  try {
    // 縺ｾ縺壹せ繝ｩ繝・げ縺ｧ讀懃ｴ｢
    let response = await fetch(
      `${config.url}/wp-json/wp/v2/categories?slug=${encodeURIComponent(categoryIdentifier)}`,
      { headers: { 'Authorization': `Basic ${auth}` } }
    );

    if (response.ok) {
      const data = await response.json();
      if (data.length > 0) {
        console.log(`Found category by slug "${categoryIdentifier}": ID ${data[0].id}`);
        return data[0].id;
      }
    }

    // 繧ｹ繝ｩ繝・げ縺ｧ隕九▽縺九ｉ縺ｪ縺代ｌ縺ｰ蜷榊燕縺ｧ讀懃ｴ｢
    response = await fetch(
      `${config.url}/wp-json/wp/v2/categories?search=${encodeURIComponent(categoryIdentifier)}`,
      { headers: { 'Authorization': `Basic ${auth}` } }
    );

    if (response.ok) {
      const data = await response.json();
      // 螳悟・荳閾ｴ繧呈爾縺・
      const exactMatch = data.find((cat: any) =>
        cat.name.toLowerCase() === categoryIdentifier.toLowerCase()
      );
      if (exactMatch) {
        console.log(`Found category by name "${categoryIdentifier}": ID ${exactMatch.id}`);
        return exactMatch.id;
      }
      // 螳悟・荳閾ｴ縺後↑縺代ｌ縺ｰ譛蛻昴・邨先棡繧定ｿ斐☆
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

// WordPress謚慕ｨｿ
function formatContentForWordPress(rawContent: string): string {
  let text = String(rawContent ?? '');

  // Markdown headings -> HTML headings (常に変換)
  text = text
    .replace(/^\s*######\s+(.+)$/gm, '<h6>$1</h6>')
    .replace(/^\s*#####\s+(.+)$/gm, '<h5>$1</h5>')
    .replace(/^\s*####\s+(.+)$/gm, '<h4>$1</h4>')
    .replace(/^\s*###\s+(.+)$/gm, '<h3>$1</h3>')
    .replace(/^\s*##\s+(.+)$/gm, '<h2>$1</h2>')
    .replace(/^\s*#\s+(.+)$/gm, '<h1>$1</h1>');

  // 既にHTMLタグが含まれている場合、emphasis変換はスキップ
  if (/<\/?[a-z][\s\S]*>/i.test(rawContent)) {
    return text;
  }

  // Markdown emphasis -> HTML
  return text
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>');
}

function normalizeComparableText(value: string): string {
  return String(value || '')
    .replace(/^#{1,6}\s+/, '')
    .replace(/^<h[1-6][^>]*>/i, '')
    .replace(/<\/h[1-6]>$/i, '')
    .replace(/（要約）|\(要約\)|【要約】/g, '')
    .replace(/^[Tt]itle[:：]\s*/, '')
    .toLowerCase()
    .replace(/[\s\u3000]/g, '')
    .replace(/[「」『』【】"'`]/g, '')
    .replace(/[：:]/g, '')
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
  if (/^[-*+]\s|^\d+[.)]\s|^[・●■]\s?/.test(text)) return true;
  return text.length >= 20 || /[。！？.!?、]/.test(text);
}

function looksLikeStandaloneHeadingLine(line: string): boolean {
  const text = String(line || '').trim();
  if (!text) return false;
  if (isHeadingLine(text)) return false;
  if (/^[-*+]\s|^\d+[.)]\s|^[・●■]\s?/.test(text)) return false;
  if (/^https?:\/\//i.test(text)) return false;
  if (text.length < 5 || text.length > 90) return false;
  if (/[。.]$/.test(text)) return false;
  return /[A-Za-z0-9\u3040-\u30ff\u3400-\u9fff]/.test(text);
}

function shouldRemoveLeadingTitleLine(line: string, articleTitle: string): boolean {
  const raw = extractHeadingText(line);
  if (!raw) return false;

  const normalizedLine = normalizeComparableText(raw);
  const normalizedTitle = normalizeComparableText(articleTitle);
  if (!normalizedLine || !normalizedTitle) return false;

  const withoutSummary = normalizeComparableText(raw.replace(/（要約）|\(要約\)|【要約】|要約$/g, ''));
  if (normalizedLine === normalizedTitle) return true;
  if (withoutSummary === normalizedTitle) return true;
  if (normalizedLine.startsWith(normalizedTitle) || normalizedTitle.startsWith(normalizedLine)) return true;

  const hasSummarySuffix = /(（要約）|\(要約\)|【要約】|要約$)/.test(raw);
  if (hasSummarySuffix && (normalizedLine.includes(normalizedTitle) || withoutSummary.includes(normalizedTitle))) {
    return true;
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

  const firstLineIndex = findNextNonEmptyLineIndex(lines, 0);
  if (firstLineIndex !== -1 && shouldRemoveLeadingTitleLine(lines[firstLineIndex], articleTitle)) {
    lines.splice(firstLineIndex, 1);
  }

  for (let i = 0; i < lines.length; i++) {
    const current = String(lines[i] || '').trim();
    if (!looksLikeStandaloneHeadingLine(current)) continue;

    const nextIndex = findNextNonEmptyLineIndex(lines, i + 1);
    if (nextIndex === -1) continue;
    const next = String(lines[nextIndex] || '').trim();
    if (isHeadingLine(next)) continue;
    if (!isLikelyBodyLine(next)) continue;

    lines[i] = `## ${current}`;
  }

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
  let cleaned = lines.join('\n').replace(/\n{3,}/g, '\n\n').trim();

  const postLines = cleaned.split('\n');
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

  // 繧ｫ繧ｹ繧ｿ繝謚慕ｨｿ繧ｿ繧､繝励↓蟇ｾ蠢懊＠縺溘お繝ｳ繝峨・繧､繝ｳ繝医ｒ讒狗ｯ・
  const postType = config.post_type || 'posts';
  const wpApiUrl = `${config.url}/wp-json/wp/v2/${postType}`;
  console.log(`Publishing to WordPress: ${wpApiUrl}`);

  // 繧ｫ繝・ざ繝ｪID縺ｮ蜿門ｾ暦ｼ域焚蛟､ID縲√せ繝ｩ繝・げ縲∝錐蜑阪↓蟇ｾ蠢懶ｼ・
  let categoryIds: number[] = [];
  if (config.category) {
    const trimmed = config.category.trim();

    // 縺ｾ縺壽焚蛟､ID縺ｨ縺励※繝代・繧ｹ繧定ｩｦ縺ｿ繧・
    const parsed = parseInt(trimmed, 10);
    if (!isNaN(parsed)) {
      categoryIds = [parsed];
      console.log(`Using category ID: ${parsed}`);
    } else {
      // 繧ｹ繝ｩ繝・げ縺ｾ縺溘・蜷榊燕縺ｨ縺励※讀懃ｴ｢
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

  const requestBody = JSON.stringify({
    title,
    content: formatContentForWordPress(content),
    status,
    categories: categoryIds
  });

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

// Chatwork騾夂衍騾∽ｿ｡
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

  // 繝｡繝・そ繝ｼ繧ｸ縺ｮ讒狗ｯ・
  let body = template;
  if (!body) {
    // 繝・ヵ繧ｩ繝ｫ繝医ユ繝ｳ繝励Ξ繝ｼ繝・
    body = `いつもお世話になっております。
記事の投稿が完了しましたので、ご報告いたします。

■ 記事タイトル
{title}

■ キーワード
{keyword}

■ 投稿URL
{url}

■ 投稿状態
{status}

問題などございましたら、お気軽にお知らせください。

今後ともよろしくお願いいたします。`;
  }

  // 螟画焚鄂ｮ謠・
  body = body
    .replace(/{title}/g, title)
    .replace(/{url}/g, url)
    .replace(/{keyword}/g, keyword)
    .replace(/{status}/g, status);

  const errors = [];

  for (const roomId of roomIds) {
    try {
      const response = await fetch(`https://api.chatwork.com/v2/rooms/${roomId}/messages`, {
        method: 'POST',
        headers: {
          'X-ChatWorkToken': apiToken,
          'Content-Type': 'application/x-www-form-urlencoded'
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

// 遶ｶ蜷郁ｪｿ譟ｻ繝倥Ν繝代・髢｢謨ｰ・・erpAPI邨檎罰・・
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

      // 邁｡譏鍋噪縺ｪ隕句・縺玲歓蜃ｺ・域ｭ｣隕剰｡ｨ迴ｾ繝吶・繧ｹ・・
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
