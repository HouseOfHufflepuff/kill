"use strict";
// agents/common/display.js — Chain-agnostic ANSI display utilities for KILL agents

// ── ANSI Colors ───────────────────────────────────────────────────────────────

const YEL   = "\x1b[33m";
const CYA   = "\x1b[36m";
const PNK   = "\x1b[35m";
const GRN   = "\x1b[32m";
const RED   = "\x1b[31m";
const RES   = "\x1b[0m";
const BRIGHT = "\x1b[1m";

// ── ANSI-aware string helpers ────────────────────────────────────────────────

const _ANSI_RE = /\x1b(?:\[[0-9;]*m|\]8;;[^\x1b]*\x1b\\)/g;
function _visLen(s) { return String(s).replace(_ANSI_RE, '').length; }
function _pad(s, w) { return String(s) + ' '.repeat(Math.max(0, w - _visLen(s))); }

// ── Box table (single data row) ──────────────────────────────────────────────

function _printBox(title, cols, color = CYA) {
    if (title) console.log(`\n${color}── ${title} ${'─'.repeat(Math.max(0, 60 - title.length))}${RES}`);
    console.log(color + '┌' + cols.map(c => '─'.repeat(c.width + 2)).join('┬') + '┐' + RES);
    console.log(color + '│' + cols.map(c => ' ' + _pad(c.label, c.width) + ' ').join(color + '│') + color + '│' + RES);
    console.log(color + '├' + cols.map(c => '─'.repeat(c.width + 2)).join('┼') + '┤' + RES);
    console.log(color + '│' + cols.map(c => ' ' + _pad(c.value, c.width) + ' ').join(color + '│') + color + '│' + RES);
    console.log(color + '└' + cols.map(c => '─'.repeat(c.width + 2)).join('┴') + '┘' + RES);
}

// ── Multi-row activity table ─────────────────────────────────────────────────
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

// ── displayHeader ────────────────────────────────────────────────────────────
// Chain-agnostic header renderer. Each chain passes its own columns.
// opts: { title, cols: [{label, value, width}], extra?: Record<string,string>, agentLabel? }

function displayHeader(opts) {
    const { title, cols, extra, agentLabel } = opts;
    if (agentLabel) console.log(`${CYA}   Agent: ${agentLabel}${RES}`);
    const extraCols = Object.entries(extra || {}).map(([label, value]) => ({
        label, value: String(value),
        width: Math.max(label.length, _visLen(String(value)), 8)
    }));
    _printBox(title, [...cols, ...extraCols]);
}

module.exports = {
    YEL, CYA, PNK, GRN, RED, RES, BRIGHT,
    _visLen, _pad, _printBox,
    displayActivity, displayHeader,
};
