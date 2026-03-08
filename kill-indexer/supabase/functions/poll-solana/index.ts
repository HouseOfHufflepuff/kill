import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// ─── Constants ────────────────────────────────────────────────────────────────
const PROGRAM_ID = "2FbeFxvFH2b4KyAcwNToFr3pHzYK4ybYQWriXjjKEr5D";
const RPC_URL    = "https://api.devnet.solana.com";
const STATE_ID   = "solana-poll";

// Anchor event discriminators (for detecting relevant txns)
const DISC_EVENTS: Record<string, Uint8Array> = {
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

function hasKillEvent(logs: string[]): boolean {
  return logs.some(l => {
    if (!l.startsWith("Program data: ")) return false;
    const raw = Uint8Array.from(atob(l.slice(14)), c => c.charCodeAt(0));
    if (raw.length < 8) return false;
    return Object.values(DISC_EVENTS).some(d => d.every((v, i) => v === raw[i]));
  });
}

// ─── Snapshot: read ALL agentStack accounts from chain, upsert exact values ──
// deno-lint-ignore no-explicit-any
async function snapshotAgentStacks(db: any) {
  // AgentStack account discriminator = SHA256("account:AgentStack")[0:8]
  const hashBuf = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode("account:AgentStack"),
  );
  const discBytes = new Uint8Array(hashBuf).slice(0, 8);
  const discB58   = base58Encode(discBytes);

  const resp = await fetch(RPC_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0", id: 1,
      method: "getProgramAccounts",
      params: [PROGRAM_ID, {
        encoding: "base64",
        filters: [{ memcmp: { offset: 0, bytes: discB58 } }],
      }],
    }),
  });

  const { result: accounts, error } = await resp.json();
  if (error || !accounts) {
    console.error("getProgramAccounts failed:", error);
    return 0;
  }

  // AgentStack layout (after 8-byte discriminator):
  //   agent:    pubkey  (32 bytes) @ offset 8
  //   stack_id: u16     (2 bytes)  @ offset 40
  //   units:    u64     (8 bytes)  @ offset 42
  //   reapers:  u64     (8 bytes)  @ offset 50
  const rows = [];
  for (const { account } of accounts) {
    const data = Uint8Array.from(atob(account.data[0]), c => c.charCodeAt(0));
    if (data.length < 58) continue;
    const agent   = pubkey(data, 8);
    const stackId = u16(data, 40);
    const units   = u64(data, 42);
    const reapers = u64(data, 50);
    rows.push({
      id:       `${agent}-${stackId}`,
      agent,
      stack_id: stackId,
      units:    units.toString(),
      reaper:   reapers.toString(),
      birth_slot: 0,
    });
  }

  // Upsert in batches of 100
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
  if (!sigs || sigs.length === 0) return { processed: 0 };

  // Check if any new txn has a kill_game event
  let hasEvents = false;
  for (const { signature: sig, err } of sigs) {
    if (err) continue;
    const txResp = await fetch(RPC_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "getTransaction", params: [sig, { encoding: "json", maxSupportedTransactionVersion: 0, commitment: "confirmed" }] }),
    });
    const { result: tx } = await txResp.json();
    if (tx && hasKillEvent(tx.meta?.logMessages ?? [])) { hasEvents = true; break; }
  }

  let snapshotCount = 0;
  if (hasEvents) {
    // Snapshot entire on-chain agentStack state into DB
    snapshotCount = await snapshotAgentStacks(db);
  }

  // Advance checkpoint
  await db.from("indexer_state").upsert({
    id: STATE_ID,
    last_signature: sigs[0].signature,
    last_slot: sigs[0].slot,
    updated_at: new Date().toISOString(),
  });

  return { processed: snapshotCount, latest: sigs[0].signature };
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
