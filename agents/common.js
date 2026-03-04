"use strict";
// agents/common.js — Shared utilities for all KILL agents
// Usage: const { YEL, ERC20_ABI, countdown, ... } = require('../common');

const fs   = require("fs");
const path = require("path");
const { ethers } = require("hardhat");

// ── ANSI Colors ───────────────────────────────────────────────────────────────

const YEL   = "\x1b[33m";
const CYA   = "\x1b[36m";
const PNK   = "\x1b[35m";
const GRN   = "\x1b[32m";
const RED   = "\x1b[31m";
const RES   = "\x1b[0m";
const BRIGHT = "\x1b[1m";

// ── ABIs ──────────────────────────────────────────────────────────────────────

const ERC20_ABI = [
    "function balanceOf(address) view returns (uint256)",
    "function allowance(address, address) view returns (uint256)",
    "function approve(address, uint256) returns (bool)",
    "function transfer(address, uint256) returns (bool)"
];

const FAUCET_ABI = [
    "function pullKill() external",
    "function hasClaimed(address) view returns (bool)"
];

// ── Grid math (6×6×6 = 216 stacks) ───────────────────────────────────────────

function getCoords(id) {
    const v = Number(id) - 1;
    return { x: v % 6, y: Math.floor(v / 6) % 6, z: Math.floor(v / 36) };
}

function getId(x, y, z) { return (z * 36) + (y * 6) + x + 1; }

function getManhattanDist(id1, id2) {
    const c1 = getCoords(id1), c2 = getCoords(id2);
    return Math.abs(c1.x - c2.x) + Math.abs(c1.y - c2.y) + Math.abs(c1.z - c2.z);
}

function isAdjacent(id1, id2) { return getManhattanDist(id1, id2) === 1; }

function calcPower(units, reapers) { return units.add(reapers.mul(666)); }

function getPath3D(startId, endId) {
    let current = getCoords(startId);
    const target = getCoords(endId);
    const steps = [];
    while (current.x !== target.x || current.y !== target.y || current.z !== target.z) {
        const fromId = getId(current.x, current.y, current.z);
        if      (current.x !== target.x) current.x += (target.x > current.x ? 1 : -1);
        else if (current.y !== target.y) current.y += (target.y > current.y ? 1 : -1);
        else if (current.z !== target.z) current.z += (target.z > current.z ? 1 : -1);
        steps.push({ from: fromId, to: getId(current.x, current.y, current.z) });
    }
    return steps;
}

// ── Countdown ─────────────────────────────────────────────────────────────────

async function countdown(seconds, label = 'WAIT') {
    for (let i = seconds; i > 0; i--) {
        process.stdout.write(`\r[${label}] Recheck in ${i}s... `);
        await new Promise(r => setTimeout(r, 1000));
    }
    process.stdout.write('\r\x1b[K');
}

// ── Block listener ────────────────────────────────────────────────────────────
// Fires handler every `delta` blocks. Skips if a prior call is still running.
// Keeps the process alive via the provider's polling event loop.

function onBlock(provider, delta, handler) {
    let lastBlock = 0;
    let busy = false;
    provider.on("block", async (bn) => {
        if (bn < lastBlock + delta) return;
        if (busy) return;
        busy = true;
        lastBlock = bn;
        try { await handler(bn); }
        catch (e) { console.error("[onBlock]", e.message); }
        finally { busy = false; }
    });
}

// ── Subgraph query ────────────────────────────────────────────────────────────
// Lazy-requires node-fetch so agents that don't use subgraph don't need it.

async function subgraphQuery(url, query) {
    const fetch = require("node-fetch");
    const resp  = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query })
    });
    const json = await resp.json();
    return json.data;
}

// ── Faucet claim ──────────────────────────────────────────────────────────────

async function claimFaucet(killFaucet, walletAddress) {
    try {
        const claimed = await killFaucet.hasClaimed(walletAddress);
        if (!claimed) {
            console.log(`${YEL}[STARTUP] Claiming faucet...${RES}`);
            const tx = await killFaucet.pullKill({ gasLimit: 200000 });
            await tx.wait();
            console.log(`${GRN}[STARTUP] Faucet claimed.${RES}`);
        }
    } catch (e) {
        console.log(`${PNK}[STARTUP] Faucet skipped: ${e.reason || e.message}${RES}`);
    }
}

// ── Basescan TX link ──────────────────────────────────────────────────────────

function txLink(hash) { return `https://sepolia.basescan.org/tx/${hash}`; }

// ── Display utilities ─────────────────────────────────────────────────────────
// ANSI-aware string helpers so colored values align correctly in tables.

