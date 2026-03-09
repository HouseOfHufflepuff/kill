"use strict";
// agents-sol/common.js — Shared utilities for all Solana KILL agents
require("dotenv").config();
const fs     = require("fs");
const path   = require("path");
const anchor = require("@coral-xyz/anchor");
const web3   = anchor.web3;
const { getAssociatedTokenAddressSync, getOrCreateAssociatedTokenAccount, getAccount } = require("@solana/spl-token");

// ── ANSI Colors ───────────────────────────────────────────────────────────────

const YEL   = "\x1b[33m";
const CYA   = "\x1b[36m";
const PNK   = "\x1b[35m";
const GRN   = "\x1b[32m";
const RED   = "\x1b[31m";
const RES   = "\x1b[0m";
const BRIGHT = "\x1b[1m";

// ── Grid math (0-based: 0–215, 6×6×6) ────────────────────────────────────────

function getCoords(id) {
    const v = Number(id);
    return { x: v % 6, y: Math.floor(v / 6) % 6, z: Math.floor(v / 36) };
}

function getId(x, y, z) { return (z * 36) + (y * 6) + x; }

function getManhattanDist(id1, id2) {
    const c1 = getCoords(id1), c2 = getCoords(id2);
    return Math.abs(c1.x - c2.x) + Math.abs(c1.y - c2.y) + Math.abs(c1.z - c2.z);
}

function isAdjacent(id1, id2) { return getManhattanDist(id1, id2) === 1; }

// All arithmetic uses BigInt — no ethers.BigNumber dependency
function calcPower(units, reapers) {
    return BigInt(units.toString()) + BigInt(reapers.toString()) * 666n;
}

// ── Countdown ─────────────────────────────────────────────────────────────────

async function countdown(seconds, label = 'WAIT') {
    for (let i = seconds; i > 0; i--) {
        process.stdout.write(`\r[${label}] Recheck in ${i}s... `);
        await new Promise(r => setTimeout(r, 1000));
    }
    process.stdout.write('\r\x1b[K');
}

// ── Slot polling ──────────────────────────────────────────────────────────────
// Polls every 2 s; fires handler once SLOT_DELTA slots have elapsed.

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

// ── Supabase query (replaces EVM subgraphQuery) ───────────────────────────────

async function supabaseQuery(supabaseUrl, supabaseKey, query) {
    const resp = await fetch(`${supabaseUrl}/graphql/v1`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "apikey": supabaseKey },
        body: JSON.stringify({ query })
    });
    const json = await resp.json();
    return json.data;
}

// ── Faucet claim ──────────────────────────────────────────────────────────────

