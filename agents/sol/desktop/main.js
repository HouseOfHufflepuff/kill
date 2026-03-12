"use strict";
const { app, BrowserWindow, ipcMain, shell } = require("electron");
const path = require("path");
const fs   = require("fs");
const anchor = require("@coral-xyz/anchor");
const web3   = anchor.web3;
const { getOrCreateAssociatedTokenAccount, getAssociatedTokenAddressSync, getAccount } = require("@solana/spl-token");

// ── Paths ─────────────────────────────────────────────────────────────────────
const AGENTS_DIR = path.join(__dirname, "agents");
const IDL_DIR    = path.join(__dirname, "idl");
const ENV_PATH   = path.join(app.getPath("userData"), ".env");

const IDL_GAME   = JSON.parse(fs.readFileSync(path.join(IDL_DIR, "kill_game.json"),   "utf8"));
const IDL_FAUCET = JSON.parse(fs.readFileSync(path.join(IDL_DIR, "kill_faucet.json"), "utf8"));

// ── State ─────────────────────────────────────────────────────────────────────
let mainWindow = null;
let agentTimer = null;
let scanTimer  = null;
let wallet     = null;
let startingSol  = null;
let startingKill = null;

// ── Block Scanner ──────────────────────────────────────────────────────────────
function startBlockScan() {
  if (scanTimer) return;
  try {
    const cfg  = JSON.parse(fs.readFileSync(path.join(AGENTS_DIR, "config.json"), "utf8"));
    const conn = new web3.Connection(cfg.network.rpc_url, "confirmed");
    scanTimer = setInterval(async () => {
      try {
        const slot = await conn.getSlot("confirmed");
        send("block-scan", { slot });
      } catch (_) {}
    }, 2000);
    console.log("[SCAN] Block scanner started");
  } catch (e) {
    console.log("[SCAN] Failed to start block scanner:", e.message);
  }
}

function stopBlockScan() {
  if (scanTimer) { clearInterval(scanTimer); scanTimer = null; }
}

// ── Window ────────────────────────────────────────────────────────────────────
function createWindow() {
  const iconPath = path.join(__dirname, "icon.png");
  mainWindow = new BrowserWindow({
    width: 900, height: 700,
    title: "KILLGame SOL",
    icon: iconPath,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  mainWindow.loadFile("index.html");
}

app.whenReady().then(() => {
  if (process.platform === "darwin" && app.dock) {
    try { app.dock.setIcon(path.join(__dirname, "icon.png")); } catch (_) {}
  }
  createWindow();
  if (fs.existsSync(ENV_PATH)) {
    try {
      const raw = fs.readFileSync(ENV_PATH, "utf8");
      const match = raw.match(/AGENT_PK=(.+)/);
      if (match) {
        const kp = web3.Keypair.fromSecretKey(Uint8Array.from(JSON.parse(match[1])));
        wallet = kp;
        mainWindow.webContents.once("did-finish-load", async () => {
          const addr = kp.publicKey.toBase58();
          mainWindow.webContents.send("wallet-loaded", addr);
          startBlockScan();
          // Try devnet airdrop on startup if wallet is unfunded
          try {
            const cfg = JSON.parse(fs.readFileSync(path.join(AGENTS_DIR, "config.json"), "utf8"));
            const conn = new web3.Connection(cfg.network.rpc_url, "confirmed");
            const solBal = await conn.getBalance(kp.publicKey);
            if (solBal === 0) {
              console.log("[STARTUP] SOL = 0, requesting devnet airdrop...");
              try {
                const sig = await conn.requestAirdrop(kp.publicKey, 1e9); // 1 SOL
                await conn.confirmTransaction(sig, "confirmed");
                console.log("[STARTUP] Airdrop confirmed:", sig);
                send("agent-airdrop", { success: true, sol: 1 });
              } catch (aerr) {
                console.log("[STARTUP] Airdrop failed:", aerr.message);
                send("agent-unfunded", { address: addr });
              }
            }
          } catch (e) {
            console.log("[STARTUP] Balance check failed:", e.message);
          }
        });
      }
    } catch (_) {}
  }
});
app.on("window-all-closed", () => { stopBlockScan(); app.quit(); });

// ── Wallet IPC ────────────────────────────────────────────────────────────────
ipcMain.handle("generate-wallet", async () => {
  const kp = web3.Keypair.generate();
  const keyArray = Array.from(kp.secretKey);
  fs.writeFileSync(ENV_PATH, `AGENT_PK=${JSON.stringify(keyArray)}\n`);
  wallet = kp;
  startBlockScan();
  return { address: kp.publicKey.toBase58(), privateKey: JSON.stringify(keyArray) };
});

ipcMain.handle("import-wallet", async (_e, input) => {
  let keyArray;
  try { keyArray = JSON.parse(input); }
  catch { throw new Error("Invalid JSON array"); }
  if (!Array.isArray(keyArray) || keyArray.length !== 64) {
    throw new Error("Must be a 64-byte array");
  }
  const kp = web3.Keypair.fromSecretKey(Uint8Array.from(keyArray));
  fs.writeFileSync(ENV_PATH, `AGENT_PK=${JSON.stringify(keyArray)}\n`);
  wallet = kp;
  startBlockScan();
  return kp.publicKey.toBase58();
});

// ── Agent IPC ─────────────────────────────────────────────────────────────────
function send(channel, data) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(channel, data);
  }
}

