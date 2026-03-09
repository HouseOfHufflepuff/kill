import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// ─── Constants ────────────────────────────────────────────────────────────────
const PROGRAM_ID = "2FbeFxvFH2b4KyAcwNToFr3pHzYK4ybYQWriXjjKEr5D";
const RPC_URL    = "https://api.devnet.solana.com";
const STATE_ID   = "solana-poll";
const SPAWN_COST = 20_000_000n;
const MOVE_COST  = 100_000_000n;

// Anchor event discriminators
const DISC: Record<string, Uint8Array> = {
  StackSpawned: new Uint8Array([27, 133, 103, 92, 20, 214, 249, 63]),
  StackMoved:   new Uint8Array([78, 213, 63, 208, 104, 231, 129, 219]),
  KillEvent:    new Uint8Array([89, 236, 104, 94, 142, 191, 62, 138]),
};

// ─── Base58 ───────────────────────────────────────────────────────────────────
const ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
function base58Encode(bytes: Uint8Array): string {
  let x = 0n;
  for (const b of bytes) x = x * 256n + BigInt(b);
  let result = "";
  while (x > 0n) { result = ALPHABET[Number(x % 58n)] + result; x /= 58n; }
  for (const b of bytes) { if (b !== 0) break; result = "1" + result; }
  return result;
}

// ─── Borsh readers ────────────────────────────────────────────────────────────
function u16(b: Uint8Array, o: number): number { return b[o] | (b[o + 1] << 8); }
function u64(b: Uint8Array, o: number): bigint {
  return new DataView(b.buffer, b.byteOffset + o, 8).getBigUint64(0, true);
}
function pubkey(b: Uint8Array, o: number): string { return base58Encode(b.slice(o, o + 32)); }
function n(v: bigint): string { return v.toString(); }

// ─── Event types ──────────────────────────────────────────────────────────────
type AnchorEvent =
  | { name: "StackSpawned"; agent: string; stackId: number; units: bigint; reapers: bigint; slot: bigint }
  | { name: "StackMoved";   agent: string; fromStack: number; toStack: number; units: bigint; reapers: bigint; slot: bigint }
  | { name: "KillEvent";    attacker: string; defender: string; attackerStack: number; defenderStack: number; attackerBounty: bigint; defenderBounty: bigint; totalBurned: bigint; remainingUnits: bigint; remainingReapers: bigint; slot: bigint; attackerUnitsSent: bigint; attackerReapersSent: bigint; attackerUnitsLost: bigint; attackerReapersLost: bigint; defenderUnits: bigint; defenderReapers: bigint; defenderUnitsLost: bigint; defenderReapersLost: bigint };

function parseEvents(logs: string[]): AnchorEvent[] {
  const events: AnchorEvent[] = [];
  for (const log of logs) {
    if (!log.startsWith("Program data: ")) continue;
    const raw = Uint8Array.from(atob(log.slice(14)), c => c.charCodeAt(0));
    if (raw.length < 8) continue;
    const disc = raw.slice(0, 8);

    if (disc.every((v, i) => v === DISC.StackSpawned[i])) {
      const d = raw.slice(8);
      events.push({ name: "StackSpawned", agent: pubkey(d, 0), stackId: u16(d, 32), units: u64(d, 34), reapers: u64(d, 42), slot: u64(d, 50) });
    } else if (disc.every((v, i) => v === DISC.StackMoved[i])) {
      const d = raw.slice(8);
      events.push({ name: "StackMoved", agent: pubkey(d, 0), fromStack: u16(d, 32), toStack: u16(d, 34), units: u64(d, 36), reapers: u64(d, 44), slot: u64(d, 52) });
    } else if (disc.every((v, i) => v === DISC.KillEvent[i])) {
      const d = raw.slice(8);
      events.push({
        name: "KillEvent",
        attacker:            pubkey(d,   0),
        defender:            pubkey(d,  32),
        attackerStack:       u16(d,   64),
        defenderStack:       u16(d,   66),
        attackerBounty:      u64(d,   68),
        defenderBounty:      u64(d,   76),
        totalBurned:         u64(d,   84),
        remainingUnits:      u64(d,   92),
        remainingReapers:    u64(d,  100),
        slot:                u64(d,  108),
        attackerUnitsSent:   u64(d,  116),
        attackerReapersSent: u64(d,  124),
        attackerUnitsLost:   u64(d,  132),
        attackerReapersLost: u64(d,  140),
        defenderUnits:       u64(d,  148),
        defenderReapers:     u64(d,  156),
        defenderUnitsLost:   u64(d,  164),
        defenderReapersLost: u64(d,  172),
      });
    }
  }
  return events;
}

