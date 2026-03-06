"use strict";
// node scripts-solana/kill.js <stack_id> <defender_pubkey> <stack_id> <sent_units> [sent_reapers]
// Attacks a defender on the same stack. Attacker and defender must share the same stack_id.
// Win → collect bounty. Lose → sent units lost.
//
// Example:
//   node scripts-solana/kill.js 35 <defender_wallet_address> 35 500000 0

const { setup, agentStackPDA, gameConfigPDA, killATA } = require("./common");
const anchor = require("@coral-xyz/anchor");
const { BN } = anchor;
const { getOrCreateAssociatedTokenAccount } = require("@solana/spl-token");

async function main() {
    const attackerStackId = parseInt(process.argv[2]);
    const defenderKey     = process.argv[3];
    const defenderStackId = parseInt(process.argv[4]);
    const sentUnits       = process.argv[5] ? new BN(process.argv[5]) : null;
    const sentReapers     = process.argv[6] ? new BN(process.argv[6]) : new BN(0);

    if (isNaN(attackerStackId) || !defenderKey || isNaN(defenderStackId) || !sentUnits) {
        console.error("Usage: node scripts-solana/kill.js <stack_id> <defender_pubkey> <stack_id> <sent_units> [sent_reapers]");
        process.exit(1);
    }

    const { wallet, connection, killGame, KILL_MINT, txLink } = await setup();
    const { web3 } = require("@coral-xyz/anchor");
    const defenderPubkey = new web3.PublicKey(defenderKey);

    console.log(`\nWallet   : ${wallet.publicKey.toBase58()}`);
    console.log(`Attack   : stack ${attackerStackId} vs defender ${defenderKey} (same stack ${defenderStackId})`);
    console.log(`Sending  : ${sentUnits.toString()} units, ${sentReapers.toString()} reapers\n`);

    const attackerTokenAccount = await getOrCreateAssociatedTokenAccount(
        connection, wallet, KILL_MINT, wallet.publicKey
    );

    const [gameConfig]      = gameConfigPDA();
    const [attackerStack]   = agentStackPDA(wallet.publicKey, attackerStackId);
    const [defenderStack]   = agentStackPDA(defenderPubkey,   defenderStackId);

    const gc = await killGame.account.gameConfig.fetch(gameConfig);

    const tx = await killGame.methods
        .kill(attackerStackId, defenderStackId, sentUnits, sentReapers)
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
