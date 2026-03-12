"use strict";
// scripts/solana/stats.js
// Outputs total tx, unique wallets, and estimated SOL in tx fees for all three contracts.
// Fees are calculated as totalTx * 5000 lamports (Solana base fee, no priority fees set
// by these agents). Public devnet RPC rate-limits bulk getTransactions calls too
// aggressively to fetch real fees without a Helius/private RPC.
//
// Usage: node scripts/solana/stats.js

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

const agentCfg     = JSON.parse(fs.readFileSync(path.join(__dirname, "../../agents/sol/config.json"), "utf8"));
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

const SB_HEADERS = { "apikey": SUPABASE_KEY, "Authorization": `Bearer ${SUPABASE_KEY}`, "Prefer": "count=exact" };

async function fetchEventCounts() {
    const tables = ["spawned", "killed", "moved"];
    const counts = {};
    for (const table of tables) {
        const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}?select=id&limit=0`, {
            method: "HEAD", headers: SB_HEADERS
        });
        if (!res.ok) throw new Error(`Supabase ${table}: ${res.status}`);
        counts[table] = parseInt(res.headers.get("content-range")?.split("/")[1] || "0");
    }
    return counts;
}

async function fetchGlobalStats() {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/global_stat?id=eq.current&select=*`, {
        headers: { "apikey": SUPABASE_KEY, "Authorization": `Bearer ${SUPABASE_KEY}` }
    });
    if (!res.ok) return null;
    const rows = await res.json();
    return rows[0] || null;
}

// ANSI colors
const GRN = "\x1b[32m";
const YEL = "\x1b[33m";
const CYA = "\x1b[36m";
const RED = "\x1b[31m";
const PNK = "\x1b[35m";
const DIM = "\x1b[2m";
const RES = "\x1b[0m";

function fmtSol(lamports) {
    return (lamports / 1e9).toFixed(6);
}