function makePrograms(w, connection, config) {
  const anchorWallet = new anchor.Wallet(w);
  const provider = new anchor.AnchorProvider(connection, anchorWallet, { commitment: "confirmed" });
  return {
    killGame:   new anchor.Program(IDL_GAME,   provider),
    killFaucet: new anchor.Program(IDL_FAUCET, provider),
    GAME_ID:    new web3.PublicKey(config.network.programs.kill_game),
    FAUCET_ID:  new web3.PublicKey(config.network.programs.kill_faucet),
  };
}

function calcPower(units, reapers) {
  return BigInt(units.toString()) + BigInt(reapers.toString()) * 666n;
}

function fmtPow(n) {
  const v = Number(n);
  if (v >= 1e9) return (v / 1e9).toFixed(1) + "B";
  if (v >= 1e6) return (v / 1e6).toFixed(1) + "M";
  if (v >= 1e3) return Math.round(v / 1e3) + "K";
  return String(Math.round(v));
}

function gameConfigPDA(gameId) {
  return web3.PublicKey.findProgramAddressSync([Buffer.from("game_config")], gameId)[0];
}

async function getBalances(w, connection, killMint) {
  const solBal = await connection.getBalance(w.publicKey);
  let killBal = 0;
  try {
    const ata = getAssociatedTokenAddressSync(killMint, w.publicKey);
    const acct = await getAccount(connection, ata);
    killBal = Number(acct.amount) / 1e6;
  } catch (_) {}
  return { sol: solBal / web3.LAMPORTS_PER_SOL, kill: killBal };
}

