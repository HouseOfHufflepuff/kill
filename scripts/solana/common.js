"use strict";
// scripts/solana/common.js
// Solana equivalent of agents/common.js — shared connection, wallet, and programs.
//
// Run any script with:   node scripts/solana/balance.js
// Keypair file:          ~/.config/solana/id.json  (set SOLANA_KEYPAIR_PATH in .env)

require("dotenv").config();
const fs      = require("fs");
const path    = require("path");
const anchor  = require("@coral-xyz/anchor");
const web3    = anchor.web3;

const cfg = JSON.parse(fs.readFileSync(path.join(__dirname, "config.json"), "utf8"));

// ── IDL paths (compiled by `anchor build`) ────────────────────────────────────
const IDL_DIR  = path.join(__dirname, "../../contracts/solana/target/idl");
const IDL_GAME   = JSON.parse(fs.readFileSync(path.join(IDL_DIR, "kill_game.json"),   "utf8"));
const IDL_TOKEN  = JSON.parse(fs.readFileSync(path.join(IDL_DIR, "kill_token.json"),  "utf8"));
const IDL_FAUCET = JSON.parse(fs.readFileSync(path.join(IDL_DIR, "kill_faucet.json"), "utf8"));

// ── Keypair ───────────────────────────────────────────────────────────────────
// Priority: --wallet <name|path>  >  SOLANA_KEYPAIR_PATH (.env)  >  id.json
//
// --wallet accepts:
//   a short name:  --wallet player2   → ~/.config/solana/player2.json
//   a full path:   --wallet /abs/path/to/key.json
function resolveWalletPath() {
    const idx = process.argv.indexOf("--wallet");
    if (idx !== -1 && process.argv[idx + 1]) {
        const val = process.argv[idx + 1];
        if (val.startsWith("/") || val.startsWith("~")) {
            return val.replace("~", process.env.HOME);
        }
        return path.join(process.env.HOME || "~", ".config/solana", val + ".json");
    }
    return (process.env.SOLANA_KEYPAIR_PATH || "~/.config/solana/id.json")
        .replace("~", process.env.HOME);
}

function loadWallet() {
    const keypairPath = resolveWalletPath();
    const raw = JSON.parse(fs.readFileSync(keypairPath, "utf8"));
    const kp = web3.Keypair.fromSecretKey(Uint8Array.from(raw));
    kp._path = keypairPath; // attach for display
    return kp;
}

// ── Connection + Provider ─────────────────────────────────────────────────────
function makeProvider(wallet) {
    const rpcUrl     = process.env.SOLANA_RPC_URL || cfg.network.rpc_url;
    const connection = new web3.Connection(rpcUrl, "confirmed");
    const anchorWallet = new anchor.Wallet(wallet);
    return new anchor.AnchorProvider(connection, anchorWallet, { commitment: "confirmed" });
}

// ── Programs ──────────────────────────────────────────────────────────────────
function loadPrograms(provider) {
    return {
        killGame:   new anchor.Program(IDL_GAME,   provider),
        killToken:  new anchor.Program(IDL_TOKEN,  provider),
        killFaucet: new anchor.Program(IDL_FAUCET, provider),
    };
}

// ── PDA helpers ───────────────────────────────────────────────────────────────
// These mirror the seed definitions in the Rust programs.

// KILL_MINT is the SPL mint address — distinct from the kill_token program ID.
// Set in config.json as "kill_mint" after running init.js.
const KILL_MINT = new web3.PublicKey(
    cfg.kill_mint || (() => { throw new Error('kill_mint missing in config.json — run init.js first'); })()
);
const GAME_ID   = new web3.PublicKey(cfg.programs.kill_game);
const FAUCET_ID = new web3.PublicKey(cfg.programs.kill_faucet);

function gameConfigPDA() {
    return web3.PublicKey.findProgramAddressSync(
        [Buffer.from("game_config")], GAME_ID
    );
}

function agentStackPDA(agentPubkey, stackId) {
    const idBuf = Buffer.alloc(2);
    idBuf.writeUInt16LE(stackId);
    return web3.PublicKey.findProgramAddressSync(
        [Buffer.from("agent_stack"), agentPubkey.toBuffer(), idBuf], GAME_ID
    );
}

function faucetConfigPDA() {
    return web3.PublicKey.findProgramAddressSync(
        [Buffer.from("faucet_config")], FAUCET_ID
    );
}

function claimRecordPDA(claimerPubkey) {
    return web3.PublicKey.findProgramAddressSync(
        [Buffer.from("claim_record"), claimerPubkey.toBuffer()], FAUCET_ID
    );
}

// ── Token account helper ──────────────────────────────────────────────────────
// Returns the Associated Token Account address for a given wallet + mint.
const { getAssociatedTokenAddressSync } = require("@solana/spl-token");

function killATA(ownerPubkey) {
    return getAssociatedTokenAddressSync(KILL_MINT, ownerPubkey);
}

// ── Display helpers ───────────────────────────────────────────────────────────
const DECIMALS = cfg.constants.kill_decimals;

function fmtKill(raw) {
    return (Number(raw) / 10 ** DECIMALS).toLocaleString(undefined, { maximumFractionDigits: 2 });
}

function fmtSol(lamports) {
    return (Number(lamports) / web3.LAMPORTS_PER_SOL).toFixed(6);
}

function txLink(sig) {
    return `${cfg.network.explorer}/tx/${sig}?cluster=${cfg.network.cluster}`;
}

// ── Bootstrap: returns everything a script needs ──────────────────────────────
async function setup() {
    const wallet   = loadWallet();
    const provider = makeProvider(wallet);
    const programs = loadPrograms(provider);
    return {
        wallet,
        connection: provider.connection,
        provider,
        ...programs,
        // PDAs bound to this wallet
        myKillATA:      killATA(wallet.publicKey),
        gameConfigAddr: gameConfigPDA()[0],
        // helpers
        gameConfigPDA, agentStackPDA, faucetConfigPDA, claimRecordPDA, killATA,
        fmtKill, fmtSol, txLink,
        KILL_MINT, DECIMALS,
        cfg
    };
}

module.exports = { setup, loadWallet, makeProvider, loadPrograms,
    gameConfigPDA, agentStackPDA, faucetConfigPDA, claimRecordPDA, killATA,
    fmtKill, fmtSol, txLink, KILL_MINT, DECIMALS, cfg };
