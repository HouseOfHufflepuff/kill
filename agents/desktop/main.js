"use strict";
const { app, BrowserWindow, ipcMain, shell } = require("electron");
const path = require("path");
const fs   = require("fs");

// ── Lazy chain deps (loaded on demand) ────────────────────────────────────
let anchor, web3, splToken;
function loadSolanaDeps() {
  if (anchor) return;
  anchor   = require("@coral-xyz/anchor");
  web3     = anchor.web3;
  splToken = require("@solana/spl-token");
}

let ethersLib;
function loadBaseDeps() {
  if (ethersLib) return;
  ethersLib = require("ethers");
  // Shim require('hardhat') → { ethers } so Base capabilities work unmodified
  const Module = require("module");
  const origRequire = Module.prototype.require;
  Module.prototype.require = function (id) {
    if (id === "hardhat") return { ethers: ethersLib };
    return origRequire.call(this, id);
  };
}

// fmtPow loaded after app.isPackaged is known (see AGENTS_ROOT)
let fmtPow;
function loadFmtPow() {
  if (fmtPow) return;
  fmtPow = require(path.join(AGENTS_ROOT, "common", "format")).fmtPow;
}

// ── Dev mode isolation ────────────────────────────────────────────────────
const isDev = !app.isPackaged;
if (isDev) {
  app.setName("killgame-dev");
  app.setPath("userData", path.join(app.getPath("appData"), "killgame-dev"));
}

// ── Paths ─────────────────────────────────────────────────────────────────
const DESKTOP_DIR = __dirname;
// In packaged builds, extraResources land in process.resourcesPath/agents/
// In dev, agents are siblings of the desktop dir.
const AGENTS_ROOT = app.isPackaged
  ? path.join(process.resourcesPath, "agents")
  : path.resolve(DESKTOP_DIR, "..");
const SOL_AGENTS_DIR  = path.join(AGENTS_ROOT, "sol");
const BASE_AGENTS_DIR = path.join(AGENTS_ROOT, "base");
const IDL_DIR    = path.join(DESKTOP_DIR, "idl");
const USER_DATA  = app.getPath("userData");
const ENV_PATH   = path.join(USER_DATA, ".env");
const NETWORK_PATH = path.join(USER_DATA, "network.json");

// ── Chain state ───────────────────────────────────────────────────────────
let currentChain = "solana"; // 'solana' | 'base'

function loadNetworkPref() {
  try {
    if (fs.existsSync(NETWORK_PATH)) {
      const d = JSON.parse(fs.readFileSync(NETWORK_PATH, "utf8"));
      if (d.chain === "solana" || d.chain === "base") currentChain = d.chain;
    }
  } catch (_) {}
}

function saveNetworkPref() {
  fs.writeFileSync(NETWORK_PATH, JSON.stringify({ chain: currentChain }) + "\n");
}

loadNetworkPref();

// ── Per-chain config paths ────────────────────────────────────────────────
function agentsDir()       { return currentChain === "solana" ? SOL_AGENTS_DIR : BASE_AGENTS_DIR; }
function userConfigPath()  { return path.join(USER_DATA, `config-${currentChain}.json`); }
function userPlaybookPath(){ return path.join(USER_DATA, `playbook-${currentChain}.json`); }

function ensureUserConfig() {
  const cfgPath = userConfigPath();
  const pbPath  = userPlaybookPath();
  if (!fs.existsSync(cfgPath)) {
    const src = path.join(agentsDir(), "config.json");
    if (fs.existsSync(src)) fs.copyFileSync(src, cfgPath);
  }
  if (!fs.existsSync(pbPath)) {
    const src = path.join(agentsDir(), "playbook.json");
    if (fs.existsSync(src)) fs.copyFileSync(src, pbPath);
  }
}

function readConfig()   { ensureUserConfig(); return JSON.parse(fs.readFileSync(userConfigPath(), "utf8")); }
function readPlaybook() { ensureUserConfig(); return JSON.parse(fs.readFileSync(userPlaybookPath(), "utf8")); }