// ─── DB helpers ───────────────────────────────────────────────────────────────
// deno-lint-ignore no-explicit-any
async function updateGlobalStat(db: any, delta: {
  units_killed?: bigint; reapers_killed?: bigint;
  kill_added?: bigint; kill_extracted?: bigint; kill_burned?: bigint;
}) {
  const { data: existing } = await db.from("global_stat").select("*").eq("id", "current").maybeSingle();
  const cur = existing ?? { total_units_killed: "0", total_reaper_killed: "0", kill_added: "0", kill_extracted: "0", kill_burned: "0" };
  const unitsKilled   = BigInt(cur.total_units_killed)  + (delta.units_killed   ?? 0n);
  const reapKilled    = BigInt(cur.total_reaper_killed) + (delta.reapers_killed ?? 0n);
  const killAdded     = BigInt(cur.kill_added)           + (delta.kill_added     ?? 0n);
  const killExtracted = BigInt(cur.kill_extracted)       + (delta.kill_extracted ?? 0n);
  const killBurned    = BigInt(cur.kill_burned)          + (delta.kill_burned    ?? 0n);
  const treasury      = killAdded - killExtracted - killBurned;
  await db.from("global_stat").upsert({
    id: "current",
    total_units_killed:  n(unitsKilled),
    total_reaper_killed: n(reapKilled),
    kill_added:          n(killAdded),
    kill_extracted:      n(killExtracted),
    kill_burned:         n(killBurned),
    current_treasury:    n(treasury > 0n ? treasury : 0n),
    total_pnl:           n(killExtracted),
    max_bounty:          "0",
  });
}

// deno-lint-ignore no-explicit-any
async function upsertAgent(db: any, id: string, spent: bigint, earned: bigint, slot: bigint) {
  const { data: existing } = await db.from("agent").select("*").eq("id", id).maybeSingle();
  const cur = existing ?? { total_spent: "0", total_earned: "0", net_pnl: "0", last_active_slot: 0 };
  const totalSpent  = BigInt(cur.total_spent)  + spent;
  const totalEarned = BigInt(cur.total_earned) + earned;
  await db.from("agent").upsert({ id, total_spent: n(totalSpent), total_earned: n(totalEarned), net_pnl: n(totalEarned - totalSpent), last_active_slot: Number(slot) });
}

// deno-lint-ignore no-explicit-any
async function upsertStack(db: any, stackId: number, deltaUnits: bigint, deltaReapers: bigint, slot: bigint) {
  const id = stackId.toString();
  const { data: existing } = await db.from("stack").select("*").eq("id", id).maybeSingle();
  const cur = existing ?? { total_standard_units: "0", total_boosted_units: "0", birth_slot: 0, active: false };
  const units   = BigInt(cur.total_standard_units) + deltaUnits;
  const reapers = BigInt(cur.total_boosted_units)  + deltaReapers;
  const birthSlot = cur.birth_slot === 0 ? Number(slot) : cur.birth_slot;
  const active = units > 0n || reapers > 0n;
  await db.from("stack").upsert({ id, total_standard_units: n(units), total_boosted_units: n(reapers), birth_slot: active ? birthSlot : 0, active });
}

