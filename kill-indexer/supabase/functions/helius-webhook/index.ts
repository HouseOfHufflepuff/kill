import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// ─── Constants ────────────────────────────────────────────────────────────────
const SPAWN_COST = 20_000_000n;   // per unit
const MOVE_COST  = 100_000_000n;  // flat per move
const BURN_BPS   = 666n;
const BPS_DENOM  = 10_000n;

// Anchor event discriminators (from IDL)
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
function u16(b: Uint8Array, o: number): number {
  return b[o] | (b[o + 1] << 8);
}
function u64(b: Uint8Array, o: number): bigint {
  return new DataView(b.buffer, b.byteOffset + o, 8).getBigUint64(0, true);
}
function pubkey(b: Uint8Array, o: number): string {
  return base58Encode(b.slice(o, o + 32));
}

// ─── Event parsing ────────────────────────────────────────────────────────────
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
      // Field layout (Borsh, after 8-byte discriminator):
      //   attacker(32) defender(32) attackerStack(2) defenderStack(2)
      //   attackerBounty(8) defenderBounty(8) totalBurned(8)
      //   remainingUnits(8) remainingReapers(8) slot(8)
      //   attackerUnitsSent(8) attackerReapersSent(8)
      //   attackerUnitsLost(8) attackerReapersLost(8)
      //   defenderUnits(8) defenderReapers(8)
      //   defenderUnitsLost(8) defenderReapersLost(8)
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

// ─── Helpers ──────────────────────────────────────────────────────────────────
function n(v: bigint): string { return v.toString(); }

