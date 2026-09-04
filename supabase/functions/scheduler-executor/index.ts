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


import { corsHeaders, parseBoolean, fetchWithTimeout, AiOutputTruncatedError, KeywordExhaustedError, isKeywordExhaustedError, getCurrentJstDate, parseJstDate, isWithinScheduleDateRange, normalizeAiConfig, resolveWritingTone, normalizeWhitespace, trimForLog, getFirstScheduleKeyword, AI_REQUEST_TIMEOUT_MS, SCHEDULE_EXECUTION_LOCK_TTL_SECONDS, type AIConfig, type Schedule, type WordPressConfig, type ScheduleExecutionLock, type ArticleOutline, type OutlineSection, type WritingTone } from './_shared.ts';
import { identifySchedulerCaller, authorizeSchedulerRequest, type SchedulerCaller } from './_auth.ts';
import { acquireScheduleExecutionLock, releaseScheduleExecutionLock, acquireScheduleExecutionLockWithScheduleRow, createExecutionProgressHistory, updateExecutionProgressHistory, shouldExecuteNow, wasExecutedWithinMinutes, countExecutionsForWpConfigWithinMinutes, getLastAutomaticExecutionForCadence, markStaleRunningExecutionsFailed, clearScheduleExecutionState, recordScheduleExecutionFailure, recordForceExecutionSkippedByLock, formatScheduleFailureReason, isPublishFailureAlreadyRecorded, isMissingColumnError, isMissingUpdatedAtColumn } from './_execution-state.ts';
import { callAI, resolveAiModelRate, estimateExecutionCostBreakdown, fetchStyleReferenceSample, buildStyleReferenceInstructions, truncateForStyleReference, generateTitleWithAI } from './_ai.ts';
import { conductCompetitorResearch, conductCompetitorResearchWithFallback, conductCompetitorResearchViaEdgeFunction, extractRelatedKeywordsFromCompetitorData, extractCompetitorHeadings, fetchRelatedKeywordsViaCustomSearch } from './_research.ts';
import { formatContentForWordPress, normalizeGeneratedContentForPublishing, extractExcerpt, inferLengthCategory, countNonSummaryHeadings, findHeadingOnlySections, summarizeFactCheckContentChanges } from './_content-format.ts';
import { publishToWordPress, publishViaXmlRpc, getTermIdBySlugOrName, getCategoryIdBySlugOrName, getTaxonomyCandidatesForPostType, resolveTermAssignmentForPostType, isPermissionRelatedWpError } from './_wordpress.ts';
import { generateSchedulerArticleSectioned, generateSchedulerArticleSinglePass, formatOutlineForSinglePass, validateGeneratedArticleCompleteness, compactArticleToTargetLength } from './_generation.ts';
import { sendChatworkNotifications, notifyScheduleExecutionFailure } from './_notifications.ts';

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

    const caller = await identifySchedulerCaller(req, supabase);
    const authorization = await authorizeSchedulerRequest(caller, supabase, {
      forceExecute,
      targetScheduleId,
      action: typeof params.action === 'string' ? params.action : undefined,
    });

    if (!authorization.allowed) {
      console.warn('Scheduler request rejected:', { caller: caller.kind, status: authorization.status });
      return new Response(
        JSON.stringify({ success: false, error: authorization.message }),
        { status: authorization.status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

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
        .is('user_id', null)
        .in('key', [
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
        const scheduleUserId = scheduleSetting.user_id || wpConfig.user_id;
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

        let shouldExecute = forceExecute || await shouldExecuteNow(
          timeToUse,
          currentTimeJST,
          scheduleSetting.frequency,
          scheduleSetting.weekly_day,
          scheduleSetting.monthly_days,
          scheduleSetting.id,
          supabase
        );
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
                scheduleSetting.weekly_day,
                scheduleSetting.monthly_days,
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
            if (scheduleUserId) return config.user_id === scheduleUserId;
            if (scheduleAccountId) return config.account_id === scheduleAccountId;
            return true;
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

          if (scheduleUserId || scheduleAccountId) {
            const { data: accountAppSettings, error: accountAppSettingsError } = await supabase
              .from('app_settings')
              .select('key, value')
              .match(scheduleUserId ? { user_id: scheduleUserId } : { account_id: scheduleAccountId })
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
    let titleSetQuery = supabase
      .from('title_sets')
      .select('titles')
      .eq('id', schedule.title_set_id);
    if (schedule.user_id) titleSetQuery = titleSetQuery.eq('user_id', schedule.user_id);
    const { data: titleSet } = await titleSetQuery.maybeSingle();

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
      let titleSetQuery = supabase
        .from('title_sets')
        .select('titles')
        .eq('id', schedule.title_set_id);
      if (schedule.user_id) titleSetQuery = titleSetQuery.eq('user_id', schedule.user_id);
      const { data: titleSet } = await titleSetQuery.maybeSingle();

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
    let promptSetQuery = supabase
      .from('prompt_sets')
      .select('custom_instructions')
      .eq('id', schedule.prompt_set_id);
    if (schedule.user_id) promptSetQuery = promptSetQuery.eq('user_id', schedule.user_id);
    const { data: promptSet } = await promptSetQuery.maybeSingle();

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
    const generationParams = {
      outline,
      keyword,
      keywords: sectionKeywords,
      tone: writingTone,
      targetWordCount,
      customInstructions: effectiveCustomInstructions,
      aiConfig,
    };

    // セクション分割生成を優先し、失敗時は従来のシングルパスへフォールバックする
    let generationResult;
    try {
      generationResult = await generateSchedulerArticleSectioned(generationParams);
    } catch (sectionedError) {
      const reason = sectionedError instanceof Error ? sectionedError.message : String(sectionedError || '');
      console.warn(`[generation] Sectioned generation failed (${reason}); falling back to single-pass`);
      generationResult = await generateSchedulerArticleSinglePass(generationParams);
    }

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
      // Prefer user-scoped settings, then fall back to legacy account app_settings.
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

        if (scheduleUserId) {
          appSettingsQuery = appSettingsQuery.eq('user_id', scheduleUserId);
        } else if (scheduleAccountId) {
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
          user_id: scheduleUserId || null,
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

  const articleSnapshotId = await saveGeneratedArticleSnapshot(supabase, {
    title: articleTitle,
    content: fullContent,
    keywords: sectionKeywords,
    status: articleSnapshotStatus,
    tone: writingTone,
    aiConfig,
    schedule,
    wpConfig,
    postId,
    publishedAt: publishedAtIso,
  });

  if (articleSnapshotId) {
    await sendScheduledReviewRequest({
      schedule,
      supabase,
      articleId: articleSnapshotId,
      title: articleTitle,
      keyword,
      apiToken: chatworkApiToken,
    });
  }

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
    user_id: schedule.user_id || wpConfig.user_id || null,
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

  if (isMissingColumnError(executionHistoryResult.error, 'user_id')) {
    console.warn('execution_history.user_id is missing. Retrying history save without user_id.');
    delete executionHistoryPayload.user_id;
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


async function saveGeneratedArticleSnapshot(
  supabase: any,
  params: {
    title: string;
    content: string;
    keywords: string[];
    status: 'draft' | 'published' | 'failed';
    tone: WritingTone;
    aiConfig: AIConfig;
    schedule: Schedule;
    wpConfig: WordPressConfig;
    postId?: string | null;
    publishedAt?: string | null;
  }
): Promise<string | null> {
  const wordCount = countGeneratedChars(params.content);
  const readingTime = Math.max(1, Math.round(wordCount / 500));

  const payload = {
    account_id: params.schedule.account_id || params.wpConfig.account_id || null,
    user_id: params.schedule.user_id || params.wpConfig.user_id || null,
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

async function sendScheduledReviewRequest(params: {
  schedule: Schedule;
  supabase: any;
  articleId: string;
  title: string;
  keyword: string;
  apiToken: string | null;
}): Promise<void> {
  const { schedule, supabase, articleId, title, keyword, apiToken } = params;
  const roomIds = String(schedule.chatwork_room_id || '').trim();
  if (!schedule.chatwork_notify_on_review || !roomIds || !apiToken) return;

  const appUrl = Deno.env.get('APP_URL') || Deno.env.get('PUBLIC_APP_URL');
  if (!appUrl) {
    console.warn('ChatWork review notification skipped: APP_URL is not configured.');
    return;
  }

  try {
    const token = Array.from(crypto.getRandomValues(new Uint8Array(32))).map((byte) => byte.toString(16).padStart(2, '0')).join('');
    const tokenHash = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token)))).map((byte) => byte.toString(16).padStart(2, '0')).join('');
    const expiresDays = Math.min(365, Math.max(1, Number(schedule.chatwork_review_expires_days || 30)));
    const { error } = await supabase.from('article_review_links').insert({
      article_id: articleId,
      token_hash: tokenHash,
      permission: ['view', 'comment', 'edit'].includes(String(schedule.chatwork_review_permission)) ? schedule.chatwork_review_permission : 'comment',
      expires_at: new Date(Date.now() + expiresDays * 24 * 60 * 60 * 1000).toISOString(),
    });
    if (error) throw error;

    const recipients = Array.isArray(schedule.chatwork_recipients) ? schedule.chatwork_recipients : [];
    const toLines = recipients
      .filter((recipient: any) => String(recipient?.accountId || '').trim())
      .map((recipient: any) => `[To:${String(recipient.accountId).trim()}]${String(recipient.name || '担当者').trim()}`)
      .join('\n');
    const reviewUrl = `${appUrl.replace(/\/$/, '')}/review/${token}`;
    // 通知には、スケジュールで指定した入力だけを載せる。
    // タイトルセットだけで生成する場合、内部的にはタイトルを keyword としても
    // 扱うため、その値を「キーワード」として通知しないようにする。
    const hasConfiguredTitle = Boolean(schedule.title_set_id);
    const hasConfiguredKeyword = String(schedule.keyword || '')
      .split(',')
      .some((item) => item.trim());
    const configuredInputLines = [
      hasConfiguredTitle ? 'タイトル: {title}' : '',
      hasConfiguredKeyword ? 'キーワード: {keyword}' : '',
    ].filter(Boolean).join('\n');
    const template = `[info][title]記事レビューのお願い[/title]
${toLines ? `${toLines}\n\n` : ''}${configuredInputLines ? `${configuredInputLines}\n\n` : ''}

以下のリンクから内容をご確認ください。
{url}

リンク有効期限: ${expiresDays}日[/info]`;
    await sendChatworkNotifications(apiToken, roomIds, template, title, reviewUrl, keyword, 'レビュー依頼');
  } catch (error) {
    console.error('ChatWork review notification failed:', error);
  }
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