// ─── Event handlers ───────────────────────────────────────────────────────────
// deno-lint-ignore no-explicit-any
async function handleStackSpawned(db: any, sig: string, idx: number, e: Extract<AnchorEvent, { name: "StackSpawned" }>) {
  await db.from("spawned").upsert({ id: `${sig}-${idx}`, agent: e.agent, stack_id: e.stackId, units: n(e.units), reapers: n(e.reapers), birth_slot: Number(e.slot), slot: Number(e.slot) });
  await upsertStack(db, e.stackId, e.units, e.reapers, e.slot);
  await upsertAgent(db, e.agent, e.units * SPAWN_COST, 0n, e.slot);
  await updateGlobalStat(db, { kill_added: e.units * SPAWN_COST });
}

// deno-lint-ignore no-explicit-any
async function handleStackMoved(db: any, sig: string, idx: number, e: Extract<AnchorEvent, { name: "StackMoved" }>) {
  await db.from("moved").upsert({ id: `${sig}-${idx}`, agent: e.agent, from_stack: e.fromStack, to_stack: e.toStack, units: n(e.units), reaper: n(e.reapers), birth_slot: Number(e.slot), slot: Number(e.slot) });
  await upsertStack(db, e.fromStack, -e.units, -e.reapers, e.slot);
  await upsertStack(db, e.toStack,    e.units,  e.reapers, e.slot);
  await upsertAgent(db, e.agent, MOVE_COST, 0n, e.slot);
  await updateGlobalStat(db, { kill_added: MOVE_COST });
}

// deno-lint-ignore no-explicit-any
async function handleKillEvent(db: any, sig: string, idx: number, e: Extract<AnchorEvent, { name: "KillEvent" }>) {
  await db.from("killed").upsert({
    id: `${sig}-${idx}`,
    attacker: e.attacker, target: e.defender,
    stack_id:                e.defenderStack,
    attacker_units_sent:     n(e.attackerUnitsSent),
    attacker_reaper_sent:    n(e.attackerReapersSent),
    attacker_units_lost:     n(e.attackerUnitsLost),
    attacker_reaper_lost:    n(e.attackerReapersLost),
    target_units_lost:       n(e.defenderUnitsLost),
    target_reaper_lost:      n(e.defenderReapersLost),
    initial_defender_units:  n(e.defenderUnits),
    initial_defender_reaper: n(e.defenderReapers),
    attacker_bounty:         n(e.attackerBounty),
    defender_bounty:         n(e.defenderBounty),
    total_burned:            n(e.totalBurned),
    target_birth_slot: 0, slot: Number(e.slot),
  });
  const atkDeltaUnits   = e.remainingUnits   - e.attackerUnitsSent;
  const atkDeltaReapers = e.remainingReapers - e.attackerReapersSent;
  await upsertStack(db, e.defenderStack, atkDeltaUnits - e.defenderUnitsLost, atkDeltaReapers - e.defenderReapersLost, e.slot);
  await upsertAgent(db, e.attacker, 0n, e.attackerBounty, e.slot);
  if (e.defenderBounty > 0n) await upsertAgent(db, e.defender, 0n, e.defenderBounty, e.slot);
  await updateGlobalStat(db, {
    units_killed:   e.defenderUnitsLost,
    reapers_killed: e.defenderReapersLost,
    kill_extracted: e.attackerBounty + e.defenderBounty,
    kill_burned:    e.totalBurned,
  });
}

// ─── Snapshot: read ALL agentStack accounts, upsert exact on-chain values ─────
// deno-lint-ignore no-explicit-any
async function snapshotAgentStacks(db: any): Promise<number> {
  const hashBuf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode("account:AgentStack"));
  const discBytes = new Uint8Array(hashBuf).slice(0, 8);
  const discB58   = base58Encode(discBytes);

  const resp = await fetch(RPC_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0", id: 1,
      method: "getProgramAccounts",
      params: [PROGRAM_ID, { encoding: "base64", filters: [{ memcmp: { offset: 0, bytes: discB58 } }] }],
    }),
  });
  const { result: accounts, error } = await resp.json();
  if (error || !accounts) { console.error("getProgramAccounts failed:", error); return 0; }

  // AgentStack layout (after 8-byte discriminator):
  //   agent: pubkey (32) @ 8, stack_id: u16 (2) @ 40, units: u64 (8) @ 42, reapers: u64 (8) @ 50
  const rows = [];
  for (const { account } of accounts) {
    const data = Uint8Array.from(atob(account.data[0]), c => c.charCodeAt(0));
    if (data.length < 58) continue;
    const agent   = pubkey(data, 8);
    const stackId = u16(data, 40);
    const units   = u64(data, 42);
    const reapers = u64(data, 50);
    rows.push({ id: `${agent}-${stackId}`, agent, stack_id: stackId, units: n(units), reaper: n(reapers), birth_slot: 0 });
  }

  for (let i = 0; i < rows.length; i += 100) {
    const { error: upsertErr } = await db.from("agent_stack").upsert(rows.slice(i, i + 100));
    if (upsertErr) console.error("agent_stack upsert error:", upsertErr.message);
  }
  return rows.length;
}

