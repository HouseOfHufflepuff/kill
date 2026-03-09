"use strict";
// scripts-solana/stats.js
// Outputs total transactions and unique wallets for all three contracts.
//
// Usage: node scripts-solana/stats.js

const { setup } = require("./common");

const CONTRACTS = [
  { name: "kill-game",   id: "2FbeFxvFH2b4KyAcwNToFr3pHzYK4ybYQWriXjjKEr5D" },
  { name: "kill-token",  id: "3bcxaPX7ka8DgtJckaoJHVjaXqncBsa8EfGT2AfYaYSY"  },
  { name: "kill-faucet", id: "761RUKWGgStRshdz3HJcS7dPodFSckDAcudLtU1CZ1b6"  },
];

const PAGE_SIZE = 1000;

async function fetchStats(connection, programId) {
  const { PublicKey } = require("@solana/web3.js");
  const key = new PublicKey(programId);

  let allSigs = [];
  let before  = undefined;

  while (true) {
    const opts = { limit: PAGE_SIZE, commitment: "finalized" };
    if (before) opts.before = before;

    const batch = await connection.getSignaturesForAddress(key, opts);
    if (!batch || batch.length === 0) break;

    const valid = batch.filter(s => !s.err);
    allSigs.push(...valid);

    if (batch.length < PAGE_SIZE) break;
    before = batch[batch.length - 1].signature;

    await new Promise(r => setTimeout(r, 300)); // avoid rate limit
  }

  // Unique wallets: each confirmed sig has a memo of signers in the tx.
  // Fastest approximation without fetching every tx: collect unique feePayers
  // from getSignaturesForAddress (not available). Instead fetch in batches.
  const wallets = new Set();
  const BATCH = 10;

  for (let i = 0; i < allSigs.length; i += BATCH) {
    const chunk = allSigs.slice(i, i + BATCH);
    await Promise.all(chunk.map(async ({ signature }) => {
      try {
        const tx = await connection.getTransaction(signature, {
          maxSupportedTransactionVersion: 0,
          commitment: "finalized",
        });
        if (!tx) return;
        const signers = tx.transaction.message.staticAccountKeys
          ?? tx.transaction.message.accountKeys;
        if (signers && signers.length > 0) {
          wallets.add(signers[0].toBase58());
        }
      } catch (_) { /* skip */ }
    }));
    if (i + BATCH < allSigs.length) await new Promise(r => setTimeout(r, 200));
  }

  return { totalTx: allSigs.length, uniqueWallets: wallets.size };
}

(async () => {
  const { connection } = await setup();

  console.log("\n── Contract Stats (devnet) ──────────────────────");

  for (const { name, id } of CONTRACTS) {
    process.stdout.write(`  ${name.padEnd(12)} fetching...`);
    const { totalTx, uniqueWallets } = await fetchStats(connection, id);
    process.stdout.write(`\r  ${name.padEnd(12)} total tx: ${String(totalTx).padStart(6)}  |  unique wallets: ${uniqueWallets}\n`);
  }

  console.log("─────────────────────────────────────────────────\n");
})();
