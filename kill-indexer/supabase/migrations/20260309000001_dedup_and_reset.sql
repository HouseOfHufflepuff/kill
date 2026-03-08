-- Idempotency table: one row per processed signature.
-- The webhook and poll-solana both attempt INSERT before applying any deltas.
-- A unique violation (23505) means the sig was already processed — skip it.
-- This makes every ingestion path safe to run concurrently or redundantly.
CREATE TABLE processed_sigs (
  sig  text primary key,
  at   timestamptz not null default now()
);

-- Checkpoint table for poll-solana (create if not exists — already present in some envs).
CREATE TABLE IF NOT EXISTS indexer_state (
  id              text primary key,
  last_signature  text,
  last_slot       bigint,
  updated_at      timestamptz
);

-- Wipe all stale/double-counted state. Reindex will rebuild from on-chain truth.
TRUNCATE TABLE stack, agent_stack, agent, global_stat, spawned, moved, killed;