ipcMain.handle("start-agent", async (_e, strategyName) => {
  if (!wallet) throw new Error("No wallet configured");
  if (agentTimer) { clearInterval(agentTimer); agentTimer = null; }
  stopBlockScan();

  const config   = JSON.parse(fs.readFileSync(path.join(AGENTS_DIR, "config.json"), "utf8"));
  const playbook = JSON.parse(fs.readFileSync(path.join(AGENTS_DIR, "playbook.json"), "utf8"));
  const rpcUrl   = config.network.rpc_url;
  const connection = new web3.Connection(rpcUrl, "confirmed");
  const KILL_MINT  = new web3.PublicKey(config.network.kill_mint);

  const { killGame, killFaucet, GAME_ID, FAUCET_ID } = makePrograms(wallet, connection, config);
  const gcAddr = gameConfigPDA(GAME_ID);
  const gc     = await killGame.account.gameConfig.fetch(gcAddr);

  // Load capabilities
  const slots = playbook.strategy.flatMap(runName =>
    playbook.runs[runName].map((cap) => cap)
  );
  const capNames = [...new Set(slots)];
  const capabilities = {};
  for (const name of capNames) {
    capabilities[name] = require(path.join(AGENTS_DIR, name, "capability"));
  }

  let slotIndex = 0;
  let lastSlot  = 0;
  const SLOT_DELTA = config.settings.SLOT_DELTA || 25;

  // Record starting balances for P&L
  const startBal = await getBalances(wallet, connection, KILL_MINT);
  startingSol  = startBal.sol;
  startingKill = startBal.kill;

  // Attempt faucet claim
  try {
    const { claimFaucet } = require(path.join(AGENTS_DIR, "common"));
    await claimFaucet(killFaucet, wallet, connection, KILL_MINT, FAUCET_ID);
  } catch (_) {}

  console.log("[AGENT] Starting. Wallet:", wallet.publicKey.toBase58());
  console.log("[AGENT] Slots:", slots);
  console.log("[AGENT] SLOT_DELTA:", SLOT_DELTA);
  console.log("[AGENT] Starting SOL:", startingSol, "KILL:", startingKill);
  send("agent-status", { running: true, strategy: playbook.strategy });

  agentTimer = setInterval(async () => {
    try {
      const slot = await connection.getSlot("confirmed");
      const needed = lastSlot + SLOT_DELTA;
      if (slot < needed) {
        console.log(`[AGENT] Waiting for slot ${needed}, current ${slot}`);
        return;
      }
      lastSlot = slot;

      const capName = slots[slotIndex % slots.length];
      slotIndex++;
      console.log(`[AGENT] Slot ${slot} — running capability: ${capName}`);

      const mergedConfig = {
        ...config,
        settings: { ...config.settings, ...(config.settings[capName] || {}) },
      };
      console.log(`[AGENT] Merged settings for ${capName}:`, JSON.stringify(mergedConfig.settings));

      const balances = await getBalances(wallet, connection, KILL_MINT);
      console.log(`[AGENT] Balances — SOL: ${balances.sol.toFixed(4)}, KILL: ${balances.kill}`);

      if (balances.sol === 0) {
        console.log("[AGENT] No SOL — skipping capability, sending unfunded.");
        send("agent-unfunded", { address: wallet.publicKey.toBase58() });
        return;
      }

      // Get total power
      let totalPower = 0n;
      const myKey = wallet.publicKey.toBase58();
      const allStacks = await killGame.account.agentStack.all([]);
      for (const { account: s } of allStacks) {
        if (s.agent.toBase58() === myKey) {
          totalPower += calcPower(BigInt(s.units.toString()), BigInt(s.reapers.toString()));
        }
      }
      console.log(`[AGENT] Total power: ${totalPower}`);

      const pnlSol  = balances.sol - startingSol;
      const pnlKill = balances.kill - startingKill;

      send("agent-tick", {
        slot, capName,
        sol: balances.sol.toFixed(4),
        kill: Math.round(balances.kill).toLocaleString(),
        power: fmtPow(totalPower),
        next: slots[(slotIndex) % slots.length],
        pnlSol: pnlSol.toFixed(4),
        pnlKill: Math.round(pnlKill).toLocaleString(),
      });

      const ctx = {
        wallet, connection, killGame, killFaucet,
        KILL_MINT, GAME_ID, FAUCET_ID,
        gameConfigAddr: gcAddr,
        gameVault: gc.gameVault,
        config: mergedConfig,
      };

      console.log(`[AGENT] Calling ${capName}.run()...`);
      const sections = await capabilities[capName].run({ ...ctx, slot });
      console.log(`[AGENT] ${capName}.run() returned:`, JSON.stringify(sections));

      if (Array.isArray(sections)) {
        const stripAnsi = (s) => {
          // Preserve OSC8 hyperlinks as __TXLINK:URL__ before stripping
          let out = String(s).replace(
            /\x1b\]8;;([^\x1b]*)\x1b\\[\s\S]*?\x1b\]8;;\x1b\\/g,
            (_, url) => url ? `__TXLINK:${url}__` : ""
          );
          return out.replace(/\x1b[^m]*m/g, "");
        };
        const clean = sections.map(sec => ({
          title: stripAnsi(sec.title || ""),
          rows: (sec.rows || []).map(row => {
            const r = {};
            for (const [k, v] of Object.entries(row)) r[k] = stripAnsi(v);
            return r;
          }),
        }));
        send("agent-sections", clean);
      } else {
        console.warn(`[AGENT] ${capName}.run() did not return an array — got:`, typeof sections);
      }
    } catch (e) {
      console.error("[AGENT] Error in interval:", e.message);
      console.error(e.stack);
      send("agent-error", e.message);
    }
  }, 2000);
});

ipcMain.handle("stop-agent", async () => {
  if (agentTimer) { clearInterval(agentTimer); agentTimer = null; }
  send("agent-status", { running: false });
  startBlockScan();
});

ipcMain.handle("get-balances", async () => {
  if (!wallet) throw new Error("No wallet");
  const config    = JSON.parse(fs.readFileSync(path.join(AGENTS_DIR, "config.json"), "utf8"));
  const conn      = new web3.Connection(config.network.rpc_url, "confirmed");
  const KILL_MINT = new web3.PublicKey(config.network.kill_mint);
  return await getBalances(wallet, conn, KILL_MINT);
});

ipcMain.handle("get-strategies", async () => {
  const agentsDir = path.join(AGENTS_DIR);
  const dirs = fs.readdirSync(agentsDir).filter(d => {
    const p = path.join(agentsDir, d, "capability.js");
    return fs.existsSync(p);
  });
  return dirs;
});

ipcMain.handle("get-config", async () => {
  const config   = JSON.parse(fs.readFileSync(path.join(AGENTS_DIR, "config.json"), "utf8"));
  const playbook = JSON.parse(fs.readFileSync(path.join(AGENTS_DIR, "playbook.json"), "utf8"));
  return { config, playbook };
});

ipcMain.handle("open-external", async (_e, url) => {
  await shell.openExternal(url);
});

ipcMain.handle("save-config", async (_e, data) => {
  if (data.config) {
    fs.writeFileSync(path.join(AGENTS_DIR, "config.json"), JSON.stringify(data.config, null, 2) + "\n");
  }
  if (data.playbook) {
    fs.writeFileSync(path.join(AGENTS_DIR, "playbook.json"), JSON.stringify(data.playbook, null, 2) + "\n");
  }
  return true;
});
