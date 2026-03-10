"use strict";
// node scripts/solana/balance.js
// Shows SOL balance, KILL balance, and on-chain GameConfig state.

const { setup } = require("./common");
const { getAccount } = require("@solana/spl-token");

async function main() {
    const { wallet, connection, myKillATA, gameConfigAddr, killGame,
            fmtKill, fmtSol, cfg } = await setup();

    console.log(`\nWallet  : ${wallet.publicKey.toBase58()}`);
    console.log(`Network : ${cfg.network.cluster} (${cfg.network.rpc_url})\n`);

    // ── SOL balance ───────────────────────────────────────────────────────────
    const lamports = await connection.getBalance(wallet.publicKey);
    console.log(`SOL     : ${fmtSol(lamports)} SOL`);

    // ── KILL balance ──────────────────────────────────────────────────────────
    try {
        const ata = await getAccount(connection, myKillATA);
        console.log(`KILL    : ${fmtKill(ata.amount)} KILL  (ATA: ${myKillATA.toBase58()})`);
    } catch {
        console.log(`KILL    : 0  (no token account yet — ATA: ${myKillATA.toBase58()})`);
    }

    // ── GameConfig on-chain state ─────────────────────────────────────────────
    console.log(`\n── GameConfig ───────────────────────────────────────────────`);
    try {
        const gc = await killGame.account.gameConfig.fetch(gameConfigAddr);
        console.log(`  kill_mint   : ${gc.killMint.toBase58()}`);
        console.log(`  game_vault  : ${gc.gameVault.toBase58()}`);
        console.log(`  admin       : ${gc.admin.toBase58()}`);
        console.log(`  total_kills : ${gc.totalKills.toString()}`);
        console.log(`  paused      : ${gc.paused}`);
    } catch (e) {
        console.log(`  (not initialized — run init.js first)`);
    }

    console.log();
}

main().catch(e => { console.error(e.message); process.exit(1); });
