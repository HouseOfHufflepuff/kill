// catchup.mjs
// Scans recent on-chain transactions for a wallet, finds any kill/spawn/move
// events not yet indexed in Supabase, and replays them through the webhook.
//
// Usage: node kill-indexer/catchup.mjs [wallet] [--limit N]
//   wallet  : Solana pubkey to scan (default: reads AGENT_PK from ../.env)
//   --limit : how many recent txs to check (default: 50)
//
// Run from the kill root directory.

import { readFileSync } from "fs";
import { createRequire } from "module";

const require = createRequire(import.meta.url);

// ── Config ────────────────────────────────────────────────────────────────────
const RPC_URL       = "https://api.devnet.solana.com";
const WEBHOOK_URL   = "https://jclsklriyozveiykzead.supabase.co/functions/v1/helius-webhook";
const SUPABASE_URL  = "https://jclsklriyozveiykzead.supabase.co";
const SUPABASE_ANON = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImpjbHNrbHJpeW96dmVpeWt6ZWFkIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzI3NDQzOTUsImV4cCI6MjA4ODMyMDM5NX0.ka7UCBzLiZNvU5WKPWmpB7x7xM99thukFwtBGRvr-I8";
const PROGRAM_ID    = "2FbeFxvFH2b4KyAcwNToFr3pHzYK4ybYQWriXjjKEr5D";

// Anchor event discriminators
const DISC = {
  StackSpawned: Uint8Array.from([27, 133, 103, 92, 20, 214, 249, 63]),
  StackMoved:   Uint8Array.from([78, 213, 63, 208, 104, 231, 129, 219]),
  KillEvent:    Uint8Array.from([89, 236, 104, 94, 142, 191, 62, 138]),
};

// ── Args ──────────────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
let walletArg = args.find(a => !a.startsWith("--"));
const limitArg = args.indexOf("--limit");
const limit = limitArg !== -1 ? parseInt(args[limitArg + 1]) : 50;

// Resolve wallet pubkey
let wallet;
if (walletArg) {
  wallet = walletArg;
} else {
  // Try to read from .env
  try {
    const env = readFileSync(".env", "utf8");
    const match = env.match(/AGENT_PK\s*=\s*(.+)/);
    if (match) {
      const { Keypair } = require("@solana/web3.js");
      wallet = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(match[1].trim()))).publicKey.toBase58();
    }
  } catch {}
}

if (!wallet) {
  console.error("Usage: node kill-indexer/catchup.mjs [wallet-pubkey] [--limit N]");
  console.error("  Or set AGENT_PK in .env");
  process.exit(1);
}

console.log(`Scanning wallet : ${wallet}`);
console.log(`Checking last   : ${limit} transactions\n`);

// ── Helpers ───────────────────────────────────────────────────────────────────
async function rpc(method, params) {
  const r = await fetch(RPC_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  const j = await r.json();
  return j.result;
}

function hasAnchorEvent(logs) {
  return logs.some(l => {
    if (!l.startsWith("Program data: ")) return false;
    const raw = Buffer.from(l.slice(14), "base64");
    if (raw.length < 8) return false;
    return Object.values(DISC).some(d => d.every((v, i) => v === raw[i]));
  });
}

function eventNames(logs) {
  const names = [];
  for (const l of logs) {
    if (!l.startsWith("Program data: ")) continue;
    const raw = Buffer.from(l.slice(14), "base64");
    if (raw.length < 8) continue;
    for (const [name, d] of Object.entries(DISC)) {
      if (d.every((v, i) => v === raw[i])) names.push(name);
    }
  }
  return names;
}

async function isIndexed(sig) {
  // Check spawned, moved, and killed tables for this sig as id prefix
  const tables = ["spawned", "moved", "killed"];
  for (const table of tables) {
    const r = await fetch(
      `${SUPABASE_URL}/rest/v1/${table}?id=like.${sig}*&select=id&limit=1`,
      { headers: { apikey: SUPABASE_ANON, Authorization: `Bearer ${SUPABASE_ANON}` } }
    );
    const rows = await r.json();
    if (Array.isArray(rows) && rows.length > 0) return true;
  }
  return false;
}

async function replay(sig, logs) {
  const payload = [{
    signature: sig,
    transaction: { signatures: [sig] },
    meta: { logMessages: logs },
    logs,
  }];
  const r = await fetch(WEBHOOK_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${SUPABASE_ANON}`,
      apikey: SUPABASE_ANON,
    },
    body: JSON.stringify(payload),
  });
  return r.status;
}

// ── Main ──────────────────────────────────────────────────────────────────────
const sigs = await rpc("getSignaturesForAddress", [wallet, { limit, commitment: "finalized" }]);
console.log(`Found ${sigs.length} recent transactions. Checking for Anchor events...\n`);

let checked = 0, replayed = 0, skipped = 0, failed = 0;

for (const { signature: sig, err, slot } of sigs) {
  if (err) continue; // skip failed txs

  // Fetch tx to get logs
  const tx = await rpc("getTransaction", [
    sig,
    { encoding: "json", maxSupportedTransactionVersion: 0, commitment: "finalized" },
  ]);
  if (!tx) continue;

  const logs = tx.meta?.logMessages ?? [];
  if (!hasAnchorEvent(logs)) continue; // no indexable events

  checked++;
  const names = eventNames(logs);
  const already = await isIndexed(sig);

  if (already) {
    skipped++;
    console.log(`  SKIP   slot:${slot} [${names.join("+")}] ${sig.slice(0, 20)}...`);
    continue;
  }

  const status = await replay(sig, logs);
  if (status === 200) {
    replayed++;
    console.log(`  REPLAY slot:${slot} [${names.join("+")}] ${sig.slice(0, 20)}... → ${status} ok`);
  } else {
    failed++;
    console.log(`  FAIL   slot:${slot} [${names.join("+")}] ${sig.slice(0, 20)}... → ${status}`);
  }
}

console.log(`\nDone. ${checked} events checked | ${replayed} replayed | ${skipped} already indexed | ${failed} failed`);
