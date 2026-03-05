"use strict";
// node scripts-solana/spawn.js <stack_id> <units>
// Spawns or reinforces a stack at the given grid position (0–215).
// Costs 20 KILL per unit (SPAWN_COST × units on-chain).
// One free Reaper is granted automatically per 666 units spawned.
//
// Example:
//   node scripts-solana/spawn.js 0 666        — spawn 666 units + 1 free reaper at stack 0
//   node scripts-solana/spawn.js 22 1332      — spawn 1332 units + 2 free reapers at stack 22

const { setup, agentStackPDA, gameConfigPDA } = require("./common");
const anchor = require("@coral-xyz/anchor");
const { getOrCreateAssociatedTokenAccount } = require("@solana/spl-token");

const REAPER_THRESHOLD = 666n;

async function main() {
    const stackId = parseInt(process.argv[2]);
    const units   = BigInt(process.argv[3] || "0");

    if (isNaN(stackId) || stackId < 0 || stackId > 215 || units <= 0n) {
        console.error("Usage: node scripts-solana/spawn.js <stack_id 0-215> <units>");
        process.exit(1);
    }

    const { wallet, connection, killGame, myKillATA, gameConfigAddr,
            KILL_MINT, fmtKill, txLink, cfg } = await setup();

    const costPerUnit = cfg.constants.spawn_cost;       // 20 KILL (human units)
    const totalCost   = Number(units) * costPerUnit;    // already in KILL
    const autoReapers = units / REAPER_THRESHOLD;

    console.log(`\nWallet      : ${wallet.publicKey.toBase58()}`);
    console.log(`Stack ID    : ${stackId}`);
    console.log(`Units       : ${units.toLocaleString()}`);
    console.log(`Auto-reapers: ${autoReapers} (1 per 666 units)`);
    console.log(`Cost        : ${totalCost.toLocaleString()} KILL (${costPerUnit} KILL × ${units} units)\n`);

    // Ensure the agent has an ATA for KILL
    const agentTokenAccount = await getOrCreateAssociatedTokenAccount(
        connection, wallet, KILL_MINT, wallet.publicKey
    );

    // Derive PDAs
    const [gameConfig]  = gameConfigPDA();
    const [agentStack]  = agentStackPDA(wallet.publicKey, stackId);

    // Fetch game_vault from GameConfig
    const gc = await killGame.account.gameConfig.fetch(gameConfig);

    const tx = await killGame.methods
        .spawn(stackId, new anchor.BN(units.toString()))
        .accounts({
            gameConfig,
            agentStack,
            agentTokenAccount: agentTokenAccount.address,
            gameVault:         gc.gameVault,
            killMint:          KILL_MINT,
            agent:             wallet.publicKey,
        })
        .signers([wallet])
        .rpc();

    console.log(`✅ Spawned!`);
    console.log(`   Tx : ${txLink(tx)}\n`);
}

main().catch(e => { console.error(e.message || e); process.exit(1); });
