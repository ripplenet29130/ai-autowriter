// 呼び出し元の認証・認可（service role / admin / 所有ユーザー / anonymous）

export type SchedulerCaller =
  | { kind: 'service_role' }
  | { kind: 'admin'; userId: string }
  | { kind: 'user'; userId: string }
  | { kind: 'anonymous' };


export const identifySchedulerCaller = async (req: Request, supabase: any): Promise<SchedulerCaller> => {
  const authHeader = req.headers.get('Authorization') ?? '';
  const token = authHeader.replace(/^Bearer\s+/i, '').trim();
  if (!token) return { kind: 'anonymous' };

  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
  if (serviceRoleKey && token === serviceRoleKey) return { kind: 'service_role' };

  const { data, error } = await supabase.auth.getUser(token);
  if (error || !data?.user) return { kind: 'anonymous' };

  const { data: profile } = await supabase
    .from('profiles')
    .select('role')
    .eq('user_id', data.user.id)
    .maybeSingle();

  return profile?.role === 'admin'
    ? { kind: 'admin', userId: data.user.id }
    : { kind: 'user', userId: data.user.id };
};

// 強制実行・ロック解除・スケジュール指定は所有ユーザー / 管理者 / service role のみ許可する。
// pg_cron(anon key 運用)互換のため、非強制の全体実行だけは従来どおり誰でも起動できる
// （毎分の cron 実行と同じ内容で、実行ロックにより重複実行はされない）。

export const authorizeSchedulerRequest = async (
  caller: SchedulerCaller,
  supabase: any,
  request: { forceExecute: boolean; targetScheduleId?: string; action?: string },
): Promise<{ allowed: true } | { allowed: false; status: number; message: string }> => {
  if (caller.kind === 'service_role' || caller.kind === 'admin') return { allowed: true };

  const isTargetedOperation = request.forceExecute
    || Boolean(request.targetScheduleId)
    || request.action === 'clear_execution_state';
  if (!isTargetedOperation) return { allowed: true };

  if (caller.kind === 'anonymous') {
    return { allowed: false, status: 401, message: 'A logged-in user session is required for this operation.' };
  }

  if (!request.targetScheduleId) {
    return { allowed: false, status: 403, message: 'scheduleId is required for this operation.' };
  }

  const { data: schedule, error } = await supabase
    .from('schedule_settings')
    .select('id, user_id')
    .eq('id', request.targetScheduleId)
    .maybeSingle();

  if (error || !schedule || schedule.user_id !== caller.userId) {
    return { allowed: false, status: 403, message: 'You do not have permission to operate this schedule.' };
  }

  return { allowed: true };
};

