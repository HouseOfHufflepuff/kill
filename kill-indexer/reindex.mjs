// reindex.mjs
// Scans ALL kill_game program transactions on-chain and replays them through
// the ingest edge function, oldest first.
//
// Safe to run multiple times — the webhook deduplicates by signature so
// nothing gets double-counted.
//
// Usage (from kill root):
//   node kill-indexer/reindex.mjs [--limit N]
//
// --limit N : max signatures to fetch per page (default 1000, max 1000)
//             Total history is paginated automatically.

const PROGRAM_ID   = "2FbeFxvFH2b4KyAcwNToFr3pHzYK4ybYQWriXjjKEr5D";
const RPC_URL      = "https://api.devnet.solana.com";
const WEBHOOK_URL  = "https://jclsklriyozveiykzead.supabase.co/functions/v1/ingest";
const SUPABASE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImpjbHNrbHJpeW96dmVpeWt6ZWFkIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzI3NDQzOTUsImV4cCI6MjA4ODMyMDM5NX0.ka7UCBzLiZNvU5WKPWmpB7x7xM99thukFwtBGRvr-I8";

const DISC = [
  [27, 133, 103, 92, 20, 214, 249, 63],   // StackSpawned
  [78, 213, 63, 208, 104, 231, 129, 219], // StackMoved
  [89, 236, 104, 94, 142, 191, 62, 138],  // KillEvent
];

const args      = process.argv.slice(2);
const limitArg  = args.indexOf("--limit");
const PAGE_SIZE = limitArg !== -1 ? Math.min(parseInt(args[limitArg + 1]) || 1000, 1000) : 1000;

async function rpc(method, params, retries = 4) {
  for (let attempt = 0; attempt <= retries; attempt++) {
    const r = await fetch(RPC_URL, {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    });
    const j = await r.json();
    if (j.error?.code === 429) {
      if (attempt === retries) throw new Error(`RPC error: ${JSON.stringify(j.error)}`);
      await sleep(1000 * (attempt + 1)); // exponential back-off: 1s, 2s, 3s, 4s
      continue;
    }
    if (j.error) throw new Error(`RPC error: ${JSON.stringify(j.error)}`);
    return j.result;
  }
}

function hasAnchorEvent(logs) {
  return logs.some(l => {
    if (!l.startsWith("Program data: ")) return false;
    const raw = Buffer.from(l.slice(14), "base64");
    if (raw.length < 8) return false;
    return DISC.some(d => d.every((v, i) => v === raw[i]));
  });
}

async function forward(sig, logs) {
  const payload = [{ signature: sig, transaction: { signatures: [sig] }, meta: { logMessages: logs }, logs }];
  const r = await fetch(WEBHOOK_URL, {
    method:  "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${SUPABASE_KEY}`, apikey: SUPABASE_KEY },
    body:    JSON.stringify(payload),
  });
  return r.status;
}

async function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// ── Collect all program signatures (paginated, newest→oldest) ─────────────────
console.log(`Fetching ALL signatures for program ${PROGRAM_ID}...`);
const allSigs = [];
let before = null;
let page = 0;

while (true) {
  const params = [PROGRAM_ID, { limit: PAGE_SIZE, commitment: "finalized" }];
  if (before) params[1].before = before;

  const batch = await rpc("getSignaturesForAddress", params);
  if (!batch || batch.length === 0) break;

  const valid = batch.filter(s => !s.err);
  allSigs.push(...valid);
  page++;
  console.log(`  Page ${page}: ${batch.length} sigs (${valid.length} successful) — total so far: ${allSigs.length}`);

  if (batch.length < PAGE_SIZE) break; // last page
  before = batch[batch.length - 1].signature;
  await sleep(200); // avoid RPC rate limit
}

console.log(`\nTotal signatures to process: ${allSigs.length} (oldest first)\n`);

// Reverse so we process oldest first (maintains correct delta order)
allSigs.reverse();

let processed = 0, skipped = 0, failed = 0;

for (let i = 0; i < allSigs.length; i++) {
  const { signature: sig, slot } = allSigs[i];

  // Fetch full tx to get logs
  let tx;
  try {
    tx = await rpc("getTransaction", [
      sig,
      { encoding: "json", maxSupportedTransactionVersion: 0, commitment: "finalized" },
    ]);
  } catch (e) {
    console.log(`  SKIP   [${i+1}/${allSigs.length}] slot:${slot} fetch error: ${e.message}`);
    skipped++;
    continue;
  }
  if (!tx) { skipped++; continue; }

  const logs = tx.meta?.logMessages ?? [];
  if (!hasAnchorEvent(logs)) { skipped++; continue; }

  const status = await forward(sig, logs);
  if (status === 200) {
    processed++;
    console.log(`  OK     [${i+1}/${allSigs.length}] slot:${slot} ${sig.slice(0, 20)}...`);
  } else if (status === 409) {
    // 409 = conflict = already in processed_sigs (shouldn't happen after truncate, but safe)
    skipped++;
    console.log(`  SKIP   [${i+1}/${allSigs.length}] slot:${slot} already indexed`);
  } else {
    failed++;
    console.log(`  FAIL   [${i+1}/${allSigs.length}] slot:${slot} ${sig.slice(0, 20)}... → ${status}`);
  }

  // Pace RPC + webhook calls
  if ((i + 1) % 10 === 0) await sleep(100);
}

console.log(`\n✓ Reindex complete`);
console.log(`  Processed : ${processed}`);
console.log(`  Skipped   : ${skipped} (no events or already indexed)`);
console.log(`  Failed    : ${failed}`);