// deno-lint-ignore no-explicit-any
async function updateGlobalStat(db: any, delta: {
  units_killed?: bigint; reapers_killed?: bigint;
  kill_added?: bigint; kill_extracted?: bigint; kill_burned?: bigint;
}) {
  const { data: existing } = await db.from("global_stat").select("*").eq("id", "current").maybeSingle();
  const cur = existing ?? {
    total_units_killed: "0", total_reaper_killed: "0",
    kill_added: "0", kill_extracted: "0", kill_burned: "0",
    total_pnl: "0", current_treasury: "0", max_bounty: "0",
  };
  const unitsKilled  = BigInt(cur.total_units_killed)  + (delta.units_killed   ?? 0n);
  const reapKilled   = BigInt(cur.total_reaper_killed) + (delta.reapers_killed ?? 0n);
  const killAdded    = BigInt(cur.kill_added)           + (delta.kill_added     ?? 0n);
  const killExtracted= BigInt(cur.kill_extracted)       + (delta.kill_extracted ?? 0n);
  const killBurned   = BigInt(cur.kill_burned)          + (delta.kill_burned    ?? 0n);
  const treasury     = killAdded - killExtracted - killBurned;
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

// deno-lint-ignore no-explicit-any
async function upsertAgentStack(db: any, agent: string, stackId: number, deltaUnits: bigint, deltaReapers: bigint, slot: bigint) {
  const id = `${agent}-${stackId}`;
  const { data: existing } = await db.from("agent_stack").select("*").eq("id", id).maybeSingle();
  const cur = existing ?? { units: "0", reaper: "0", birth_slot: 0 };
  const units  = BigInt(cur.units)  + deltaUnits;
  const reaper = BigInt(cur.reaper) + deltaReapers;
  const birthSlot = cur.birth_slot === 0 ? Number(slot) : cur.birth_slot;
  await db.from("agent_stack").upsert({ id, agent, stack_id: stackId, units: n(units), reaper: n(reaper), birth_slot: birthSlot });
}

// ─── Handlers ─────────────────────────────────────────────────────────────────
// deno-lint-ignore no-explicit-any
async function handleStackSpawned(db: any, sig: string, idx: number, e: Extract<AnchorEvent, { name: "StackSpawned" }>) {
  const id = `${sig}-${idx}`;
  await db.from("spawned").upsert({ id, agent: e.agent, stack_id: e.stackId, units: n(e.units), reapers: n(e.reapers), birth_slot: Number(e.slot), slot: Number(e.slot) });
  await upsertStack(db, e.stackId, e.units, e.reapers, e.slot);
  await upsertAgentStack(db, e.agent, e.stackId, e.units, e.reapers, e.slot);
  const spawnCost = e.units * SPAWN_COST;
  await upsertAgent(db, e.agent, spawnCost, 0n, e.slot);
  await updateGlobalStat(db, { kill_added: spawnCost });
}

// deno-lint-ignore no-explicit-any
async function handleStackMoved(db: any, sig: string, idx: number, e: Extract<AnchorEvent, { name: "StackMoved" }>) {
  const id = `${sig}-${idx}`;
  await db.from("moved").upsert({ id, agent: e.agent, from_stack: e.fromStack, to_stack: e.toStack, units: n(e.units), reaper: n(e.reapers), birth_slot: Number(e.slot), slot: Number(e.slot) });
  await upsertStack(db, e.fromStack, -e.units, -e.reapers, e.slot);
  await upsertStack(db, e.toStack,    e.units,  e.reapers, e.slot);
  await upsertAgentStack(db, e.agent, e.fromStack, -e.units, -e.reapers, e.slot);
  await upsertAgentStack(db, e.agent, e.toStack,    e.units,  e.reapers, e.slot);
  await upsertAgent(db, e.agent, MOVE_COST, 0n, e.slot);
}

// deno-lint-ignore no-explicit-any
async function handleKillEvent(db: any, sig: string, idx: number, e: Extract<AnchorEvent, { name: "KillEvent" }>) {
  const id = `${sig}-${idx}`;

  // Write immutable event record
  await db.from("killed").upsert({
    id, attacker: e.attacker, target: e.defender,
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

  // attacker_stack_id == defender_stack_id (same grid position, required by contract)
  // Apply net unit deltas to the shared grid position
  const atkDeltaUnits   = e.remainingUnits   - e.attackerUnitsSent;
  const atkDeltaReapers = e.remainingReapers - e.attackerReapersSent;
  const netDeltaUnits   = atkDeltaUnits   - e.defenderUnitsLost;
  const netDeltaReapers = atkDeltaReapers - e.defenderReapersLost;
  await upsertStack(db, e.defenderStack, netDeltaUnits, netDeltaReapers, e.slot);

  // Per-agent stack updates (delta-based so other agents at same position are unaffected)
  await upsertAgentStack(db, e.defender, e.defenderStack, -e.defenderUnitsLost, -e.defenderReapersLost, e.slot);
  await upsertAgentStack(db, e.attacker, e.attackerStack,  atkDeltaUnits,        atkDeltaReapers,        e.slot);

  // Agent P&L
  await upsertAgent(db, e.attacker, 0n, e.attackerBounty, e.slot);
  if (e.defenderBounty > 0n) {
    await upsertAgent(db, e.defender, 0n, e.defenderBounty, e.slot);
  }

  // Global stats
  await updateGlobalStat(db, {
    units_killed:   e.defenderUnitsLost,
    reapers_killed: e.defenderReapersLost,
    kill_extracted: e.attackerBounty + e.defenderBounty,
    kill_burned:    e.totalBurned,
  });
}

// ─── Main handler ─────────────────────────────────────────────────────────────
Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return new Response("ok", { status: 200 });

  const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

  const txns = await req.json();
  if (!Array.isArray(txns)) return new Response("bad payload", { status: 400 });

  for (const txn of txns) {
    const sig  = txn.transaction?.signatures?.[0] ?? txn.signature ?? "unknown";
    const logs: string[] = txn.meta?.logMessages ?? txn.logs ?? [];
    const events = parseEvents(logs);

    let idx = 0;
    for (const event of events) {
      try {
        if (event.name === "StackSpawned") await handleStackSpawned(db, sig, idx, event);
        if (event.name === "StackMoved")   await handleStackMoved(db, sig, idx, event);
        if (event.name === "KillEvent")    await handleKillEvent(db, sig, idx, event);
        idx++;
      } catch (err) {
        console.error(`Error processing ${event.name} in ${sig}:`, err);
      }
    }
  }

  return new Response("ok", { status: 200 });
});
