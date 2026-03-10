"use strict";
// scripts-solana/stats.js
// Outputs total tx, unique wallets, and estimated SOL in tx fees for all three contracts.
// Fees are calculated as totalTx * 5000 lamports (Solana base fee, no priority fees set
// by these agents). Public devnet RPC rate-limits bulk getTransactions calls too
// aggressively to fetch real fees without a Helius/private RPC.
//
// Usage: node scripts-solana/stats.js

const path = require("path");
const fs   = require("fs");
const { setup } = require("./common");

const CONTRACTS = [
  { name: "kill-game",   id: "2FbeFxvFH2b4KyAcwNToFr3pHzYK4ybYQWriXjjKEr5D" },
  { name: "kill-token",  id: "3bcxaPX7ka8DgtJckaoJHVjaXqncBsa8EfGT2AfYaYSY"  },
  { name: "kill-faucet", id: "761RUKWGgStRshdz3HJcS7dPodFSckDAcudLtU1CZ1b6"  },
];

const PAGE_SIZE  = 1000;
const PAGE_DELAY = 600;   // ms between signature pagination calls
const BASE_FEE   = 5000;  // lamports per tx (Solana base fee, 1 signature)

const agentCfg     = JSON.parse(fs.readFileSync(path.join(__dirname, "../agents-sol/config.json"), "utf8"));
const SUPABASE_URL  = agentCfg.settings.SUPABASE_URL;
const SUPABASE_KEY  = agentCfg.settings.SUPABASE_KEY;

// ── Count txs via getSignaturesForAddress (no individual tx fetches) ───────────
async function fetchTxCount(connection, programId) {
    const { PublicKey } = require("@solana/web3.js");
    const key   = new PublicKey(programId);
    let total   = 0;
    let before  = undefined;

    while (true) {
        const opts = { limit: PAGE_SIZE, commitment: "finalized" };
        if (before) opts.before = before;
        const batch = await connection.getSignaturesForAddress(key, opts);
        if (!batch || batch.length === 0) break;
        total += batch.filter(s => !s.err).length;
        if (batch.length < PAGE_SIZE) break;
        before = batch[batch.length - 1].signature;
        await new Promise(r => setTimeout(r, PAGE_DELAY));
    }

    return total;
}

// ── Unique wallets from Supabase (zero RPC calls) ─────────────────────────────
async function fetchUniqueWallets() {
    const rows = [];
    let offset = 0;
    while (true) {
        const url = `${SUPABASE_URL}/rest/v1/agent_stack?select=agent&limit=1000&offset=${offset}`;
        const res = await fetch(url, {
            headers: { "apikey": SUPABASE_KEY, "Authorization": `Bearer ${SUPABASE_KEY}` }
        });
        if (!res.ok) throw new Error(`Supabase ${res.status}`);
        const batch = await res.json();
        if (!batch || batch.length === 0) break;
        rows.push(...batch);
        if (batch.length < 1000) break;
        offset += 1000;
    }
    return new Set(rows.map(r => r.agent)).size;
}

function fmtSol(lamports) {
    return (lamports / 1e9).toFixed(6);
}

(async () => {
    const { connection, killGame, killFaucet, gameConfigAddr, faucetConfigPDA, fmtKill } = await setup();

    process.stdout.write("  Fetching unique wallets...");
    const uniqueWallets = await fetchUniqueWallets();
    process.stdout.write(`\r  Unique wallets: ${uniqueWallets}\n\n`);

    // ── Vault balances ───────────────────────────────────────────────────────
    console.log("── Vault Balances ──────────────────────────────────────────────────");
    try {
        const gc = await killGame.account.gameConfig.fetch(gameConfigAddr);
        const { getAccount } = require("@solana/spl-token");
        const gameVaultAcct = await getAccount(connection, gc.gameVault);
        console.log(`  Game Vault:   ${fmtKill(gameVaultAcct.amount)} KILL`);
    } catch (e) {
        console.log(`  Game Vault:   (error: ${e.message})`);
    }
    try {
        const [fcAddr] = faucetConfigPDA();
        const fc = await killFaucet.account.faucetConfig.fetch(fcAddr);
        const { getAccount } = require("@solana/spl-token");
        const faucetVaultAcct = await getAccount(connection, fc.faucetVault);
        console.log(`  Faucet Vault: ${fmtKill(faucetVaultAcct.amount)} KILL`);
    } catch (e) {
        console.log(`  Faucet Vault: (error: ${e.message})`);
    }
    console.log("");

    // ── Contract tx stats ────────────────────────────────────────────────────
    console.log("── Contract Stats (devnet) ─────────────────────────────────────────");
    console.log(`  ${"CONTRACT".padEnd(12)}  ${"TX".padStart(6)}  ${"SOL FEES (est)".padStart(16)}`);
    console.log("  " + "─".repeat(40));

    let grandTx = 0, grandLamports = 0;
    for (const { name, id } of CONTRACTS) {
        process.stdout.write(`  ${name.padEnd(12)}  counting...`);
        const totalTx = await fetchTxCount(connection, id);
        const lamports = totalTx * BASE_FEE;
        grandTx        += totalTx;
        grandLamports  += lamports;
        process.stdout.write(
            `\r  ${name.padEnd(12)}  ${String(totalTx).padStart(6)}  ${fmtSol(lamports).padStart(16)} SOL\n`
        );
    }

    console.log("  " + "─".repeat(40));
    console.log(`  ${"TOTAL".padEnd(12)}  ${String(grandTx).padStart(6)}  ${fmtSol(grandLamports).padStart(16)} SOL`);
    console.log("────────────────────────────────────────────────────────────────────");
    console.log(`  (fees estimated at ${BASE_FEE} lamports/tx base fee × tx count)\n`);
})();
