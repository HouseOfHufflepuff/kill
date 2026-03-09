"use strict";
// node agents-sol/agent.js
// Requires AGENT_PK=[...64 bytes...] in .env (Solana keypair JSON array).
// Override per-role with SEED_PK, SNIPER_PK, FORTRESS_PK, AFTERSHOCK_PK.
require("dotenv").config();
const fs     = require("fs");
const path   = require("path");
const anchor = require("@coral-xyz/anchor");
const web3   = anchor.web3;

const { CYA, RED, RES, onSlot, displayHeader, displayActivity, loadConfig,
        gameConfigPDA, claimFaucet } = require('./common');

// ── Wallet loader ─────────────────────────────────────────────────────────────
// AGENT_PK (or role-specific override) is a JSON array of 64 secret-key bytes,
// identical to the format of ~/.config/solana/id.json.

function loadKeypair(envKey) {
    const raw = process.env[envKey] || process.env.AGENT_PK;
    if (!raw) throw new Error(`Missing ${envKey} (or AGENT_PK) in .env`);
    return web3.Keypair.fromSecretKey(Uint8Array.from(JSON.parse(raw)));
}

// ── IDL loader ────────────────────────────────────────────────────────────────

const IDL_DIR    = path.join(__dirname, "../contracts-solana/target/idl");
const IDL_GAME   = JSON.parse(fs.readFileSync(path.join(IDL_DIR, "kill_game.json"),   "utf8"));
const IDL_FAUCET = JSON.parse(fs.readFileSync(path.join(IDL_DIR, "kill_faucet.json"), "utf8"));

// ── Program factory ───────────────────────────────────────────────────────────

function makePrograms(wallet, connection, config) {
    const anchorWallet = new anchor.Wallet(wallet);
    const provider     = new anchor.AnchorProvider(connection, anchorWallet, { commitment: "confirmed" });
    const GAME_ID   = new web3.PublicKey(config.network.programs.kill_game);
    const FAUCET_ID = new web3.PublicKey(config.network.programs.kill_faucet);
    return {
        provider,
        killGame:   new anchor.Program(IDL_GAME,   provider),
        killFaucet: new anchor.Program(IDL_FAUCET, provider),
        GAME_ID,
        FAUCET_ID,
    };
}

// ── Agent registration ─────────────────────────────────────────────────────────

