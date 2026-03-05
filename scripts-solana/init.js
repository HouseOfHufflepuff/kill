"use strict";
// node scripts-solana/init.js
//
// One-time setup for all three programs on devnet.
// Must be run by the admin wallet before any other scripts work.
//
// What it does:
//   1. Generates the KILL SPL mint keypair (saved to ~/.config/solana/kill-mint.json)
//   2. initialize_token  — creates the SPL mint with 6 decimals, PDA mint authority
//   3. initialize_game   — creates GameConfig PDA + game vault token account
//   4. initialize_faucet — creates FaucetConfig PDA + faucet vault token account
//
// Re-running is safe: each step is skipped if the account already exists.

const { setup, gameConfigPDA, faucetConfigPDA, cfg } = require("./common");
const CONFIG_PATH = path.join(__dirname, "config.json");
const anchor = require("@coral-xyz/anchor");
const { web3 } = anchor;
const { TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID } = require("@solana/spl-token");
const fs   = require("fs");
const path = require("path");

const MINT_KEYPAIR_PATH = path.join(
    (process.env.HOME || "~"),
    ".config/solana/kill-mint.json"
);

async function loadOrGenerateMintKp() {
    if (fs.existsSync(MINT_KEYPAIR_PATH)) {
        console.log(`  Using existing mint keypair: ${MINT_KEYPAIR_PATH}`);
        const raw = JSON.parse(fs.readFileSync(MINT_KEYPAIR_PATH, "utf8"));
        return web3.Keypair.fromSecretKey(Uint8Array.from(raw));
    }
    console.log(`  Generating new mint keypair → ${MINT_KEYPAIR_PATH}`);
    const kp = web3.Keypair.generate();
    fs.writeFileSync(MINT_KEYPAIR_PATH, JSON.stringify(Array.from(kp.secretKey)));
    // Save mint address to config.json so all scripts can use it
    const config = JSON.parse(fs.readFileSync(CONFIG_PATH, "utf8"));
    config.kill_mint = kp.publicKey.toBase58();
    fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2));
    console.log(`  Saved kill_mint to config.json`);
    return kp;
}

async function main() {
    const { wallet, connection, killToken, killGame, killFaucet, txLink } = await setup();

    console.log(`\nAdmin wallet : ${wallet.publicKey.toBase58()}`);
    console.log(`Network      : ${cfg.network.cluster}\n`);

    const mintKp = await loadOrGenerateMintKp();
    console.log(`KILL mint    : ${mintKp.publicKey.toBase58()}\n`);

    // ── PDAs ─────────────────────────────────────────────────────────────────
    const KILL_TOKEN_PROGRAM_ID = new web3.PublicKey(cfg.programs.kill_token);
    const KILL_GAME_ID          = new web3.PublicKey(cfg.programs.kill_game);
    const KILL_FAUCET_ID        = new web3.PublicKey(cfg.programs.kill_faucet);

    const [tokenConfig]  = web3.PublicKey.findProgramAddressSync([Buffer.from("token_config")],  KILL_TOKEN_PROGRAM_ID);
    const [gameConfig]   = web3.PublicKey.findProgramAddressSync([Buffer.from("game_config")],    KILL_GAME_ID);
    const [faucetConfig] = web3.PublicKey.findProgramAddressSync([Buffer.from("faucet_config")],  KILL_FAUCET_ID);

    // New keypairs for the vault token accounts (signers on init)
    const gameVaultKp   = web3.Keypair.generate();
    const faucetVaultKp = web3.Keypair.generate();

    // ── 1. initialize_token ───────────────────────────────────────────────────
    const tokenExists = await connection.getAccountInfo(tokenConfig);
    if (tokenExists) {
        console.log("✅ kill_token already initialized — skipping");
    } else {
        console.log("⏳ Initializing kill_token...");
        const tx = await killToken.methods
            .initializeToken()
            .accounts({
                tokenConfig,
                killMint:      mintKp.publicKey,
                admin:         wallet.publicKey,
                tokenProgram:  TOKEN_PROGRAM_ID,
                systemProgram: web3.SystemProgram.programId,
                rent:          web3.SYSVAR_RENT_PUBKEY,
            })
            .signers([wallet, mintKp])
            .rpc();
        console.log(`✅ kill_token initialized`);
        console.log(`   Tx : ${txLink(tx)}`);
    }

    // ── 2. initialize_game ────────────────────────────────────────────────────
    const gameExists = await connection.getAccountInfo(gameConfig);
    if (gameExists) {
        console.log("✅ kill_game already initialized — skipping");
    } else {
        console.log("⏳ Initializing kill_game...");
        const tx = await killGame.methods
            .initializeGame()
            .accounts({
                gameConfig,
                killMint:      mintKp.publicKey,
                gameVault:     gameVaultKp.publicKey,
                admin:         wallet.publicKey,
                tokenProgram:  TOKEN_PROGRAM_ID,
                systemProgram: web3.SystemProgram.programId,
                rent:          web3.SYSVAR_RENT_PUBKEY,
            })
            .signers([wallet, gameVaultKp])
            .rpc();
        console.log(`✅ kill_game initialized`);
        console.log(`   game_vault : ${gameVaultKp.publicKey.toBase58()}`);
        console.log(`   Tx         : ${txLink(tx)}`);
    }

    // ── 3. initialize_faucet ──────────────────────────────────────────────────
    const faucetExists = await connection.getAccountInfo(faucetConfig);
    if (faucetExists) {
        console.log("✅ kill_faucet already initialized — skipping");
    } else {
        console.log("⏳ Initializing kill_faucet...");
        const tx = await killFaucet.methods
            .initializeFaucet()
            .accounts({
                faucetConfig,
                killMint:      mintKp.publicKey,
                faucetVault:   faucetVaultKp.publicKey,
                admin:         wallet.publicKey,
                tokenProgram:  TOKEN_PROGRAM_ID,
                systemProgram: web3.SystemProgram.programId,
                rent:          web3.SYSVAR_RENT_PUBKEY,
            })
            .signers([wallet, faucetVaultKp])
            .rpc();
        console.log(`✅ kill_faucet initialized`);
        console.log(`   faucet_vault : ${faucetVaultKp.publicKey.toBase58()}`);
        console.log(`   Tx           : ${txLink(tx)}`);
    }

    console.log(`\nDone. Run next:\n  node scripts-solana/mint.js 1000000\n`);
}

main().catch(e => { console.error(e.message || e); process.exit(1); });
