-- Full wipe including dedup table so the next single reindex is authoritative.
TRUNCATE TABLE stack, agent_stack, agent, global_stat, spawned, moved, killed;
TRUNCATE TABLE processed_sigs;
-- Reset poll-solana checkpoint so it starts from the beginning
DELETE FROM indexer_state WHERE id = 'solana-poll';
