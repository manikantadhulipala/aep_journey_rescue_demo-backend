CREATE TABLE IF NOT EXISTS activation_runs (
  activation_id uuid PRIMARY KEY,
  audience_name text NOT NULL,
  destination_id text NOT NULL,
  destination_name text NOT NULL,
  status text NOT NULL CHECK (status IN ('simulated', 'failed')),
  qualified_count integer NOT NULL CHECK (qualified_count >= 0),
  rules jsonb NOT NULL,
  pii_transferred boolean NOT NULL DEFAULT false CHECK (pii_transferred = false),
  idempotency_key text,
  request_hash text,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE activation_runs ADD COLUMN IF NOT EXISTS idempotency_key text;
ALTER TABLE activation_runs ADD COLUMN IF NOT EXISTS request_hash text;

CREATE INDEX IF NOT EXISTS activation_runs_created_at_idx
  ON activation_runs (created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS activation_runs_idempotency_key_idx
  ON activation_runs (idempotency_key) WHERE idempotency_key IS NOT NULL;
