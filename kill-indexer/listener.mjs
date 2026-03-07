// listener.mjs
// Real-time Solana program log listener.
// Subscribes to kill_game logs via WebSocket and forwards events to the
// Supabase edge function immediately on confirmation — no Helius webhook delay.
//
// Usage: node kill-indexer/listener.mjs
// Run from the kill root directory. Keep running alongside the agent.

const PROGRAM_ID   = "2FbeFxvFH2b4KyAcwNToFr3pHzYK4ybYQWriXjjKEr5D";
const WS_URL       = "wss://devnet.helius-rpc.com/?api-key=fbda4008-03a0-4aad-8f64-c54e7fd9147e";
const WEBHOOK_URL  = "https://jclsklriyozveiykzead.supabase.co/functions/v1/helius-webhook";
const SUPABASE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImpjbHNrbHJpeW96dmVpeWt6ZWFkIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzI3NDQzOTUsImV4cCI6MjA4ODMyMDM5NX0.ka7UCBzLiZNvU5WKPWmpB7x7xM99thukFwtBGRvr-I8";

// Anchor event discriminators — used to filter logs worth forwarding
const DISCS = [
  [27, 133, 103, 92, 20, 214, 249, 63],   // StackSpawned
  [78, 213, 63, 208, 104, 231, 129, 219], // StackMoved
  [89, 236, 104, 94, 142, 191, 62, 138],  // KillEvent
];

function hasAnchorEvent(logs) {
  for (const log of logs) {
    if (!log.startsWith("Program data: ")) continue;
    const raw = Buffer.from(log.slice(14), "base64");
    if (raw.length < 8) continue;
    if (DISCS.some(d => d.every((v, i) => v === raw[i]))) return true;
  }
  return false;
}

async function forward(sig, logs) {
  const payload = [{ signature: sig, transaction: { signatures: [sig] }, logs }];
  try {
    const r = await fetch(WEBHOOK_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${SUPABASE_KEY}`,
        "apikey": SUPABASE_KEY,
      },
      body: JSON.stringify(payload),
    });
    console.log(`  → forwarded ${sig.slice(0, 20)}... [${r.status}]`);
  } catch (e) {
    console.error(`  → forward failed: ${e.message}`);
  }
}

function connect() {
  console.log(`Connecting to ${WS_URL.split("?")[0]}...`);
  const ws = new WebSocket(WS_URL);

  ws.addEventListener("open", () => {
    console.log("Connected. Subscribing to program logs...\n");
    ws.send(JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "logsSubscribe",
      params: [
        { mentions: [PROGRAM_ID] },
        { commitment: "confirmed" },
      ],
    }));
  });

  ws.addEventListener("message", ({ data }) => {
    const msg = JSON.parse(data);

    // Subscription confirmed
    if (msg.id === 1 && msg.result !== undefined) {
      console.log(`Subscribed (id: ${msg.result}). Listening for kill_game events...\n`);
      return;
    }

    // Log notification
    if (msg.method !== "logsNotification") return;
    const value = msg.params?.result?.value;
    if (!value || value.err) return; // skip failed txs

    const { signature: sig, logs } = value;
    if (!hasAnchorEvent(logs)) return; // skip non-game txs

    console.log(`Event: ${sig.slice(0, 20)}...`);
    forward(sig, logs);
  });

  ws.addEventListener("error", e => console.error("WS error:", e.message));

  ws.addEventListener("close", ({ code, reason }) => {
    console.log(`\nDisconnected (${code} ${reason}). Reconnecting in 3s...`);
    setTimeout(connect, 3000);
  });
}

connect();
