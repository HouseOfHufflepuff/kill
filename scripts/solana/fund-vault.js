"use strict";
// node scripts/solana/fund-vault.js <amount_kill>
// Transfers KILL from the admin wallet to the game vault to pre-fund bounty payouts.
//
// Example:
//   node scripts/solana/fund-vault.js 1000000    # deposits 1M KILL into the vault

const { setup, gameConfigPDA, killATA } = require("./common");
const { transfer, getOrCreateAssociatedTokenAccount } = require("@solana/spl-token");

async function main() {
    const amountKill = parseFloat(process.argv[2]);
    if (isNaN(amountKill) || amountKill <= 0) {
        console.error("Usage: node scripts/solana/fund-vault.js <amount_kill>");
        console.error("  amount_kill — whole KILL tokens to deposit (e.g. 1000000 = 1M KILL)");
        process.exit(1);
    }

    const { wallet, connection, killGame, KILL_MINT, DECIMALS, fmtKill, txLink } = await setup();

    const [gameConfig] = gameConfigPDA();
    const gc = await killGame.account.gameConfig.fetch(gameConfig);
    const vaultAddr = gc.gameVault;

    const rawAmount = BigInt(Math.round(amountKill * 10 ** DECIMALS));

    // Ensure admin has an ATA
    const adminAta = await getOrCreateAssociatedTokenAccount(
        connection, wallet, KILL_MINT, wallet.publicKey
    );

    console.log(`\nWallet : ${wallet.publicKey.toBase58()}`);
    console.log(`Vault  : ${vaultAddr.toBase58()}`);
    console.log(`Amount : ${fmtKill(rawAmount)} KILL\n`);

    const tx = await transfer(
        connection,
        wallet,
        adminAta.address,
        vaultAddr,
        wallet,
        rawAmount
    );

    console.log(`✅ Vault funded!`);
    console.log(`   Tx : ${txLink(tx)}\n`);
}

main().catch(e => { console.error(e.message || e); process.exit(1); });
