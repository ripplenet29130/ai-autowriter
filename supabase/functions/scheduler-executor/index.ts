import { createClient } from 'npm:@supabase/supabase-js@2';
import { DEFAULT_TARGET_WORD_COUNT } from '../../../src/shared/generationPolicy.ts';
import {
  countGeneratedChars,
  generateArticleFromOutlineWithSharedCore,
  generateOutlineWithSharedCore,
} from '../../../src/shared/articleGenerationCore.ts';
import { scoreGenerationRegression } from '../../../src/shared/generationRegressionScoring.ts';
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
  ab_test_enabled?: boolean;
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
  image_enabled?: boolean;
  images_per_article?: number;
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
      console.log('Scheduler execution started:', new Date().toISOString());
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
        .order('created_at', { ascending: false })
        .limit(1);

      if (aiError || !aiConfigs || aiConfigs.length === 0) {
        console.error('No AI config found:', aiError);
        return stats;
      }

      const aiConfig: AIConfig = aiConfigs[0];
      console.log('Using AI config:', aiConfig.provider, aiConfig.model);

      // 1.5 蜷・ｨｮAPI繝医・繧ｯ繝ｳ繝ｻ繧ｭ繝ｼ縺ｮ蜿門ｾ・
      let chatworkApiToken: string | null = null;
      let serpApiKey: string | null = null;
      let googleApiKey: string | null = null;
      let searchEngineId: string | null = null;
      let imageCostUsdPerImage = 0.04;

      const { data: appSettings, error: appSettingsError } = await supabase
        .from('app_settings')
        .select('key, value')
        .in('key', ['chatwork_api_token', 'serpapi_key', 'google_custom_search_api_key', 'google_custom_search_engine_id', 'image_cost_usd_per_image']);

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

      // 3. 蜷・せ繧ｱ繧ｸ繝･繝ｼ繝ｫ蜃ｦ逅・
      for (const schedule of schedules) {
        stats.considered += 1;
        const scheduleSetting: Schedule = schedule as any;
        const wpConfig: WordPressConfig = (schedule as any).wordpress_configs;
        const timeToUse = scheduleSetting.post_time;

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
          const recentlyExecuted = await wasExecutedWithinMinutes(scheduleSetting.id, supabase, 10);
          if (recentlyExecuted) {
            shouldExecute = false;
            console.log(`Skipping force execution for ${wpConfig.name}: executed within last 10 minutes`);
          }
        }

        if (shouldExecute) {
          console.log(`Executing schedule for ${wpConfig.name}`);

          let effectiveAiConfig = aiConfig;
          if (scheduleSetting.ai_config_id) {
            const { data: specificAiConfig } = await supabase
              .from('ai_configs')
              .select('*')
              .eq('id', scheduleSetting.ai_config_id)
              .single();

            if (specificAiConfig) {
              effectiveAiConfig = specificAiConfig as AIConfig;
              console.log(`Using schedule-specific AI config: ${effectiveAiConfig.provider} (${effectiveAiConfig.model})`);
            } else {
              console.error(`Defined AI Config ID ${scheduleSetting.ai_config_id} not found.`);
              stats.failed += 1;
              continue;
            }
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
              imageCostUsdPerImage
            );
            stats.executed += 1;
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

    const stats = await processSchedules();

    // 蜊ｳ蠎ｧ縺ｫ謌仙粥繝ｬ繧ｹ繝昴Φ繧ｹ繧定ｿ斐☆
    return new Response(
      JSON.stringify({
        success: true,
        mode: forceExecute ? 'force' : 'scheduled',
        message: 'Scheduler processing completed.',
        timestamp: new Date().toISOString(),
        stats
      }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

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
    // Testing-friendly behavior: allow another daily run after 10 minutes.
    // This still blocks back-to-back duplicates within the same schedule window.
    if (hoursSinceLastExecution >= (10 / 60)) {
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
  abTestEnabled: boolean;
  competitorResearchUsed: boolean;
  factCheckItemsChecked: number;
  imagesGenerated: number;
  imageUnitCostUsd: number;
}) {
  const rate = resolveAiModelRate(params.provider, params.model);
  const generationMultiplier = params.abTestEnabled ? 2 : 1;

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

// 繧ｹ繧ｱ繧ｸ繝･繝ｼ繝ｫ螳溯｡鯉ｼ医・繝ｫ繝√せ繝・ャ繝礼函謌千沿・・
async function executeSchedule(
  schedule: Schedule,
  wpConfig: WordPressConfig,
  aiConfig: AIConfig,
  supabase: any,
  chatworkApiToken: string | null,
  serpApiKey: string | null,
  googleApiKey: string | null,
  searchEngineId: string | null,
  imageCostUsdPerImage: number
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
    // 荳｡譁ｹ菴ｿ逕ｨ縺ｮ蝣ｴ蜷茨ｼ壻ｻ雁屓縺ｯ邁｡譏鍋噪縺ｫ50%縺ｮ遒ｺ邇・〒繧ｿ繧､繝医Ν縲・0%縺ｧ繧ｭ繝ｼ繝ｯ繝ｼ繝峨→縺吶ｋ
    const useTitle = Math.random() < 0.5;

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
      competitorData = await conductCompetitorResearch(keyword, serpApiKey, 5);
      console.log(`Competitor research completed. Found ${competitorData.articles.length} articles`);
    } catch (researchError) {
      console.warn('Competitor research failed, proceeding without it:', researchError);
    }
  } else {
    console.log('SerpAPI key not found. Skipping competitor research.');
  }

  console.log(`Generating outline for: ${keyword}`);
  const targetWordCount = schedule.target_word_count || DEFAULT_TARGET_WORD_COUNT;
  const writingTone = schedule.writing_tone || 'desu_masu';
  const keywordArray = (schedule.keyword || '').split(',').map((k: string) => k.trim()).filter((k: string) => k);
  const sectionKeywords = Array.from(new Set([keyword, ...keywordArray])).filter(Boolean);
  const competitorHeadings = competitorData?.articles?.flatMap((a: any) => a.headings || []).slice(0, 15) || [];

  const runGeneration = async () => {
    const outline = await generateOutlineWithSharedCore({
      keyword,
      targetWordCount,
      fixedTitle,
      customInstructions,
      competitorHeadings,
      callAI: (prompt, maxTokens) => callAI(prompt, aiConfig, maxTokens)
    });
    const generationResult = await generateArticleFromOutlineWithSharedCore({
      outline,
      keywords: sectionKeywords,
      tone: writingTone,
      targetWordCount,
      customInstructions,
      defaultMaxTokens: aiConfig.max_tokens || 2000,
      qualityRetryCount: 1,
      callAI: (prompt, maxTokens) => callAI(prompt, aiConfig, maxTokens)
    });
    return { outline, generationResult };
  };

  const runAbTest = schedule.ab_test_enabled === true;
  const [schedulerRun, manualRun] = await Promise.all([
    runGeneration(),
    runAbTest ? runGeneration() : Promise.resolve(null)
  ]);

  const outline = schedulerRun.outline;
  const generationResult = schedulerRun.generationResult;
  let regressionScores: ReturnType<typeof scoreGenerationRegression> | null = null;
  if (manualRun) {
    regressionScores = scoreGenerationRegression(manualRun.generationResult.fullContent, generationResult.fullContent);
    console.log(`AB regression completed: overall=${regressionScores.overallScore}, structure=${regressionScores.structureSimilarity}, overlap=${regressionScores.overlapRate}`);
  }

  let fullContent = generationResult.fullContent;
  const articleTitle = outline.title;

  console.log(`Word count check: target=${targetWordCount}, current=${countGeneratedChars(fullContent)}, initial=${generationResult.wordCount}`);
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

  // 5. WordPress縺ｫ謚慕ｨｿ・域擅莉ｶ蛻・ｲ仙ｾ後・繧ｹ繝・・繧ｿ繧ｹ繧剃ｽｿ逕ｨ・・
  console.log(`Publishing to WordPress: ${articleTitle} (Status: ${finalPostStatus})`);
  const postId = await publishToWordPress(
    wpConfig,
    articleTitle,
    fullContent,
    finalPostStatus
  );
  console.log(`Published: Post ID ${postId}`);

  // 5.5 Chatwork騾夂衍 (髱槫酔譛溘〒螳溯｡後＠縲√お繝ｩ繝ｼ縺ｧ繧ゅΓ繧､繝ｳ蜃ｦ逅・・豁｢繧√↑縺・
  if (schedule.chatwork_room_id && chatworkApiToken) {
    console.log(`Sending Chatwork notification to rooms: ${schedule.chatwork_room_id}`);
    try {
      const postUrl = `${wpConfig.url}/?p=${postId}`; // 邁｡譏鍋噪縺ｪURL逕滓・
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
      // 騾夂衍螟ｱ謨励・蜈ｨ菴薙・繧ｨ繝ｩ繝ｼ縺ｫ縺ｯ縺励↑縺・
    }
  }

  const costBreakdown = estimateExecutionCostBreakdown({
    provider: aiConfig.provider,
    model: aiConfig.model,
    generatedChars: countGeneratedChars(fullContent),
    abTestEnabled: runAbTest,
    competitorResearchUsed: Boolean(competitorData?.articles?.length),
    factCheckItemsChecked,
    imagesGenerated: aiConfig.image_enabled ? (aiConfig.images_per_article ?? 0) : 0,
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
    wordpress_post_id: postId,
    status: 'success',
    cost_breakdown: costBreakdown,
    estimated_cost_usd: costBreakdown.total_estimated_usd,
    })
    .select('id')
    .single();

  if (executionHistoryError) {
    console.error('Failed to save execution history:', executionHistoryError);
  }

  if (runAbTest && regressionScores) {
    const { error: regressionError } = await supabase
      .from('generation_regression_results')
      .insert({
        schedule_id: schedule.id,
        execution_history_id: executionHistory?.id ?? null,
        user_id: schedule.user_id ?? null,
        keyword,
        article_title: articleTitle,
        target_word_count: targetWordCount,
        writing_tone: writingTone,
        baseline_mode: 'manual',
        candidate_mode: 'scheduler',
        metrics: regressionScores,
        overall_score: regressionScores.overallScore
      });

    if (regressionError) {
      console.error('Failed to save AB regression result:', regressionError);
    }
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
    // 繝ｩ繝ｳ繝繝縺ｫ驕ｸ謚・
    if (allKeywords.length === 0) return null;
    return allKeywords[Math.floor(Math.random() * allKeywords.length)];
  }

  return availableKeywords[Math.floor(Math.random() * availableKeywords.length)];
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
    return allTitles[Math.floor(Math.random() * allTitles.length)];
  }

  return availableTitles[Math.floor(Math.random() * availableTitles.length)];
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
  const text = String(rawContent ?? '');
  // If content already includes HTML tags, keep as-is.
  if (/<\/?[a-z][\s\S]*>/i.test(text)) {
    return text;
  }

  return text
    // Markdown headings -> HTML headings
    .replace(/^######\s+(.+)$/gm, '<h6>$1</h6>')
    .replace(/^#####\s+(.+)$/gm, '<h5>$1</h5>')
    .replace(/^####\s+(.+)$/gm, '<h4>$1</h4>')
    .replace(/^###\s+(.+)$/gm, '<h3>$1</h3>')
    .replace(/^##\s+(.+)$/gm, '<h2>$1</h2>')
    .replace(/^#\s+(.+)$/gm, '<h1>$1</h1>');
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

  const response = await fetch(wpApiUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Basic ${auth}`
    },
    body: JSON.stringify({
      title,
      content: formatContentForWordPress(content),
      status,
      categories: categoryIds
    })
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`WordPress API error: ${response.status} - ${errorText}`);
  }

  const data = await response.json();
  return data.id.toString();
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

