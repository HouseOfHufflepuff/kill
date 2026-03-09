// snapshot.mjs
// Reads ALL agentStack accounts directly from the Solana contract and writes
// a SQL file that wipes + restores agent_stack to exact on-chain state.
//
// Usage (from kill root):
//   node kill-indexer/snapshot.mjs
//   cd kill-indexer && npx supabase db execute --file ../snapshot.sql

import { createRequire } from "module";
import { writeFileSync, readFileSync } from "fs";
const require = createRequire(import.meta.url);

const anchor  = require("../node_modules/@coral-xyz/anchor");
const web3    = require("../node_modules/@solana/web3.js");
const fs      = { readFileSync: readFileSync };

const PROGRAM_ID = "2FbeFxvFH2b4KyAcwNToFr3pHzYK4ybYQWriXjjKEr5D";
const RPC_URL    = "https://api.devnet.solana.com";

const idl      = JSON.parse(readFileSync("contracts-solana/target/idl/kill_game.json", "utf8"));
const conn     = new web3.Connection(RPC_URL, "confirmed");
const dummyKey = web3.Keypair.generate().publicKey;
const provider = new anchor.AnchorProvider(conn, { publicKey: dummyKey }, {});
const program  = new anchor.Program(idl, provider);

console.log("Reading all agentStack accounts from chain...");
const all = await program.account.agentStack.all([]);
console.log(`Found ${all.length} agentStack accounts`);

const rows = all.map(({ account: a }) => {
  const id      = `${a.agent.toBase58()}-${a.stackId}`;
  const agent   = a.agent.toBase58();
  const stackId = a.stackId;
  const units   = BigInt(a.units.toString());
  const reaper  = BigInt(a.reapers.toString());
  return { id, agent, stackId, units, reaper };
});

const values = rows.map(r =>
  `('${r.id}','${r.agent}',${r.stackId},${r.units},${r.reaper},0)`
).join(",\n  ");

const sql = `-- Snapshot from on-chain state
-- Generated: ${new Date().toISOString()}
-- Accounts: ${rows.length}

TRUNCATE TABLE agent_stack;

INSERT INTO agent_stack (id, agent, stack_id, units, reaper, birth_slot)
VALUES
  ${values};

-- Rebuild stack aggregates from agent_stack (keeps stack table in sync with ground truth)
UPDATE stack s
SET total_standard_units = 0,
    total_boosted_units  = 0,
    active               = false,
    birth_slot           = 0
WHERE NOT EXISTS (
  SELECT 1 FROM agent_stack a
  WHERE a.stack_id::text = s.id AND (a.units > 0 OR a.reaper > 0)
);

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
`;

writeFileSync("snapshot.sql", sql);
console.log(`\nWrote snapshot.sql (${rows.length} rows)`);
console.log("Run: cd kill-indexer && npx supabase db execute --file ../snapshot.sql");
