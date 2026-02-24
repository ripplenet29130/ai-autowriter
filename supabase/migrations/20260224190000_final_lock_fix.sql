-- Prevent duplicate scheduler runs caused by concurrent triggers.
-- This introduces a short-lived DB lock per schedule.

CREATE TABLE IF NOT EXISTS scheduler_execution_locks (
  schedule_id uuid PRIMARY KEY REFERENCES schedule_settings(id) ON DELETE CASCADE,
  wp_config_id uuid NOT NULL REFERENCES wordpress_configs(id) ON DELETE CASCADE,
  lock_token uuid NOT NULL DEFAULT gen_random_uuid(),
  locked_until timestamptz NOT NULL,
  acquired_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_scheduler_execution_locks_locked_until
  ON scheduler_execution_locks(locked_until);

CREATE INDEX IF NOT EXISTS idx_scheduler_execution_locks_wp_config
  ON scheduler_execution_locks(wp_config_id);

ALTER TABLE scheduler_execution_locks ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'scheduler_execution_locks'
      AND policyname = 'Allow all access to scheduler_execution_locks'
  ) THEN
    CREATE POLICY "Allow all access to scheduler_execution_locks"
      ON scheduler_execution_locks
      FOR ALL
      TO anon
      USING (true)
      WITH CHECK (true);
  END IF;
END
$$;

DROP TRIGGER IF EXISTS update_scheduler_execution_locks_updated_at
  ON scheduler_execution_locks;

CREATE TRIGGER update_scheduler_execution_locks_updated_at
  BEFORE UPDATE ON scheduler_execution_locks
  FOR EACH ROW
  EXECUTE PROCEDURE update_updated_at_column();

CREATE OR REPLACE FUNCTION acquire_scheduler_execution_lock(
  p_schedule_id uuid,
  p_wp_config_id uuid,
  p_lock_seconds integer DEFAULT 1200
)
RETURNS TABLE (
  acquired boolean,
  lock_token uuid,
  locked_until timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_lock_seconds integer := GREATEST(COALESCE(p_lock_seconds, 1200), 10);
BEGIN
  DELETE FROM scheduler_execution_locks
  WHERE locked_until <= now();

  RETURN QUERY
  WITH lock_attempt AS (
    INSERT INTO scheduler_execution_locks (
      schedule_id,
      wp_config_id,
      lock_token,
      locked_until,
      acquired_at,
      updated_at
    )
    VALUES (
      p_schedule_id,
      p_wp_config_id,
      gen_random_uuid(),
      now() + make_interval(secs => v_lock_seconds),
      now(),
      now()
    )
    ON CONFLICT (schedule_id) DO UPDATE
      SET wp_config_id = EXCLUDED.wp_config_id,
          lock_token = gen_random_uuid(),
          locked_until = EXCLUDED.locked_until,
          acquired_at = now(),
          updated_at = now()
      WHERE scheduler_execution_locks.locked_until <= now()
    RETURNING true AS acquired, lock_token, locked_until
  )
  SELECT acquired, lock_token, locked_until
  FROM lock_attempt;

  IF NOT FOUND THEN
    RETURN QUERY
    SELECT false, NULL::uuid, NULL::timestamptz;
  END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION acquire_scheduler_execution_lock(uuid, uuid, integer)
  TO anon, authenticated, service_role;