// ─── Core poll logic ──────────────────────────────────────────────────────────
async function poll() {
  const db = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  // Get checkpoint
  const { data: state } = await db.from("indexer_state").select("*").eq("id", STATE_ID).maybeSingle();
  const lastSig: string | null = state?.last_signature ?? null;

  // Fetch new signatures since checkpoint
  // deno-lint-ignore no-explicit-any
  const sigParams: any = [PROGRAM_ID, { limit: 100, commitment: "confirmed" }];
  if (lastSig) sigParams[1].until = lastSig;

  const sigsResp = await fetch(RPC_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "getSignaturesForAddress", params: sigParams }),
  });
  const { result: sigs } = await sigsResp.json();
  if (!sigs || sigs.length === 0) return { events: 0, snapshot: 0 };

  let hasEvents   = false;
  let eventsTotal = 0;

  for (const { signature: sig, err } of sigs) {
    if (err) continue;

    // Dedup: skip if already processed
    const { error: dedupErr } = await db.from("processed_sigs").insert({ sig });
    if (dedupErr) {
      if (dedupErr.code === "23505") continue; // already processed
      console.error(`processed_sigs insert failed for ${sig}:`, dedupErr.message);
      // fall through — safer to risk duplicate than to miss an event
    }

    const txResp = await fetch(RPC_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "getTransaction", params: [sig, { encoding: "json", maxSupportedTransactionVersion: 0, commitment: "confirmed" }] }),
    });
    const { result: tx } = await txResp.json();
    if (!tx) continue;

    const events = parseEvents(tx.meta?.logMessages ?? []);
    if (events.length === 0) continue;

    hasEvents = true;
    let idx = 0;
    for (const event of events) {
      try {
        if (event.name === "StackSpawned") await handleStackSpawned(db, sig, idx, event);
        if (event.name === "StackMoved")   await handleStackMoved(db, sig, idx, event);
        if (event.name === "KillEvent")    await handleKillEvent(db, sig, idx, event);
        idx++;
        eventsTotal++;
      } catch (e) {
        console.error(`Error processing ${event.name} in ${sig}:`, e);
      }
    }
  }

  // Snapshot agent_stack from chain for ground-truth correctness,
  // then rebuild stack aggregates to match (prevents drift from event delta errors)
  let snapshotCount = 0;
  if (hasEvents) {
    snapshotCount = await snapshotAgentStacks(db);
    await db.rpc('rebuild_stack_from_agent_stack');
  }

  // Advance checkpoint
  await db.from("indexer_state").upsert({
    id: STATE_ID,
    last_signature: sigs[0].signature,
    last_slot: sigs[0].slot,
    updated_at: new Date().toISOString(),
  });

  return { events: eventsTotal, snapshot: snapshotCount, latest: sigs[0].signature };
}

// ─── HTTP handler ─────────────────────────────────────────────────────────────
Deno.serve(async (req: Request) => {
  if (req.method !== "POST" && req.method !== "GET") return new Response("ok", { status: 200 });
  try {
    const result = await poll();
    return new Response(JSON.stringify(result), { headers: { "Content-Type": "application/json" } });
  } catch (err) {
    console.error("Poll error:", err);
    return new Response("error", { status: 500 });
  }
});
