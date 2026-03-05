"use strict";
// node scripts-solana/new-wallet.js <name> [sol]
// Creates a new devnet keypair and airdrops SOL to fund it.
//
// Examples:
//   node scripts-solana/new-wallet.js player2        — create player2.json, airdrop 2 SOL
//   node scripts-solana/new-wallet.js player2 5      — create player2.json, airdrop 5 SOL

const anchor = require("@coral-xyz/anchor");
const { web3 } = anchor;
const fs   = require("fs");
const path = require("path");

async function main() {
    const name = process.argv[2];
    const sol  = parseFloat(process.argv[3] || "2");

    if (!name) {
        console.error("Usage: node scripts-solana/new-wallet.js <name> [sol]");
        console.error("  e.g. node scripts-solana/new-wallet.js player2");
        process.exit(1);
    }

    const keypairPath = path.join(process.env.HOME || "~", ".config/solana", name + ".json");

    let kp;
    if (fs.existsSync(keypairPath)) {
        console.log(`  Wallet already exists at ${keypairPath} — loading it`);
        kp = web3.Keypair.fromSecretKey(
            Uint8Array.from(JSON.parse(fs.readFileSync(keypairPath, "utf8")))
        );
    } else {
        kp = web3.Keypair.generate();
        fs.writeFileSync(keypairPath, JSON.stringify(Array.from(kp.secretKey)));
        console.log(`  Created new keypair → ${keypairPath}`);
    }

    console.log(`\n  Name   : ${name}`);
    console.log(`  Pubkey : ${kp.publicKey.toBase58()}`);
    console.log(`  Path   : ${keypairPath}`);

    // Airdrop devnet SOL
    const rpcUrl = process.env.SOLANA_RPC_URL || "https://api.devnet.solana.com";
    const connection = new web3.Connection(rpcUrl, "confirmed");

    const lamports = sol * web3.LAMPORTS_PER_SOL;
    console.log(`\n  Requesting ${sol} SOL airdrop on devnet...`);
    try {
        const sig = await connection.requestAirdrop(kp.publicKey, lamports);
        await connection.confirmTransaction(sig);
        const balance = await connection.getBalance(kp.publicKey);
        console.log(`  ✅ Balance: ${(balance / web3.LAMPORTS_PER_SOL).toFixed(4)} SOL`);
    } catch (e) {
        console.warn(`  ⚠️  Airdrop failed (rate limited?): ${e.message}`);
        console.warn(`     Fund manually: solana airdrop ${sol} ${kp.publicKey.toBase58()} --url devnet`);
    }

    console.log(`
To use this wallet with any script, add --wallet ${name}:
  node scripts-solana/balance.js --wallet ${name}
  node scripts-solana/spawn.js 0 666 --wallet ${name}
  node scripts-solana/mint.js 50000 ${kp.publicKey.toBase58()}
`);
}

main().catch(e => { console.error(e.message || e); process.exit(1); });
