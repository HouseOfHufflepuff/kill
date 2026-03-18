"use strict";
// agents/common/format.js — Shared formatting utilities for KILL agents

/**
 * Format a large number with K/M/B suffix for compact display.
 * Works with Number, BigInt, ethers.BigNumber, or BN.
 */
function fmtPow(n) {
    const v = Number(n);
    if (v >= 1e9) return (v / 1e9).toFixed(1) + 'B';
    if (v >= 1e6) return (v / 1e6).toFixed(1) + 'M';
    if (v >= 1e3) return Math.round(v / 1e3) + 'K';
    return String(Math.round(v));
}

module.exports = { fmtPow };
