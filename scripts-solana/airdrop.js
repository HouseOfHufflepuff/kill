"use strict";
// node scripts-solana/airdrop.js [sol_amount]
// Requests a devnet SOL airdrop. Default: 2 SOL.

const { setup } = require("./common");
const { web3 } = require("@coral-xyz/anchor");

async function main() {
    const amount = parseFloat(process.argv[2] || "2");
    const { wallet, connection, fmtSol } = await setup();

    const before = await connection.getBalance(wallet.publicKey);
    console.log(`\nWallet : ${wallet.publicKey.toBase58()}`);
    console.log(`Before : ${fmtSol(before)} SOL`);
    console.log(`Requesting ${amount} SOL airdrop on devnet...`);

    const sig = await connection.requestAirdrop(
        wallet.publicKey,
        amount * web3.LAMPORTS_PER_SOL
    );
    await connection.confirmTransaction(sig, "confirmed");

    const after = await connection.getBalance(wallet.publicKey);
    console.log(`After  : ${fmtSol(after)} SOL`);
    console.log(`Sig    : ${sig}\n`);
}

main().catch(e => { console.error(e.message); process.exit(1); });
