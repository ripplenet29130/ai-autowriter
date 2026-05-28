-- Release the per-schedule execution lock after a scheduler run completes.
-- The executor also has a direct delete fallback, but this RPC keeps lock
-- ownership tied to the token returned by acquire_scheduler_execution_lock.

CREATE OR REPLACE FUNCTION release_scheduler_execution_lock(
  p_schedule_id uuid,
  p_wp_config_id uuid,
  p_lock_token uuid
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_deleted_count integer := 0;
BEGIN
  DELETE FROM scheduler_execution_locks
  WHERE schedule_id = p_schedule_id
    AND wp_config_id = p_wp_config_id
    AND lock_token = p_lock_token;

  GET DIAGNOSTICS v_deleted_count = ROW_COUNT;
  RETURN v_deleted_count > 0;
END;
$$;

GRANT EXECUTE ON FUNCTION release_scheduler_execution_lock(uuid, uuid, uuid)
TO service_role, anon, authenticated;
