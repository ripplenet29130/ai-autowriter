-- Add cost tracking fields to execution history
ALTER TABLE execution_history
ADD COLUMN IF NOT EXISTS cost_breakdown jsonb DEFAULT '{}'::jsonb;

ALTER TABLE execution_history
ADD COLUMN IF NOT EXISTS estimated_cost_usd numeric(12, 6);

COMMENT ON COLUMN execution_history.cost_breakdown IS 'Estimated cost breakdown per execution (AI/research/fact-check/images)';
COMMENT ON COLUMN execution_history.estimated_cost_usd IS 'Estimated total execution cost in USD';

