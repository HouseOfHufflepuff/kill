"use strict";
// agents/sol/common.js — Solana-specific utilities for KILL agents
// Re-exports shared code from agents/common/ so strategies keep using require('../common').
require("dotenv").config();
const anchor = require("@coral-xyz/anchor");
const web3   = anchor.web3;
const { getAssociatedTokenAddressSync, getOrCreateAssociatedTokenAccount, getAccount } = require("@solana/spl-token");

// ── Shared imports (re-exported) ─────────────────────────────────────────────

const { YEL, CYA, PNK, GRN, RED, RES, BRIGHT,
        displayActivity, displayHeader: _displayHeader } = require('../common/display');
const { createGrid } = require('../common/grid');
const { loadConfig: _loadConfig, countdown } = require('../common/config');

// Solana uses 0-indexed stacks (0–215)
const { getCoords, getId, getManhattanDist, isAdjacent, getPath3D } = createGrid(0);

// ── Power (BigInt — no ethers dependency) ────────────────────────────────────

function calcPower(units, reapers) {
    return BigInt(units.toString()) + BigInt(reapers.toString()) * 666n;
}

// Power decay — mirrors Rust power_decay_pct() in the contract.
// Returns BigInt in [5, 100]: 100 = fresh, 5 = ~3 days old.
const SLOTS_PER_MULTIPLIER = 13_224n;
const MAX_MULTIPLIER       = 50n;

function powerDecayPct(spawnSlot, currentSlot) {
    const ss = BigInt(spawnSlot.toString());
    const cs = BigInt(currentSlot.toString());
    if (ss <= 0n || cs <= ss) return 100n;
    const age  = cs - ss;
    const mult = (1n + age / SLOTS_PER_MULTIPLIER) < MAX_MULTIPLIER
        ? (1n + age / SLOTS_PER_MULTIPLIER) : MAX_MULTIPLIER;
    const decay = 100n - (mult - 1n) * 95n / 49n;
    return decay < 5n ? 5n : decay;
}

function calcEffectivePower(units, reapers, spawnSlot, currentSlot) {
    const raw   = calcPower(units, reapers);
    const decay = powerDecayPct(spawnSlot, currentSlot);
    return raw * decay / 100n;
}

// ── Slot polling ─────────────────────────────────────────────────────────────

function onSlot(connection, delta, handler) {
    let lastSlot = 0;
    let busy = false;
    const check = async () => {
        if (busy) return;
        try {
            const slot = await connection.getSlot("confirmed");
            if (slot < lastSlot + delta) return;
            busy = true;
            lastSlot = slot;
            try { await handler(slot); }
            catch (e) { console.error("[onSlot]", e.message); }
            finally { busy = false; }
        } catch (e) { console.error("[onSlot poll]", e.message); }
    };
    setInterval(check, 2000);
}

// ── Supabase query ───────────────────────────────────────────────────────────

async function supabaseQuery(supabaseUrl, supabaseKey, query) {
    const resp = await fetch(`${supabaseUrl}/graphql/v1`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "apikey": supabaseKey },
        body: JSON.stringify({ query })
    });
    const json = await resp.json();
    return json.data;
}

// ── Faucet claim ─────────────────────────────────────────────────────────────

async function claimFaucet(killFaucet, wallet, connection, KILL_MINT, faucetId) {
    try {
        const [faucetConfig] = web3.PublicKey.findProgramAddressSync(
            [Buffer.from("faucet_config")], faucetId
        );
        const [claimRecord] = web3.PublicKey.findProgramAddressSync(
            [Buffer.from("claim_record"), wallet.publicKey.toBuffer()], faucetId
        );

        try {
            await killFaucet.account.claimRecord.fetch(claimRecord);
            console.log(`${YEL}[STARTUP] Faucet already claimed.${RES}`);
            return;
        } catch (_) {}

        const fc = await killFaucet.account.faucetConfig.fetch(faucetConfig);
        const claimerAta = await getOrCreateAssociatedTokenAccount(
            connection, wallet, KILL_MINT, wallet.publicKey
        );
        console.log(`${YEL}[STARTUP] Claiming faucet...${RES}`);
        await killFaucet.methods.claim()
            .accounts({
                faucetConfig,
                claimRecord,
                faucetVault:         fc.faucetVault,
                claimerTokenAccount: claimerAta.address,
                killMint:            KILL_MINT,
                claimer:             wallet.publicKey,
            })
            .signers([wallet])
            .rpc();
        console.log(`${GRN}[STARTUP] Faucet claimed.${RES}`);
    } catch (e) {
        console.log(`${PNK}[STARTUP] Faucet skipped: ${e.message}${RES}`);
    }
}

