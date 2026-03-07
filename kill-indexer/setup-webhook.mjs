// node kill-indexer/setup-webhook.mjs
// Creates (or lists) the Helius webhook for the kill_game program on devnet.
// Run from the kill root directory.

const API_KEY      = "fbda4008-03a0-4aad-8f64-c54e7fd9147e";
const PROGRAM_ID   = "2FbeFxvFH2b4KyAcwNToFr3pHzYK4ybYQWriXjjKEr5D";
const WEBHOOK_URL  = "https://jclsklriyozveiykzead.supabase.co/functions/v1/helius-webhook";
const BASE         = `https://api-devnet.helius.xyz/v0/webhooks?api-key=${API_KEY}`;

// List existing webhooks
const listRes  = await fetch(BASE);
const existing = await listRes.json();
console.log(`Existing webhooks (${existing.length}):`);
existing.forEach(w => console.log(`  ${w.webhookID}  ${w.webhookURL}`));

// Check if our webhook already exists
const already = existing.find(w => w.webhookURL === WEBHOOK_URL);
if (already) {
    console.log(`\nWebhook already registered: ${already.webhookID}`);
    process.exit(0);
}

// Create
const body = {
    webhookURL:       WEBHOOK_URL,
    transactionTypes: ["Any"],
    accountAddresses: [PROGRAM_ID],
    webhookType:      "enhanced",
    txnStatus:        "all",
};

const createRes = await fetch(BASE, {
    method:  "POST",
    headers: { "Content-Type": "application/json" },
    body:    JSON.stringify(body),
});
const result = await createRes.json();

if (result.webhookID) {
    console.log(`\nWebhook created: ${result.webhookID}`);
    console.log(`  URL     : ${result.webhookURL}`);
    console.log(`  Accounts: ${result.accountAddresses}`);
} else {
    console.error("\nFailed:", JSON.stringify(result, null, 2));
}