async function claimFaucet(killFaucet, wallet, connection, KILL_MINT, faucetId) {
    try {
        const [faucetConfig] = web3.PublicKey.findProgramAddressSync(
            [Buffer.from("faucet_config")], faucetId
        );
        const [claimRecord] = web3.PublicKey.findProgramAddressSync(
            [Buffer.from("claim_record"), wallet.publicKey.toBuffer()], faucetId
        );

        // claimRecord exists → already claimed
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

// ── TX / explorer links ──────────────────────────────────────────────────────
// Uses ANSI OSC 8 hyperlinks — clickable in modern terminals (iTerm2, etc.)

function txLink(sig, cluster = 'devnet') {
    const url = `https://explorer.solana.com/tx/${sig}?cluster=${cluster}`;
    return `\x1b]8;;${url}\x1b\\${CYA}[ tx ]${RES}\x1b]8;;\x1b\\`;
}

function addrLink(pubkey, cluster = 'devnet') {
    const addr = typeof pubkey === 'string' ? pubkey : pubkey.toBase58();
    const url  = `https://explorer.solana.com/address/${addr}?cluster=${cluster}`;
    return `\x1b]8;;${url}\x1b\\${CYA}${addr}${RES}\x1b]8;;\x1b\\`;
}

// ── Display utilities ─────────────────────────────────────────────────────────

const _ANSI_RE = /\x1b(?:\[[0-9;]*m|\]8;;[^\x1b]*\x1b\\)/g;
function _visLen(s) { return String(s).replace(_ANSI_RE, '').length; }
function _pad(s, w) { return String(s) + ' '.repeat(Math.max(0, w - _visLen(s))); }

function _printBox(title, cols, color = CYA) {
    if (title) console.log(`\n${color}── ${title} ${'─'.repeat(Math.max(0, 60 - title.length))}${RES}`);
    console.log(color + '┌' + cols.map(c => '─'.repeat(c.width + 2)).join('┬') + '┐' + RES);
    console.log(color + '│' + cols.map(c => ' ' + _pad(c.label, c.width) + ' ').join(color + '│') + color + '│' + RES);
    console.log(color + '├' + cols.map(c => '─'.repeat(c.width + 2)).join('┼') + '┤' + RES);
    console.log(color + '│' + cols.map(c => ' ' + _pad(c.value, c.width) + ' ').join(color + '│') + color + '│' + RES);
    console.log(color + '└' + cols.map(c => '─'.repeat(c.width + 2)).join('┴') + '┘' + RES);
}

async function displayHeader({ title, slot, wallet, connection, killMint, extra }) {
    const solBal = await connection.getBalance(wallet.publicKey);
    const solStr = (solBal / web3.LAMPORTS_PER_SOL).toFixed(4);
    let killStr = '0';
    try {
        const ata  = getAssociatedTokenAddressSync(killMint, wallet.publicKey);
        const acct = await getAccount(connection, ata);
        killStr = Math.round(Number(acct.amount) / 1e6).toLocaleString();
    } catch (_) {}

    // Show wallet address with clickable explorer link
    const addr = wallet.publicKey.toBase58();
    console.log(`${CYA}   Agent: ${addrLink(addr)}${RES}`);

    const baseCols = [
        { label: 'Slot', value: String(slot), width: 12 },
        { label: 'SOL',  value: solStr,        width: 10 },
        { label: 'KILL', value: killStr,        width: 20 },
    ];
    const extraCols = Object.entries(extra || {}).map(([label, value]) => ({
        label, value: String(value),
        width: Math.max(label.length, _visLen(String(value)), 8)
    }));
    _printBox(title, [...baseCols, ...extraCols]);
}

function displayActivity(opts) {
    const { rows, color = YEL, title } = opts;
    if (!rows || rows.length === 0) return;
    const keys    = Object.keys(rows[0]);
    const widths  = keys.map(k => Math.max(k.length, ...rows.map(r => _visLen(String(r[k] ?? ''))), 6));
    const headers = keys.map((k, i) => ({ label: k, width: widths[i] }));
    if (title) console.log(`\n${color}── ${title} ${'─'.repeat(Math.max(0, 60 - title.length))}${RES}`);
    console.log(color + '┌' + headers.map(h => '─'.repeat(h.width + 2)).join('┬') + '┐' + RES);
    console.log(color + '│' + headers.map(h => ' ' + _pad(h.label, h.width) + ' ').join(color + '│') + color + '│' + RES);
    console.log(color + '├' + headers.map(h => '─'.repeat(h.width + 2)).join('┼') + '┤' + RES);
    rows.forEach(row => {
        console.log(color + '│' + headers.map(h => ' ' + _pad(String(row[h.label] ?? ''), h.width) + ' ').join(color + '│') + color + '│' + RES);
    });
    console.log(color + '└' + headers.map(h => '─'.repeat(h.width + 2)).join('┴') + '┘' + RES);
}

// ── Config loader ─────────────────────────────────────────────────────────────

function loadConfig(agentDir) {
    const common = JSON.parse(fs.readFileSync(path.join(__dirname, "config.json"), "utf8"));
    const agent  = JSON.parse(fs.readFileSync(path.join(agentDir, "config.json"), "utf8"));
    const agentBlock = common.settings[agent.role] || {};
    return {
        ...agent,
        network:  { ...common.network,  ...(agent.network  || {}) },
        settings: { ...common.settings, ...agentBlock, ...(agent.settings || {}) }
    };
}

// ── PDA helpers ───────────────────────────────────────────────────────────────

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

// ── Exports ───────────────────────────────────────────────────────────────────

module.exports = {
    YEL, CYA, PNK, GRN, RED, RES, BRIGHT,
    getCoords, getId, getManhattanDist, isAdjacent, calcPower,
    countdown, onSlot, supabaseQuery, claimFaucet,
    displayHeader, displayActivity,
    txLink, addrLink, loadConfig, gameConfigPDA, agentStackPDA,
};
