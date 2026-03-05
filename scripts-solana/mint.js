"use strict";
// node scripts-solana/mint.js <amount_kill> [destination_pubkey]
// Mints KILL tokens. Admin wallet only.
//
// Examples:
//   node scripts-solana/mint.js 1000000               — mint 1M KILL to yourself
//   node scripts-solana/mint.js 500000 <other_pubkey> — mint 500K KILL to another wallet

const { setup, cfg } = require("./common");
const anchor = require("@coral-xyz/anchor");
const { web3 } = anchor;
const {
    getOrCreateAssociatedTokenAccount,
    TOKEN_PROGRAM_ID
} = require("@solana/spl-token");
const fs   = require("fs");
const path = require("path");

const MINT_KEYPAIR_PATH = path.join(
    (process.env.HOME || "~"),
    ".config/solana/kill-mint.json"
);

async function main() {
    const amountKill = parseFloat(process.argv[2]);
    if (isNaN(amountKill) || amountKill <= 0) {
        console.error("Usage: node scripts-solana/mint.js <amount_kill> [destination_pubkey]");
        process.exit(1);
    }

    const { wallet, connection, killToken, fmtKill, txLink } = await setup();

    if (!fs.existsSync(MINT_KEYPAIR_PATH)) {
        console.error(`Kill mint keypair not found at ${MINT_KEYPAIR_PATH}`);
        console.error("Run init.js first: node scripts-solana/init.js");
        process.exit(1);
    }
    const mintKp = web3.Keypair.fromSecretKey(
        Uint8Array.from(JSON.parse(fs.readFileSync(MINT_KEYPAIR_PATH, "utf8")))
    );

    const destPubkey = process.argv[3]
        ? new web3.PublicKey(process.argv[3])
        : wallet.publicKey;

    const KILL_TOKEN_PROGRAM_ID = new web3.PublicKey(cfg.programs.kill_token);
    const [tokenConfig] = web3.PublicKey.findProgramAddressSync(
        [Buffer.from("token_config")], KILL_TOKEN_PROGRAM_ID
    );

    // Ensure the destination has an ATA for KILL
    const destATA = await getOrCreateAssociatedTokenAccount(
        connection, wallet, mintKp.publicKey, destPubkey
    );

    // Amount in raw units (6 decimals)
    const rawAmount = new anchor.BN(Math.round(amountKill * 1_000_000));

    console.log(`\nMinting ${amountKill.toLocaleString()} KILL`);
    console.log(`  Mint    : ${mintKp.publicKey.toBase58()}`);
    console.log(`  To      : ${destPubkey.toBase58()}`);
    console.log(`  ATA     : ${destATA.address.toBase58()}\n`);

    const tx = await killToken.methods
        .mintTo(rawAmount)
        .accounts({
            tokenConfig,
            killMint:     mintKp.publicKey,
            destination:  destATA.address,
            admin:        wallet.publicKey,
            tokenProgram: TOKEN_PROGRAM_ID,
        })
        .signers([wallet])
        .rpc();

    console.log(`✅ Minted ${amountKill.toLocaleString()} KILL`);
    console.log(`   Tx : ${txLink(tx)}\n`);
}

main().catch(e => { console.error(e.message || e); process.exit(1); });
