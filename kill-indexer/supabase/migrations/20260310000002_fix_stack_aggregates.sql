-- Fix stack aggregates: recompute from agent_stack (ground truth from on-chain snapshot).
--
-- Root cause: reindex.mjs replayed historical events through ingest on top of the
-- March-8 snapshot migration, double-counting deltas into stack.total_standard_units.
-- agent_stack is correct (poll-solana overwrites it with on-chain values each cycle).
-- stack needs to match agent_stack sums.

-- Step 1: zero stacks where all agent_stack entries are 0 or missing
UPDATE stack s
SET total_standard_units = 0,
    total_boosted_units  = 0,
    active               = false,
    birth_slot           = 0
WHERE NOT EXISTS (
  SELECT 1 FROM agent_stack a
  WHERE a.stack_id::text = s.id AND (a.units > 0 OR a.reaper > 0)
);

-- Step 2: recompute from agent_stack sums for stacks that have active units
UPDATE stack s
SET
  total_standard_units = agg.total_units,
  total_boosted_units  = agg.total_reaper,
  active               = true
FROM (
  SELECT stack_id::text        AS sid,
         SUM(units)::numeric   AS total_units,
         SUM(reaper)::numeric  AS total_reaper
  FROM agent_stack
  WHERE units > 0 OR reaper > 0
  GROUP BY stack_id
) agg
WHERE s.id = agg.sid;

-- Create a reusable function so poll-solana can call it after each snapshot
CREATE OR REPLACE FUNCTION rebuild_stack_from_agent_stack()
RETURNS void LANGUAGE sql SECURITY DEFINER AS $$
  -- Zero stacks with no active agent_stack entries
  UPDATE stack s
  SET total_standard_units = 0,
      total_boosted_units  = 0,
      active               = false,
      birth_slot           = 0
  WHERE NOT EXISTS (
    SELECT 1 FROM agent_stack a
    WHERE a.stack_id::text = s.id AND (a.units > 0 OR a.reaper > 0)
  );

  -- Update stacks from agent_stack sums
  UPDATE stack s
  SET
    total_standard_units = agg.total_units,
    total_boosted_units  = agg.total_reaper,
    active               = true
  FROM (
    SELECT stack_id::text        AS sid,
           SUM(units)::numeric   AS total_units,
           SUM(reaper)::numeric  AS total_reaper
    FROM agent_stack
    WHERE units > 0 OR reaper > 0
    GROUP BY stack_id
  ) agg
  WHERE s.id = agg.sid;
$$;
