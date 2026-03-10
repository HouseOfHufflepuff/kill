"use strict";
// node scripts/solana/fund-faucet.js <amount_kill>
// Transfers KILL from the admin wallet to the faucet vault.
//
// Example:
//   node scripts/solana/fund-faucet.js 666000000    # deposits 666M KILL into the faucet

const { setup, faucetConfigPDA, killATA } = require("./common");
const { transfer, getOrCreateAssociatedTokenAccount } = require("@solana/spl-token");

async function main() {
    const amountKill = parseFloat(process.argv[2]);
    if (isNaN(amountKill) || amountKill <= 0) {
        console.error("Usage: node scripts/solana/fund-faucet.js <amount_kill>");
        console.error("  amount_kill — whole KILL tokens to deposit (e.g. 666000000 = 666M KILL)");
        process.exit(1);
    }

    const { wallet, connection, killFaucet, KILL_MINT, DECIMALS, fmtKill, txLink } = await setup();

    const [faucetConfig] = faucetConfigPDA();
    const fc = await killFaucet.account.faucetConfig.fetch(faucetConfig);
    const vaultAddr = fc.faucetVault;

    const rawAmount = BigInt(Math.round(amountKill * 10 ** DECIMALS));

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

    console.log(`✅ Faucet funded!`);
    console.log(`   Tx : ${txLink(tx)}\n`);
}

main().catch(e => { console.error(e.message || e); process.exit(1); });
