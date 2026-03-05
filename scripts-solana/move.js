"use strict";
// node scripts-solana/move.js <from_stack_id> <to_stack_id>
// Moves all units from one grid position to an adjacent one.
// Costs 100 KILL (MOVE_COST on-chain). Stacks must be Manhattan distance = 1.
//
// Example:
//   node scripts-solana/move.js 0 1    — move from stack 0 to stack 1

const { setup, agentStackPDA, gameConfigPDA } = require("./common");
const { getOrCreateAssociatedTokenAccount } = require("@solana/spl-token");

async function main() {
    const fromId = parseInt(process.argv[2]);
    const toId   = parseInt(process.argv[3]);

    if (isNaN(fromId) || isNaN(toId) || fromId < 0 || fromId > 215 || toId < 0 || toId > 215) {
        console.error("Usage: node scripts-solana/move.js <from_stack_id 0-215> <to_stack_id 0-215>");
        process.exit(1);
    }

    const { wallet, connection, killGame, KILL_MINT, txLink, cfg } = await setup();

    console.log(`\nWallet    : ${wallet.publicKey.toBase58()}`);
    console.log(`Move      : stack ${fromId} → stack ${toId}`);
    console.log(`Cost      : ${cfg.constants.move_cost} KILL\n`);

    const agentTokenAccount = await getOrCreateAssociatedTokenAccount(
        connection, wallet, KILL_MINT, wallet.publicKey
    );

    const [gameConfig]  = gameConfigPDA();
    const [fromStack]   = agentStackPDA(wallet.publicKey, fromId);
    const [toStack]     = agentStackPDA(wallet.publicKey, toId);

    const gc = await killGame.account.gameConfig.fetch(gameConfig);

    const tx = await killGame.methods
        .moveUnits(fromId, toId)
        .accounts({
            gameConfig,
            fromStack,
            toStack,
            agentTokenAccount: agentTokenAccount.address,
            gameVault:         gc.gameVault,
            killMint:          KILL_MINT,
            agent:             wallet.publicKey,
        })
        .signers([wallet])
        .rpc();

    console.log(`✅ Moved!`);
    console.log(`   Tx : ${txLink(tx)}\n`);
}

main().catch(e => { console.error(e.message || e); process.exit(1); });