const _ANSI_RE = /\x1b\[[0-9;]*m/g;
function _visLen(s) { return String(s).replace(_ANSI_RE, '').length; }
function _pad(s, w) { return String(s) + ' '.repeat(Math.max(0, w - _visLen(s))); }

// Internal: render a single-row box table (header + one data row).
function _printBox(title, cols, color = CYA) {
    if (title) console.log(`\n${color}── ${title} ${'─'.repeat(Math.max(0, 60 - title.length))}${RES}`);
    console.log(color + '┌' + cols.map(c => '─'.repeat(c.width + 2)).join('┬') + '┐' + RES);
    console.log(color + '│' + cols.map(c => ' ' + _pad(c.label, c.width) + ' ').join(color + '│') + color + '│' + RES);
    console.log(color + '├' + cols.map(c => '─'.repeat(c.width + 2)).join('┼') + '┤' + RES);
    console.log(color + '│' + cols.map(c => ' ' + _pad(c.value, c.width) + ' ').join(color + '│') + color + '│' + RES);
    console.log(color + '└' + cols.map(c => '─'.repeat(c.width + 2)).join('┴') + '┘' + RES);
}

// displayHeader — standard 4-column header (Block, ETH, KILL, MCap) + agent extras.
// opts: { title, bn, wallet, killToken, pool?, poolAddr?, wethAddr?,
//         ETH_PRICE_USD?, TOTAL_SUPPLY?, extra?: Record<string,string> }
async function displayHeader(opts) {
    const { title, bn, wallet, killToken } = opts;
    const ethBal  = await wallet.getBalance();
    const killBal = await killToken.balanceOf(wallet.address);
    const ethStr  = parseFloat(ethers.utils.formatEther(ethBal)).toFixed(6);
    const killStr = Math.round(parseFloat(ethers.utils.formatEther(killBal))).toLocaleString();

    let mcapStr = 'N/A';
    const _pool = opts.pool || (opts.poolAddr
        ? new ethers.Contract(opts.poolAddr,
            ['function slot0() view returns (uint160,int24,uint16,uint16,uint16,uint8,bool)'],
            wallet.provider)
        : null);
    if (_pool && opts.wethAddr && opts.ETH_PRICE_USD && opts.TOTAL_SUPPLY) {
        try {
            const slot0 = await _pool.slot0();
            const tok0IsKill = killToken.address.toLowerCase() < opts.wethAddr.toLowerCase();
            const rawPrice   = Math.pow(1.0001, parseInt(slot0[1]));
            const killPerEth = tok0IsKill ? (1 / rawPrice) : rawPrice;
            const priceUsd   = (1 / killPerEth) * opts.ETH_PRICE_USD;
            mcapStr = `$${Math.round(priceUsd * opts.TOTAL_SUPPLY).toLocaleString()}`;
        } catch (_) { /* keep N/A */ }
    }

    const baseCols = [
        { label: 'Block', value: String(bn),  width: 10 },
        { label: 'ETH',   value: ethStr,       width: 12 },
        { label: 'KILL',  value: killStr,       width: 20 },
        { label: 'MCap',  value: mcapStr,       width: 14 },
    ];
    const extraCols = Object.entries(opts.extra || {}).map(([label, value]) => ({
        label, value: String(value),
        width: Math.max(label.length, _visLen(String(value)), 8)
    }));
    _printBox(title, [...baseCols, ...extraCols]);
}

// displayActivity — multi-row table driven by an array of plain objects.
// opts: { title?, rows: Array<Record<string,string>>, color? }
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
// Merges agents/config.json with the agent's own config.json.
// Agent-specific values override common values.
// Usage: const config = loadConfig(__dirname);

function loadConfig(agentDir) {
    const common = JSON.parse(fs.readFileSync(path.join(__dirname, "config.json"), "utf8"));
    const agent  = JSON.parse(fs.readFileSync(path.join(agentDir, "config.json"), "utf8"));
    // Flatten the agent-named block from common settings so role-specific
    // values (e.g. SEED_AMOUNT, HUB_PERIMETER) remain top-level in settings.
    const agentBlock = common.settings[agent.role] || {};
    return {
        ...agent,
        network:  { ...common.network,  ...(agent.network  || {}) },
        settings: { ...common.settings, ...agentBlock, ...(agent.settings || {}) }
    };
}

// ── ABI loader (path relative to agents/) ────────────────────────────────────
// Example: loadABI('./KillGame.json')

function loadABI(relPath) {
    return JSON.parse(fs.readFileSync(path.resolve(__dirname, relPath), "utf8")).abi;
}

// ── Exports ───────────────────────────────────────────────────────────────────

module.exports = {
    // Colors
    YEL, CYA, PNK, GRN, RED, RES, BRIGHT,
    // ABIs
    ERC20_ABI, FAUCET_ABI,
    // Grid
    getCoords, getId, getManhattanDist, isAdjacent, calcPower, getPath3D,
    // Async helpers
    countdown, onBlock, subgraphQuery, claimFaucet,
    // Display
    displayHeader, displayActivity,
    // Utils
    txLink, loadABI, loadConfig
};
