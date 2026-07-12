// 実行ロック・実行履歴・スケジュール実行可否の判定
import {
  FALLBACK_SCHEDULE_ROW_LOCK_WINDOW_SECONDS,
  SCHEDULE_EXECUTION_LOCK_TTL_SECONDS,
  STALE_RUNNING_EXECUTION_MINUTES,
  type AIConfig,
  type Schedule,
  type ScheduleExecutionLock,
  type WordPressConfig,
  getCurrentJstDate,
  getFirstScheduleKeyword,
  parseJstDate,
  parseBoolean,
  trimForLog,
  isKeywordExhaustedError,
  KeywordExhaustedError,
} from './_shared.ts';

let warnedMissingSchedulerLockRpc = false;
let warnedUsingFallbackScheduleRowLock = false;
let warnedSchedulerLockUnavailable = false;


export function isMissingSchedulerLockRpc(error: any): boolean {
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


export async function acquireScheduleExecutionLock(
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


export async function releaseScheduleExecutionLock(
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


export function isMissingUpdatedAtColumn(error: any): boolean {
  const errorText = [
    String(error?.message || ''),
    String(error?.details || ''),
    String(error?.hint || ''),
  ].join(' ').toLowerCase();

  return errorText.includes('updated_at') && errorText.includes('does not exist');
}


export function isMissingColumnError(error: any, columnName: string): boolean {
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


export async function createExecutionProgressHistory(
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
    user_id: params.schedule.user_id || params.wpConfig.user_id || null,
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

  if (isMissingColumnError(result.error, 'user_id')) {
    delete payload.user_id;
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


export async function updateExecutionProgressHistory(
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


export async function acquireScheduleExecutionLockWithScheduleRow(
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

export async function shouldExecuteNow(
  scheduleTime: string,
  currentTime: string,
  frequency: string,
  weeklyDay: number | null | undefined,
  monthlyDays: number[] | null | undefined,
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

  const freqMap: Record<string, string> = {
    '毎日': 'daily',
    '毎週': 'weekly',
    '隔週': 'biweekly',
    '毎月': 'monthly',
  };
  const normalizedFreq = freqMap[frequency] || frequency;
  const now = new Date();
  const jstDateFormatter = new Intl.DateTimeFormat('ja-JP', { timeZone: 'Asia/Tokyo', year: 'numeric', month: '2-digit', day: '2-digit' });
  const currentWeekdayText = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Tokyo',
    weekday: 'short',
  }).format(now);
  const currentWeekday = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(currentWeekdayText);
  const normalizedWeeklyDay = Number.isInteger(weeklyDay) && Number(weeklyDay) >= 0 && Number(weeklyDay) <= 6
    ? Number(weeklyDay)
    : null;
  if (normalizedFreq === 'weekly' && normalizedWeeklyDay !== null && currentWeekday !== normalizedWeeklyDay) {
    return false;
  }
  const currentDay = Number(new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Tokyo',
    day: 'numeric',
  }).format(now));
  const normalizedMonthlyDays = [...new Set(monthlyDays || [])]
    .filter((day) => Number.isInteger(day) && day >= 1 && day <= 31);
  if (normalizedFreq === 'monthly' && normalizedMonthlyDays.length > 0 && !normalizedMonthlyDays.includes(currentDay)) {
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
  const hoursSinceLastExecution = (now.getTime() - lastExecutedAt.getTime()) / (1000 * 60 * 60);

  // JST驍ｵ・ｺ繝ｻ・ｧ驍ｵ・ｺ繝ｻ・ｮ髫ｴ魃会ｽｽ・･髣疲・・ｿ・ｶ繝ｻ・ｯ驕呈汚・ｽ・ｼ郢晢ｽｻ騾｡繝ｻ
  const lastExecutedDate = jstDateFormatter.format(lastExecutedAt);
  const currentDate = jstDateFormatter.format(now);

  console.log(`[Freq Check] ${normalizedFreq}, Hours since: ${hoursSinceLastExecution.toFixed(1)}, Last day: ${lastExecutedDate}, Today: ${currentDate}`);

  if (normalizedFreq === 'daily') {
    // Strict daily behavior in JST: execute only when the date has changed.
    if (lastExecutedDate !== currentDate) {
      return true;
    }
  } else if (normalizedFreq === 'weekly') {
    if (normalizedWeeklyDay !== null) {
      return lastExecutedDate !== currentDate;
    }
    if (hoursSinceLastExecution >= 24 * 6) {
      return true;
    }
  } else if (normalizedFreq === 'biweekly' && hoursSinceLastExecution >= 24 * 12) {
    return true;
  } else if (normalizedFreq === 'monthly') {
    if (normalizedMonthlyDays.length > 0) {
      return lastExecutedDate !== currentDate;
    }
    if (hoursSinceLastExecution >= 24 * 27) {
      return true;
    }
  }

  return false;
}


export function getJstMinutesOfDay(date: Date): number | null {
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


export function isExecutionNearScheduleTime(executedAt: string, scheduleTime: string): boolean {
  const [scheduleHour, scheduleMinute] = String(scheduleTime || '').split(':').map(Number);
  if (!Number.isFinite(scheduleHour) || !Number.isFinite(scheduleMinute)) return false;

  const executedMinutes = getJstMinutesOfDay(new Date(executedAt));
  if (executedMinutes == null) return false;

  const scheduleMinutes = scheduleHour * 60 + scheduleMinute;
  const diff = executedMinutes - scheduleMinutes;
  return diff >= 0 && diff <= 5;
}


export function isAutomaticExecutionForCadence(row: any, scheduleTime: string): boolean {
  const triggerType = row?.cost_breakdown?.trigger_type;
  if (triggerType === 'manual') return false;
  if (triggerType === 'automatic') return true;

  // Legacy rows did not store trigger_type. Treat only executions that happened
  // during the scheduled time window as automatic cadence runs.
  return isExecutionNearScheduleTime(row?.executed_at, scheduleTime);
}


export async function getLastAutomaticExecutionForCadence(
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


export async function wasExecutedWithinMinutes(
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


export async function countExecutionsForWpConfigWithinMinutes(
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


export function formatScheduleFailureReason(error: unknown): string {
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


export function isPublishFailureAlreadyRecorded(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error || '');
  return message.startsWith('WordPress publish failed:');
}


export async function markStaleRunningExecutionsFailed(supabase: any): Promise<void> {
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


export async function clearScheduleExecutionState(
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


export async function recordScheduleExecutionFailure(
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
      user_id: schedule.user_id || wpConfig.user_id || null,
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

    if (isMissingColumnError(insertResult.error, 'user_id')) {
      console.warn('execution_history.user_id is missing. Retrying failed history save without user_id.');
      delete failureHistoryPayload.user_id;
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


export async function recordForceExecutionSkippedByLock(
  supabase: any,
  schedule: Schedule,
  wpConfig: WordPressConfig
): Promise<void> {
  const reason = '前回の予約投稿実行ロックがまだ有効です。前の処理が実行中、または異常終了後のロック期間待ちです。数分後に再実行するか、ロックを解除してください。';
  const payload: Record<string, any> = {
    account_id: schedule.account_id || wpConfig.account_id || null,
    user_id: schedule.user_id || wpConfig.user_id || null,
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

    if (isMissingColumnError(result.error, 'user_id')) {
      delete payload.user_id;
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