// ── TX / explorer links ─────────────────────────────────────────────────────

function txLink(sig, cluster = 'devnet') {
    const url = `https://explorer.solana.com/tx/${sig}?cluster=${cluster}`;
    return `\x1b]8;;${url}\x1b\\${CYA}[ tx ]${RES}\x1b]8;;\x1b\\`;
}

function addrLink(pubkey, cluster = 'devnet') {
    const addr = typeof pubkey === 'string' ? pubkey : pubkey.toBase58();
    const url  = `https://explorer.solana.com/address/${addr}?cluster=${cluster}`;
    return `\x1b]8;;${url}\x1b\\${CYA}${addr}${RES}\x1b]8;;\x1b\\`;
}

// ── Solana displayHeader wrapper ─────────────────────────────────────────────

async function displayHeader({ title, slot, wallet, connection, killMint, killGame, extra }) {
    const solBal = await connection.getBalance(wallet.publicKey);
    const solStr = (solBal / web3.LAMPORTS_PER_SOL).toFixed(4);
    let killStr = '0';
    try {
        const ata  = getAssociatedTokenAddressSync(killMint, wallet.publicKey);
        const acct = await getAccount(connection, ata);
        killStr = Math.round(Number(acct.amount) / 1e6).toLocaleString();
    } catch (_) {}

    let pwrStr = '0';
    if (killGame) {
        try {
            const myKey = wallet.publicKey.toBase58();
            const allStacks = await killGame.account.agentStack.all([]);
            let totalPwr = 0n;
            for (const { account: s } of allStacks) {
                if (s.agent.toBase58() === myKey) {
                    totalPwr += calcPower(BigInt(s.units.toString()), BigInt(s.reapers.toString()));
                }
            }
            const v = Number(totalPwr);
            if (v >= 1e9) pwrStr = (v / 1e9).toFixed(1) + 'B';
            else if (v >= 1e6) pwrStr = (v / 1e6).toFixed(1) + 'M';
            else if (v >= 1e3) pwrStr = Math.round(v / 1e3) + 'K';
            else pwrStr = String(Math.round(v));
        } catch (_) {}
    }

    _displayHeader({
        title,
        agentLabel: addrLink(wallet.publicKey.toBase58()),
        cols: [
            { label: 'Slot', value: String(slot), width: 12 },
            { label: 'SOL',  value: solStr,        width: 10 },
            { label: 'KILL', value: killStr,        width: 20 },
            { label: 'PWR',  value: pwrStr,         width: 10 },
        ],
        extra,
    });
}

// ── Config loader (delegates to common, binds chain dir) ─────────────────────

function loadConfig(agentDir) {
    return _loadConfig(__dirname, agentDir);
}

// ── PDA helpers ──────────────────────────────────────────────────────────────

function gameConfigPDA(gameId) {
    return web3.PublicKey.findProgramAddressSync([Buffer.from("game_config")], gameId)[0];
}

function agentStackPDA(agentPubkey, stackId, gameId) {
    const idBuf = Buffer.alloc(2);
    idBuf.writeUInt16LE(stackId);
    return web3.PublicKey.findProgramAddressSync(
        [Buffer.from("agent_stack"), agentPubkey.toBuffer(), idBuf], gameId
    )[0];
}

// ── Exports ──────────────────────────────────────────────────────────────────

module.exports = {
    YEL, CYA, PNK, GRN, RED, RES, BRIGHT,
    getCoords, getId, getManhattanDist, isAdjacent, getPath3D,
    calcPower, powerDecayPct, calcEffectivePower,
    countdown, onSlot, supabaseQuery, claimFaucet,
    displayHeader, displayActivity,
    txLink, addrLink, loadConfig, gameConfigPDA, agentStackPDA,
};