// Solana IDLs (loaded lazily)
let IDL_GAME, IDL_FAUCET;
function loadSolanaIDLs() {
  if (!IDL_GAME)   IDL_GAME   = JSON.parse(fs.readFileSync(path.join(IDL_DIR, "kill_game.json"), "utf8"));
  if (!IDL_FAUCET) IDL_FAUCET = JSON.parse(fs.readFileSync(path.join(IDL_DIR, "kill_faucet.json"), "utf8"));
}

// Base ABI (loaded lazily)
let BASE_ABI;
function loadBaseABI() {
  if (!BASE_ABI) BASE_ABI = JSON.parse(fs.readFileSync(path.join(BASE_AGENTS_DIR, "KillGame.json"), "utf8")).abi;
}

const ERC20_ABI = [
  "function balanceOf(address) view returns (uint256)",
  "function allowance(address, address) view returns (uint256)",
  "function approve(address, uint256) returns (bool)",
  "function transfer(address, uint256) returns (bool)",
];

const FAUCET_ABI = [
  "function pullKill() external",
  "function hasClaimed(address) view returns (bool)",
];

// ── State ─────────────────────────────────────────────────────────────────
let mainWindow   = null;
let agentTimer   = null;
let scanTimer    = null;
let wallet       = null; // Keypair (sol) or ethers.Wallet (base)
let startingNative = null;
let startingKill   = null;

// ── Env helpers ───────────────────────────────────────────────────────────
function envKey() { return currentChain === "solana" ? "AGENT_PK_SOL" : "AGENT_PK_BASE"; }

function readEnv() {
  if (!fs.existsSync(ENV_PATH)) return {};
  const raw = fs.readFileSync(ENV_PATH, "utf8");
  const env = {};
  for (const line of raw.split("\n")) {
    const m = line.match(/^([A-Z_]+)=(.+)$/);
    if (m) env[m[1]] = m[2];
  }
  return env;
}

function writeEnvKey(key, value) {
  const env = readEnv();
  env[key] = value;
  const out = Object.entries(env).map(([k, v]) => `${k}=${v}`).join("\n") + "\n";
  fs.writeFileSync(ENV_PATH, out);
}

// ── Wallet helpers ────────────────────────────────────────────────────────
function loadWalletFromEnv() {
  const env = readEnv();
  const pk = env[envKey()];
  if (!pk) return null;
  if (currentChain === "solana") {
    loadSolanaDeps();
    return web3.Keypair.fromSecretKey(Uint8Array.from(JSON.parse(pk)));
  } else {
    loadBaseDeps();
    return new ethersLib.Wallet(pk);
  }
}

function walletAddress(w) {
  if (!w) return null;
  return currentChain === "solana" ? w.publicKey.toBase58() : w.address;
}

function explorerUrl(addr) {
  if (currentChain === "solana") {
    return `https://explorer.solana.com/address/${addr}?cluster=devnet`;
  }
  const cfg = readConfig();
  const base = (cfg.network.block_explorer || "https://sepolia.basescan.org/tx").replace(/\/tx\/?$/, "");
  return `${base}/address/${addr}`;
}

// ── Block / Slot scanner ──────────────────────────────────────────────────
function startBlockScan() {
  if (scanTimer) return;
  try {
    const cfg = readConfig();
    if (currentChain === "solana") {
      loadSolanaDeps();
      const conn = new web3.Connection(cfg.network.rpc_url, "confirmed");
      scanTimer = setInterval(async () => {
        try { send("block-scan", { slot: await conn.getSlot("confirmed") }); } catch (_) {}
      }, 2000);
    } else {
      loadBaseDeps();
      const provider = new ethersLib.providers.JsonRpcProvider(cfg.network.rpc_url);
      scanTimer = setInterval(async () => {
        try { send("block-scan", { slot: await provider.getBlockNumber() }); } catch (_) {}
      }, 4000);
    }
    console.log("[SCAN] Block scanner started for", currentChain);
  } catch (e) { console.log("[SCAN] Failed:", e.message); }
}

