"use strict";
// node scripts-solana/kill.js <attacker_stack_id> <defender_pubkey> <defender_stack_id>
// Attacks a defender's adjacent stack. Win → collect bounty. Lose → stack cleared.
//
// Example:
//   node scripts-solana/kill.js 1 <defender_wallet_address> 2

const { setup, agentStackPDA, gameConfigPDA, killATA } = require("./common");
const anchor = require("@coral-xyz/anchor");
const { getOrCreateAssociatedTokenAccount } = require("@solana/spl-token");

async function main() {
    const attackerStackId = parseInt(process.argv[2]);
    const defenderKey     = process.argv[3];
    const defenderStackId = parseInt(process.argv[4]);

    if (isNaN(attackerStackId) || !defenderKey || isNaN(defenderStackId)) {
        console.error("Usage: node scripts-solana/kill.js <attacker_stack_id> <defender_pubkey> <defender_stack_id>");
        process.exit(1);
    }

    const { wallet, connection, killGame, KILL_MINT, txLink } = await setup();
    const { web3 } = require("@coral-xyz/anchor");
    const defenderPubkey = new web3.PublicKey(defenderKey);

    console.log(`\nWallet   : ${wallet.publicKey.toBase58()}`);
    console.log(`Attack   : stack ${attackerStackId} → defender ${defenderKey} stack ${defenderStackId}\n`);

    const attackerTokenAccount = await getOrCreateAssociatedTokenAccount(
        connection, wallet, KILL_MINT, wallet.publicKey
    );

    const [gameConfig]      = gameConfigPDA();
    const [attackerStack]   = agentStackPDA(wallet.publicKey, attackerStackId);
    const [defenderStack]   = agentStackPDA(defenderPubkey,   defenderStackId);

    const gc = await killGame.account.gameConfig.fetch(gameConfig);

    const tx = await killGame.methods
        .kill(attackerStackId, defenderStackId)
        .accounts({
            gameConfig,
            attackerStack,
            defenderStack,
            attackerTokenAccount: attackerTokenAccount.address,
            gameVault:            gc.gameVault,
            killMint:             KILL_MINT,
            attacker:             wallet.publicKey,
            defender:             defenderPubkey,
        })
        .signers([wallet])
        .rpc();

    console.log(`✅ Kill submitted!`);
    console.log(`   Tx : ${txLink(tx)}\n`);
}

main().catch(e => { console.error(e.message || e); process.exit(1); });