(async () => {
    const { connection, killGame, killFaucet, gameConfigAddr, faucetConfigPDA, fmtKill } = await setup();

    process.stdout.write(`  ${DIM}Fetching unique wallets...${RES}`);
    const uniqueWallets = await fetchUniqueWallets();
    process.stdout.write(`\r  ${CYA}Unique wallets:${RES} ${uniqueWallets}\n\n`);

    // ── Vault balances ───────────────────────────────────────────────────────
    console.log(`${CYA}── Vault Balances ──────────────────────────────────────────────────${RES}`);
    try {
        const gc = await killGame.account.gameConfig.fetch(gameConfigAddr);
        const { getAccount } = require("@solana/spl-token");
        const gameVaultAcct = await getAccount(connection, gc.gameVault);
        console.log(`  Game Vault:   ${GRN}${fmtKill(gameVaultAcct.amount)}${RES} KILL`);
    } catch (e) {
        console.log(`  Game Vault:   ${RED}(error: ${e.message})${RES}`);
    }
    try {
        const [fcAddr] = faucetConfigPDA();
        const fc = await killFaucet.account.faucetConfig.fetch(fcAddr);
        const { getAccount } = require("@solana/spl-token");
        const faucetVaultAcct = await getAccount(connection, fc.faucetVault);
        console.log(`  Faucet Vault: ${GRN}${fmtKill(faucetVaultAcct.amount)}${RES} KILL`);
    } catch (e) {
        console.log(`  Faucet Vault: ${RED}(error: ${e.message})${RES}`);
    }
    console.log("");

    // ── Instruction counts from Supabase ────────────────────────────────────
    console.log(`${YEL}── Instruction Counts (indexed) ────────────────────────────────────${RES}`);
    try {
        const eventCounts = await fetchEventCounts();
        const totalIxs = eventCounts.spawned + eventCounts.killed + eventCounts.moved;
        console.log(`  ${DIM}${"TYPE".padEnd(12)}  ${"COUNT".padStart(8)}${RES}`);
        console.log(`  ${DIM}${"─".repeat(22)}${RES}`);
        console.log(`  ${"Spawns".padEnd(12)}  ${GRN}${String(eventCounts.spawned).padStart(8)}${RES}`);
        console.log(`  ${"Kills".padEnd(12)}  ${RED}${String(eventCounts.killed).padStart(8)}${RES}`);
        console.log(`  ${"Moves".padEnd(12)}  ${CYA}${String(eventCounts.moved).padStart(8)}${RES}`);
        console.log(`  ${DIM}${"─".repeat(22)}${RES}`);
        console.log(`  ${"TOTAL".padEnd(12)}  ${YEL}${String(totalIxs).padStart(8)}${RES}`);
    } catch (e) {
        console.log(`  ${RED}(error: ${e.message})${RES}`);
    }

    // ── Global stats from Supabase ──────────────────────────────────────────
    try {
        const gs = await fetchGlobalStats();
        if (gs) {
            console.log("");
            console.log(`${PNK}── Economy (indexed) ───────────────────────────────────────────────${RES}`);
            console.log(`  Units killed:   ${RED}${Number(gs.total_units_killed).toLocaleString()}${RES}`);
            console.log(`  Reapers killed: ${RED}${Number(gs.total_reaper_killed).toLocaleString()}${RES}`);
            console.log(`  KILL added:     ${YEL}${fmtKill(BigInt(Math.round(Number(gs.kill_added))))}${RES}`);
            console.log(`  KILL extracted: ${GRN}${fmtKill(BigInt(Math.round(Number(gs.kill_extracted))))}${RES}`);
            console.log(`  KILL burned:    ${RED}${fmtKill(BigInt(Math.round(Number(gs.kill_burned))))}${RES}`);
            const pnl = Number(gs.kill_extracted) - Number(gs.kill_added);
            const pnlColor = pnl >= 0 ? GRN : RED;
            const pnlSign  = pnl >= 0 ? '+' : '';
            console.log(`  Net P&L:        ${pnlColor}${pnlSign}${fmtKill(BigInt(Math.round(Math.abs(pnl))))}${RES}${pnl < 0 ? ` ${RED}(net loss)${RES}` : ` ${GRN}(net gain)${RES}`}`);
        }
    } catch (_) {}
    console.log("");

    // ── Contract tx stats ────────────────────────────────────────────────────
    console.log(`${CYA}── Contract Stats (devnet) ─────────────────────────────────────────${RES}`);
    console.log(`  ${DIM}${"CONTRACT".padEnd(12)}  ${"TX".padStart(6)}  ${"SOL FEES (est)".padStart(16)}${RES}`);
    console.log(`  ${DIM}${"─".repeat(40)}${RES}`);

    let grandTx = 0, grandLamports = 0;
    for (const { name, id } of CONTRACTS) {
        process.stdout.write(`  ${DIM}${name.padEnd(12)}  counting...${RES}`);
        const totalTx = await fetchTxCount(connection, id);
        const lamports = totalTx * BASE_FEE;
        grandTx        += totalTx;
        grandLamports  += lamports;
        process.stdout.write(
            `\r  ${name.padEnd(12)}  ${YEL}${String(totalTx).padStart(6)}${RES}  ${CYA}${fmtSol(lamports).padStart(16)}${RES} SOL\n`
        );
    }

    console.log(`  ${DIM}${"─".repeat(40)}${RES}`);
    console.log(`  ${"TOTAL".padEnd(12)}  ${YEL}${String(grandTx).padStart(6)}${RES}  ${CYA}${fmtSol(grandLamports).padStart(16)}${RES} SOL`);
    console.log(`${DIM}────────────────────────────────────────────────────────────────────${RES}`);
    console.log(`  ${DIM}(fees estimated at ${BASE_FEE} lamports/tx base fee × tx count)${RES}\n`);
})();
