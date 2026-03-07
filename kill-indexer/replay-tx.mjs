// replay-tx.mjs
// Fetches a transaction from devnet and replays it through the Supabase webhook.
// Usage: node kill-indexer/replay-tx.mjs <signature>

const sig = process.argv[2];
if (!sig) { console.error("Usage: node kill-indexer/replay-tx.mjs <signature>"); process.exit(1); }

const RPC_URL        = "https://api.devnet.solana.com";
const WEBHOOK_URL    = "https://jclsklriyozveiykzead.supabase.co/functions/v1/helius-webhook";
const SUPABASE_ANON  = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImpjbHNrbHJpeW96dmVpeWt6ZWFkIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzI3NDQzOTUsImV4cCI6MjA4ODMyMDM5NX0.ka7UCBzLiZNvU5WKPWmpB7x7xM99thukFwtBGRvr-I8";

// 1. Fetch the transaction from devnet
const rpcResp = await fetch(RPC_URL, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    jsonrpc: "2.0", id: 1, method: "getTransaction",
    params: [sig, { encoding: "json", maxSupportedTransactionVersion: 0, commitment: "finalized" }]
  })
});
const { result: tx } = await rpcResp.json();
if (!tx) { console.error("Transaction not found or not finalized yet"); process.exit(1); }

// 2. Format as Helius enhanced-transaction webhook payload
const payload = [{
  signature: sig,
  transaction: { signatures: [sig] },
  meta: { logMessages: tx.meta?.logMessages ?? [] },
  logs: tx.meta?.logMessages ?? [],
}];

console.log(`Replaying tx: ${sig}`);
console.log(`Log lines   : ${payload[0].meta.logMessages.length}`);

// 3. POST to the edge function
const webhookResp = await fetch(WEBHOOK_URL, {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    "Authorization": `Bearer ${SUPABASE_ANON}`,
    "apikey": SUPABASE_ANON,
  },
  body: JSON.stringify(payload),
});

const body = await webhookResp.text();
console.log(`Webhook response: ${webhookResp.status} ${body}`);