function stopBlockScan() { if (scanTimer) { clearInterval(scanTimer); scanTimer = null; } }

// ── Balance helpers ───────────────────────────────────────────────────────
async function getBalances_sol(w, connection, killMint) {
  const solBal = await connection.getBalance(w.publicKey);
  let killBal = 0;
  try {
    const ata  = splToken.getAssociatedTokenAddressSync(killMint, w.publicKey);
    const acct = await splToken.getAccount(connection, ata);
    killBal = Number(acct.amount) / 1e6;
  } catch (_) {}
  return { native: solBal / web3.LAMPORTS_PER_SOL, kill: killBal };
}

async function getBalances_base(w, provider, killTokenAddr) {
  const ethBal = await provider.getBalance(w.address);
  const killToken = new ethersLib.Contract(killTokenAddr, ERC20_ABI, provider);
  const killBal = await killToken.balanceOf(w.address);
  return {
    native: parseFloat(ethersLib.utils.formatEther(ethBal)),
    kill:   parseFloat(ethersLib.utils.formatEther(killBal)),
  };
}

// ── Solana helpers ────────────────────────────────────────────────────────
function calcPower(units, reapers) {
  return BigInt(units.toString()) + BigInt(reapers.toString()) * 666n;
}

function gameConfigPDA(gameId) {
  return web3.PublicKey.findProgramAddressSync([Buffer.from("game_config")], gameId)[0];
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

// ── Window ────────────────────────────────────────────────────────────────
function createWindow() {
  mainWindow = new BrowserWindow({
    width: 900, height: 700,
    title: "KILLGAME",
    icon: path.join(__dirname, "icon.png"),
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  mainWindow.loadFile("index.html");
}

function send(channel, data) {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send(channel, data);
}

// ── App ready ─────────────────────────────────────────────────────────────
app.whenReady().then(() => {
  if (process.platform === "darwin" && app.dock) {
    try { app.dock.setIcon(path.join(__dirname, "icon.png")); } catch (_) {}
  }
  createWindow();

  // Try loading wallet for current chain
  try {
    wallet = loadWalletFromEnv();
    if (wallet) {
      mainWindow.webContents.once("did-finish-load", async () => {
        const addr = walletAddress(wallet);
        send("wallet-loaded", { address: addr, chain: currentChain });
        startBlockScan();
        // Solana auto-airdrop on zero balance
        if (currentChain === "solana") {
          try {
            const cfg  = readConfig();
            const conn = new web3.Connection(cfg.network.rpc_url, "confirmed");
            const bal  = await conn.getBalance(wallet.publicKey);
            if (bal === 0) {
              try {
                const sig = await conn.requestAirdrop(wallet.publicKey, 1e9);
                await conn.confirmTransaction(sig, "confirmed");
                send("agent-airdrop", { success: true, amount: 1, unit: "SOL" });
              } catch (ae) {
                send("agent-unfunded", { address: addr });
              }
            }
          } catch (_) {}
        }
      });
    } else {
      // No wallet — send chain info so UI shows correct setup
      mainWindow.webContents.once("did-finish-load", () => {
        send("chain-changed", { chain: currentChain });
      });
    }
  } catch (_) {
    mainWindow.webContents.once("did-finish-load", () => {
      send("chain-changed", { chain: currentChain });
    });
  }
});

app.on("window-all-closed", () => { stopBlockScan(); app.quit(); });

// ── Network IPC ───────────────────────────────────────────────────────────
ipcMain.handle("get-network", () => currentChain);

ipcMain.handle("set-network", async (_e, chain) => {
  if (chain !== "solana" && chain !== "base") throw new Error("Invalid chain");
  if (chain === currentChain) return currentChain;

  // Stop any running agent and scanner
  if (agentTimer) { clearInterval(agentTimer); agentTimer = null; }
  stopBlockScan();

  currentChain = chain;
  saveNetworkPref();

  // Try loading wallet for new chain
  try { wallet = loadWalletFromEnv(); } catch (_) { wallet = null; }

  if (wallet) {
    const addr = walletAddress(wallet);
    send("wallet-loaded", { address: addr, chain: currentChain });
    startBlockScan();
  } else {
    send("chain-changed", { chain: currentChain });
  }
  return currentChain;
});

// ── Wallet IPC ────────────────────────────────────────────────────────────
ipcMain.handle("generate-wallet", async () => {
  if (currentChain === "solana") {
    loadSolanaDeps();
    const kp = web3.Keypair.generate();
    const keyArray = Array.from(kp.secretKey);
    writeEnvKey(envKey(), JSON.stringify(keyArray));
    wallet = kp;
    startBlockScan();
    return { address: kp.publicKey.toBase58(), privateKey: JSON.stringify(keyArray) };
  } else {
    loadBaseDeps();
    const w = ethersLib.Wallet.createRandom();
    writeEnvKey(envKey(), w.privateKey);
    wallet = w;
    startBlockScan();
    return { address: w.address, privateKey: w.privateKey };
  }
});

ipcMain.handle("import-wallet", async (_e, input) => {
  if (currentChain === "solana") {
    loadSolanaDeps();
    let keyArray;
    try { keyArray = JSON.parse(input); } catch { throw new Error("Invalid JSON array"); }
    if (!Array.isArray(keyArray) || keyArray.length !== 64) throw new Error("Must be a 64-byte array");
    const kp = web3.Keypair.fromSecretKey(Uint8Array.from(keyArray));
    writeEnvKey(envKey(), JSON.stringify(keyArray));
    wallet = kp;
    startBlockScan();
    return kp.publicKey.toBase58();
  } else {
    loadBaseDeps();
    const pk = input.trim();
    if (!/^0x[0-9a-fA-F]{64}$/.test(pk)) throw new Error("Must be a 0x-prefixed 64-char hex key");
    const w = new ethersLib.Wallet(pk);
    writeEnvKey(envKey(), pk);
    wallet = w;
    startBlockScan();
    return w.address;
  }
});

// ── Agent IPC ─────────────────────────────────────────────────────────────
function stripAnsi(s) {
  let out = String(s).replace(
    /\x1b\]8;;([^\x1b]*)\x1b\\[\s\S]*?\x1b\]8;;\x1b\\/g,
    (_, url) => url ? `__TXLINK:${url}__` : ""
  );
  return out.replace(/\x1b[^m]*m/g, "");
}

function cleanSections(sections) {
  return sections.map(sec => ({
    title: stripAnsi(sec.title || ""),
    rows: (sec.rows || []).map(row => {
      const r = {};
      for (const [k, v] of Object.entries(row)) r[k] = stripAnsi(v);
      return r;
    }),
  }));
}

ipcMain.handle("start-agent", async () => {
  if (!wallet) throw new Error("No wallet configured");
  if (agentTimer) { clearInterval(agentTimer); agentTimer = null; }
  stopBlockScan();

  const config   = readConfig();
  const playbook = readPlaybook();

  if (currentChain === "solana") {
    await startSolanaAgent(config, playbook);
  } else {
    await startBaseAgent(config, playbook);
  }
});

// ── Solana Agent ──────────────────────────────────────────────────────────
async function startSolanaAgent(config, playbook) {
  loadSolanaDeps();
  loadSolanaIDLs();
  loadFmtPow();

  const connection = new web3.Connection(config.network.rpc_url, "confirmed");
  const KILL_MINT  = new web3.PublicKey(config.network.kill_mint);
  const { killGame, killFaucet, GAME_ID, FAUCET_ID } = makePrograms(wallet, connection, config);
  const gcAddr = gameConfigPDA(GAME_ID);
  const gc     = await killGame.account.gameConfig.fetch(gcAddr);

  const slots = playbook.strategy.flatMap(r => playbook.runs[r].map(cap => cap));
  const capNames = [...new Set(slots)];
  const capabilities = {};
  for (const name of capNames) {
    capabilities[name] = require(path.join(SOL_AGENTS_DIR, name, "capability"));
  }

  let slotIndex = 0, lastSlot = 0;
  const SLOT_DELTA = config.settings.SLOT_DELTA || 25;

  const startBal = await getBalances_sol(wallet, connection, KILL_MINT);
  startingNative = startBal.native;
  startingKill   = startBal.kill;

  // Faucet claim
  try {
    const { claimFaucet } = require(path.join(SOL_AGENTS_DIR, "common"));
    await claimFaucet(killFaucet, wallet, connection, KILL_MINT, FAUCET_ID);
  } catch (_) {}

  console.log("[AGENT/SOL] Starting. Wallet:", wallet.publicKey.toBase58());
  send("agent-status", { running: true, strategy: playbook.strategy });

  agentTimer = setInterval(async () => {
    try {
      const slot = await connection.getSlot("confirmed");
      if (slot < lastSlot + SLOT_DELTA) return;
      lastSlot = slot;

      const capName = slots[slotIndex % slots.length];
      slotIndex++;

      const mergedConfig = { ...config, settings: { ...config.settings, ...(config.settings[capName] || {}) } };
      const balances = await getBalances_sol(wallet, connection, KILL_MINT);

      if (balances.native === 0) {
        send("agent-unfunded", { address: wallet.publicKey.toBase58() });
        return;
      }

      let totalPower = 0n;
      const myKey = wallet.publicKey.toBase58();
      const allStacks = await killGame.account.agentStack.all([]);
      for (const { account: s } of allStacks) {
        if (s.agent.toBase58() === myKey) {
          totalPower += calcPower(BigInt(s.units.toString()), BigInt(s.reapers.toString()));
        }
      }

      send("agent-tick", {
        slot, capName,
        native: balances.native.toFixed(4),
        kill: Math.round(balances.kill).toLocaleString(),
        power: fmtPow(totalPower),
        next: slots[slotIndex % slots.length],
        pnlNative: (balances.native - startingNative).toFixed(4),
        pnlKill: Math.round(balances.kill - startingKill).toLocaleString(),
      });

      const ctx = {
        wallet, connection, killGame, killFaucet,
        KILL_MINT, GAME_ID, FAUCET_ID,
        gameConfigAddr: gcAddr, gameVault: gc.gameVault,
        config: mergedConfig,
      };

      const sections = await capabilities[capName].run({ ...ctx, slot });
      if (Array.isArray(sections)) send("agent-sections", cleanSections(sections));
    } catch (e) {
      console.error("[AGENT/SOL]", e.message);
      send("agent-error", e.message);
    }
  }, 2000);
}

// ── Base Agent ────────────────────────────────────────────────────────────
async function startBaseAgent(config, playbook) {
  loadBaseDeps();
  loadBaseABI();

  const provider   = new ethersLib.providers.JsonRpcProvider(config.network.rpc_url);
  const baseWallet = wallet.connect(provider);
  const killGame   = new ethersLib.Contract(config.network.kill_game_addr, BASE_ABI, baseWallet);
  const killTokenAddr = await killGame.killToken();
  const killToken  = new ethersLib.Contract(killTokenAddr, ERC20_ABI, baseWallet);

  let killFaucet = null;
  if (config.network.kill_faucet_addr) {
    killFaucet = new ethersLib.Contract(config.network.kill_faucet_addr, FAUCET_ABI, baseWallet);
  }

  const slots = playbook.strategy.flatMap(r => playbook.runs[r].map(cap => cap));
  const capNames = [...new Set(slots)];
  const capabilities = {};
  for (const name of capNames) {
    capabilities[name] = require(path.join(BASE_AGENTS_DIR, name, "capability"));
  }

  let slotIndex = 0, lastBlock = 0;
  const BLOCK_DELTA = config.settings.BLOCK_DELTA || 6;

  const startBal = await getBalances_base(baseWallet, provider, killTokenAddr);
  startingNative = startBal.native;
  startingKill   = startBal.kill;

  // Faucet claim
  if (killFaucet) {
    try {
      const claimed = await killFaucet.hasClaimed(baseWallet.address);
      if (!claimed) {
        const tx = await killFaucet.pullKill({ gasLimit: 200000 });
        await tx.wait();
      }
    } catch (_) {}
  }

  console.log("[AGENT/BASE] Starting. Wallet:", baseWallet.address);
  send("agent-status", { running: true, strategy: playbook.strategy });

  agentTimer = setInterval(async () => {
    try {
      const bn = await provider.getBlockNumber();
      if (bn < lastBlock + BLOCK_DELTA) return;
      lastBlock = bn;

      const capName = slots[slotIndex % slots.length];
      slotIndex++;

      const mergedConfig = { ...config, settings: { ...config.settings, ...(config.settings[capName] || {}) } };
      const balances = await getBalances_base(baseWallet, provider, killTokenAddr);

      if (balances.native < 0.0001) {
        send("agent-unfunded", { address: baseWallet.address });
        return;
      }

      send("agent-tick", {
        slot: bn, capName,
        native: balances.native.toFixed(6),
        kill: Math.round(balances.kill).toLocaleString(),
        power: "—",
        next: slots[slotIndex % slots.length],
        pnlNative: (balances.native - startingNative).toFixed(6),
        pnlKill: Math.round(balances.kill - startingKill).toLocaleString(),
      });

      const ctx = {
        wallet: baseWallet, killGame, killToken, killFaucet,
        config: mergedConfig, bn,
      };

      const sections = await capabilities[capName].run(ctx);
      if (Array.isArray(sections)) send("agent-sections", cleanSections(sections));
    } catch (e) {
      console.error("[AGENT/BASE]", e.message);
      send("agent-error", e.message);
    }
  }, 4000);
}

ipcMain.handle("stop-agent", async () => {
  if (agentTimer) { clearInterval(agentTimer); agentTimer = null; }
  send("agent-status", { running: false });
  startBlockScan();
});

ipcMain.handle("get-balances", async () => {
  if (!wallet) throw new Error("No wallet");
  const config = readConfig();
  if (currentChain === "solana") {
    loadSolanaDeps();
    const conn = new web3.Connection(config.network.rpc_url, "confirmed");
    const KILL_MINT = new web3.PublicKey(config.network.kill_mint);
    return await getBalances_sol(wallet, conn, KILL_MINT);
  } else {
    loadBaseDeps();
    const provider = new ethersLib.providers.JsonRpcProvider(config.network.rpc_url);
    let killTokenAddr = config.network.kill_token_addr;
    if (!killTokenAddr) {
      loadBaseABI();
      const killGame = new ethersLib.Contract(config.network.kill_game_addr, BASE_ABI, provider);
      killTokenAddr = await killGame.killToken();
    }
    return await getBalances_base(wallet, provider, killTokenAddr);
  }
});

ipcMain.handle("get-strategies", async () => {
  const dir = agentsDir();
  return fs.readdirSync(dir).filter(d => {
    return fs.existsSync(path.join(dir, d, "capability.js"));
  });
});

ipcMain.handle("get-config", async () => {
  return { config: readConfig(), playbook: readPlaybook() };
});

ipcMain.handle("open-external", async (_e, url) => { await shell.openExternal(url); });

ipcMain.handle("save-config", async (_e, data) => {
  ensureUserConfig();
  if (data.config)   fs.writeFileSync(userConfigPath(),   JSON.stringify(data.config, null, 2) + "\n");
  if (data.playbook) fs.writeFileSync(userPlaybookPath(), JSON.stringify(data.playbook, null, 2) + "\n");
  return true;
});
