"use strict";
// agents/common/config.js — Shared config loading and countdown for KILL agents

const fs   = require("fs");
const path = require("path");

// ── Config loader ────────────────────────────────────────────────────────────
// Merges a chain's config.json with the agent's own config.json.
// chainConfigDir: directory containing the chain-level config.json
// agentDir:       directory containing the agent's config.json

function loadConfig(chainConfigDir, agentDir) {
    const common = JSON.parse(fs.readFileSync(path.join(chainConfigDir, "config.json"), "utf8"));
    const agent  = JSON.parse(fs.readFileSync(path.join(agentDir, "config.json"), "utf8"));
    const agentBlock = common.settings[agent.role] || {};
    return {
        ...agent,
        network:  { ...common.network,  ...(agent.network  || {}) },
        settings: { ...common.settings, ...agentBlock, ...(agent.settings || {}) }
    };
}

// ── Countdown ────────────────────────────────────────────────────────────────

async function countdown(seconds, label = 'WAIT') {
    for (let i = seconds; i > 0; i--) {
        process.stdout.write(`\r[${label}] Recheck in ${i}s... `);
        await new Promise(r => setTimeout(r, 1000));
    }
    process.stdout.write('\r\x1b[K');
}

module.exports = { loadConfig, countdown };
