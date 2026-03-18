"use strict";
// agents/base/common.js — Base/EVM-specific utilities for KILL agents
// Re-exports shared code from agents/common/ so strategies keep using require('../common').

const fs   = require("fs");
const path = require("path");
const { ethers } = require("hardhat");

// ── Shared imports (re-exported) ─────────────────────────────────────────────

const { YEL, CYA, PNK, GRN, RED, RES, BRIGHT,
        displayActivity, displayHeader: _displayHeader } = require('../common/display');
const { createGrid } = require('../common/grid');
const { loadConfig: _loadConfig, countdown } = require('../common/config');

// Base uses 1-indexed stacks (1–216)
const { getCoords, getId, getManhattanDist, isAdjacent, getPath3D } = createGrid(1);

// ── ABIs ─────────────────────────────────────────────────────────────────────

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

// ── Power (ethers.BigNumber) ─────────────────────────────────────────────────

function calcPower(units, reapers) { return units.add(reapers.mul(666)); }

// ── Block listener ───────────────────────────────────────────────────────────

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

// ── Subgraph query ───────────────────────────────────────────────────────────

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

// ── Faucet claim ─────────────────────────────────────────────────────────────

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

// ── Basescan TX link ─────────────────────────────────────────────────────────

function txLink(hash) { return `https://sepolia.basescan.org/tx/${hash}`; }

// ── Base displayHeader wrapper ───────────────────────────────────────────────

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

    _displayHeader({
        title,
        cols: [
            { label: 'Block', value: String(bn),  width: 10 },
            { label: 'ETH',   value: ethStr,       width: 12 },
            { label: 'KILL',  value: killStr,       width: 20 },
            { label: 'MCap',  value: mcapStr,       width: 14 },
        ],
        extra: opts.extra,
    });
}

// ── Config loader (delegates to common, binds chain dir) ─────────────────────

function loadConfig(agentDir) {
    return _loadConfig(__dirname, agentDir);
}

// ── ABI loader ───────────────────────────────────────────────────────────────

function loadABI(relPath) {
    return JSON.parse(fs.readFileSync(path.resolve(__dirname, relPath), "utf8")).abi;
}

// ── Exports ──────────────────────────────────────────────────────────────────

module.exports = {
    YEL, CYA, PNK, GRN, RED, RES, BRIGHT,
    ERC20_ABI, FAUCET_ABI,
    getCoords, getId, getManhattanDist, isAdjacent, getPath3D,
    calcPower,
    countdown, onBlock, subgraphQuery, claimFaucet,
    displayHeader, displayActivity,
    txLink, loadABI, loadConfig,
};