async function registerAgent(wallet, config) {
    const identity = config["agent-identity"] || {};
    const supabaseUrl = config.settings.SUPABASE_URL;
    const supabaseKey = config.settings.SUPABASE_KEY;

    let ip = null;
    try {
        const ipRes = await fetch("https://api.ipify.org?format=json");
        if (ipRes.ok) ip = (await ipRes.json()).ip;
    } catch { /* non-fatal */ }

    const body = {
        "agent-address":      wallet.publicKey.toBase58(),
        "agent-name":         identity.name         || null,
        "agent-build":        identity.build        || null,
        "agent-capabilities": identity.capabilities || null,
        "agent-ip":           ip,
        "agent-updt":         new Date().toISOString(),
    };

    try {
        const res = await fetch(`${supabaseUrl}/functions/v1/agent-register`, {
            method:  "POST",
            headers: {
                "Content-Type":  "application/json",
                "Authorization": `Bearer ${supabaseKey}`,
            },
            body: JSON.stringify(body),
        });
        if (!res.ok) console.error(`[AGENT] Registration failed: ${res.status}`);
    } catch (e) {
        console.error(`[AGENT] Registration error: ${e.message}`);
    }
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
    const config   = JSON.parse(fs.readFileSync(path.join(__dirname, "config.json"), "utf8"));
    const playbook = JSON.parse(fs.readFileSync(path.join(__dirname, "playbook.json"), "utf8"));
    const { SLOT_DELTA } = config.settings;
    const rpcUrl  = process.env.SOLANA_RPC_URL || config.network.rpc_url;

    // Base wallet (used for init and as fallback per slot)
    const wallet     = loadKeypair("AGENT_PK");
    const connection = new web3.Connection(rpcUrl, "confirmed");
    const KILL_MINT  = new web3.PublicKey(config.network.kill_mint);

    const { killGame, killFaucet, GAME_ID, FAUCET_ID } = makePrograms(wallet, connection, config);

    const gcAddr  = gameConfigPDA(GAME_ID);
    const gc      = await killGame.account.gameConfig.fetch(gcAddr);

    const ctx = {
        wallet, connection, killGame, killFaucet,
        KILL_MINT, GAME_ID, FAUCET_ID,
        gameConfigAddr: gcAddr,
        gameVault:      gc.gameVault,
        config,
    };

    // Flatten strategy → ordered slot list
    const slots = playbook.strategy.flatMap(runName =>
        playbook.runs[runName].map((cap, i) => [`${runName}/block${i + 1}`, cap])
    );

    // Load unique capabilities and call init() once
    const capNames = [...new Set(slots.map(([, cap]) => cap))];
    const capabilities = {};
    for (const name of capNames) {
        const mod = require(`./${name}/capability`);
        // Each capability may declare a role-specific key env var
        const capCfg     = JSON.parse(fs.readFileSync(path.join(__dirname, name, 'config.json'), 'utf8'));
        const roleEnvKey  = `${capCfg.role.toUpperCase().replace('-', '_')}_PK`;
        const capWallet   = process.env[roleEnvKey] ? loadKeypair(roleEnvKey) : wallet;
        const { killGame: kg, killFaucet: kf } = makePrograms(capWallet, connection, config);
        const capCtx = { ...ctx, wallet: capWallet, killGame: kg, killFaucet: kf };
        if (typeof mod.init === 'function') await mod.init(capCtx);
        capabilities[name] = mod;
    }

    const capInfos   = capNames.map(name => {
        const c = JSON.parse(fs.readFileSync(path.join(__dirname, name, 'config.json'), 'utf8'));
        return `${c.role}@${c.build || 'dev'}`;
    });
    const runSummary = playbook.strategy.map(r => `${r}(${playbook.runs[r].length})`).join(' → ');

    let slotIndex = 0;
    console.log(`${CYA}[AGENT] Wallet  : ${wallet.publicKey.toBase58()}${RES}`);
    console.log(`${CYA}[AGENT] Loaded  : ${capInfos.join(' | ')}${RES}`);
    console.log(`${CYA}[AGENT] Strategy: ${runSummary} = ${slots.length} total slots${RES}`);
    console.log(`${CYA}[AGENT] SLOT_DELTA: ${SLOT_DELTA}${RES}`);

    // Register agent identity at startup and every 10 minutes
    await registerAgent(wallet, config);
    setInterval(() => registerAgent(wallet, config), 10 * 60 * 1000);

    // Attempt faucet claim at startup (once per wallet — skipped if already claimed or ineligible)
    await claimFaucet(killFaucet, wallet, connection, KILL_MINT, FAUCET_ID);

    onSlot(connection, SLOT_DELTA, async (slot) => {
        const [slotName, capName] = slots[slotIndex % slots.length];
        slotIndex++;

        // Per-slot wallet: SEED_PK, SNIPER_PK, etc. — falls back to AGENT_PK
        const capCfg     = JSON.parse(fs.readFileSync(path.join(__dirname, capName, 'config.json'), 'utf8'));
        const roleEnvKey  = `${capCfg.role.toUpperCase().replace('-', '_')}_PK`;
        const slotWallet  = process.env[roleEnvKey] ? loadKeypair(roleEnvKey) : wallet;
        const { killGame: kg, killFaucet: kf, provider } = makePrograms(slotWallet, connection, config);

        const slotCtx = {
            ...ctx,
            wallet:     slotWallet,
            killGame:   kg,
            killFaucet: kf,
            provider,
            config: {
                ...config,
                settings: { ...config.settings, ...(config.settings[capName] || {}) }
            },
        };

        console.clear();
        await displayHeader({
            title: `AGENT — ${capName}`, slot,
            wallet: slotWallet, connection, killMint: KILL_MINT,
            extra: { Run: slotName, Next: slots[slotIndex % slots.length][1] }
        });

        try {
            const sections = await capabilities[capName].run({ ...slotCtx, slot });
            if (Array.isArray(sections)) {
                for (const section of sections) displayActivity(section);
            }
        } catch (e) {
            console.error(`${RED}[${capName.toUpperCase()}] ${e.message}${RES}`);
        }
    });

    process.on("SIGINT", () => process.exit(0));
}

main().catch(console.error);
