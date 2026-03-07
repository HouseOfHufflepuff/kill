#!/bin/bash
# KILLGame Solana Agent Installer v1.0.0

set -e

BASE_URL="https://raw.githubusercontent.com/HouseOfHufflepuff/kill/main"
AGENTS="sniper fortress aftershock seed"

# 1. Scaffold directories
echo "[1/5] Scaffolding directories..."
for ROLE in $AGENTS; do
  mkdir -p "agents-sol/$ROLE"
done
mkdir -p "contracts-solana/target/idl"

# 2. Pull agent files from GitHub
echo "[2/5] Fetching agent files from GitHub..."
for ROLE in $AGENTS; do
  curl -f -s "$BASE_URL/agents-sol/$ROLE/capability.js" -o "agents-sol/$ROLE/capability.js"
  curl -f -s "$BASE_URL/agents-sol/$ROLE/config.json"   -o "agents-sol/$ROLE/config.json"
done
curl -f -s "$BASE_URL/agents-sol/agent.js"      -o "agents-sol/agent.js"
curl -f -s "$BASE_URL/agents-sol/common.js"     -o "agents-sol/common.js"
curl -f -s "$BASE_URL/agents-sol/playbook.json" -o "agents-sol/playbook.json"
curl -f -s "$BASE_URL/agents-sol/config.json"   -o "agents-sol/config.json"
curl -f -s "$BASE_URL/agents-sol/KillGame.json" -o "agents-sol/KillGame.json"

# IDL files (required by agent.js)
curl -f -s "$BASE_URL/contracts-solana/target/idl/kill_game.json"   -o "contracts-solana/target/idl/kill_game.json"
curl -f -s "$BASE_URL/contracts-solana/target/idl/kill_faucet.json" -o "contracts-solana/target/idl/kill_faucet.json"

# 3. Write package.json
echo "[3/5] Writing package.json..."
cat <<'EOT' > package.json
{
  "name": "killsol",
  "version": "1.0.0",
  "bin": { "killsol": "./cli.js" },
  "dependencies": {
    "dotenv": "^16.4.5",
    "@coral-xyz/anchor": "^0.30.1",
    "@solana/web3.js": "^1.98.0",
    "@solana/spl-token": "^0.4.9"
  }
}
EOT

# 4. Write cli.js
echo "[4/5] Writing CLI..."
cat <<'CLIEOF' > cli.js
#!/usr/bin/env node
"use strict";
const fs        = require("fs");
const path      = require("path");
const { spawn } = require("child_process");
const readline  = require("readline");
const ROOT      = __dirname;
require("dotenv").config({ path: path.join(ROOT, ".env") });

const cmd = process.argv[2];

// ── Helpers ───────────────────────────────────────────────────────────────────
function saveKey(keyArray) {
  const envPath  = path.join(ROOT, ".env");
  const existing = fs.existsSync(envPath) ? fs.readFileSync(envPath, "utf8") : "";
  const lines    = existing.split("\n").filter(l => !l.startsWith("AGENT_PK=") && l.trim() !== "");
  lines.push(`AGENT_PK=${JSON.stringify(keyArray)}`);
  fs.writeFileSync(envPath, lines.join("\n") + "\n");
}

async function airdrop(pubkey) {
  const { Connection, PublicKey, LAMPORTS_PER_SOL } = require("@solana/web3.js");
  const cfgPath = path.join(ROOT, "agents-sol", "config.json");
  const rpc     = fs.existsSync(cfgPath)
    ? JSON.parse(fs.readFileSync(cfgPath, "utf8")).network.rpc_url
    : "https://api.devnet.solana.com";

  const connection = new Connection(rpc, "confirmed");
  process.stdout.write("  Requesting devnet airdrop (2 SOL)... ");
  try {
    const sig = await connection.requestAirdrop(new PublicKey(pubkey), 2 * LAMPORTS_PER_SOL);
    await connection.confirmTransaction(sig, "confirmed");
    const bal = await connection.getBalance(new PublicKey(pubkey));
    console.log(`done. Balance: ${(bal / LAMPORTS_PER_SOL).toFixed(2)} SOL`);
  } catch (e) {
    console.log("failed (devnet faucet rate-limited).");
    console.log("  Fund manually: https://faucet.solana.com");
    console.log(`  Wallet: ${pubkey}`);
  }
}

// ── setup ─────────────────────────────────────────────────────────────────────
if (cmd === "setup") {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

  console.log("\nKILLGame Solana Agent Setup");
  console.log("─────────────────────────────────────────");
  console.log("  1. Generate a new wallet (recommended)");
  console.log("  2. Import an existing keypair\n");

  rl.question("Choice [1/2]: ", async answer => {
    rl.close();
    answer = answer.trim();

    const { Keypair } = require("@solana/web3.js");

    if (answer === "2") {
      // ── Import existing ────────────────────────────────────────────────────
      const rl2 = readline.createInterface({ input: process.stdin, output: process.stdout });
      console.log("\nEnter the path to your Solana keypair file");
      console.log("(e.g. ~/.config/solana/id.json)");
      console.log("or paste the raw 64-byte JSON array directly.\n");

      rl2.question("Keypair path or JSON array: ", async input => {
        rl2.close();
        input = input.trim();

        let keyArray;
        if (input.startsWith("[")) {
          try { keyArray = JSON.parse(input); }
          catch { console.error("\nInvalid JSON array."); process.exit(1); }
        } else {
          const resolved = input.replace(/^~/, process.env.HOME || "");
          if (!fs.existsSync(resolved)) { console.error(`\nFile not found: ${resolved}`); process.exit(1); }
          try { keyArray = JSON.parse(fs.readFileSync(resolved, "utf8")); }
          catch { console.error("\nCould not parse keypair file."); process.exit(1); }
        }

        if (!Array.isArray(keyArray) || keyArray.length !== 64) {
          console.error("\nInvalid keypair — must be a 64-byte array."); process.exit(1);
        }

        let kp;
        try { kp = Keypair.fromSecretKey(Uint8Array.from(keyArray)); }
        catch { console.error("\nFailed to load keypair."); process.exit(1); }

        saveKey(keyArray);
        console.log(`\nWallet imported.`);
        console.log(`Public key : ${kp.publicKey.toBase58()}`);
        console.log(`Key saved  : .env\n`);
      });

    } else {
      // ── Generate new wallet ────────────────────────────────────────────────
      const kp       = Keypair.generate();
      const keyArray = Array.from(kp.secretKey);
      const pubkey   = kp.publicKey.toBase58();

      saveKey(keyArray);

      console.log("\nNew wallet generated.");
      console.log(`Public key : ${pubkey}`);
      console.log(`Key saved  : .env\n`);
      console.log("IMPORTANT: Back up your key before funding this wallet.");
      console.log(`           cat .env\n`);

      await airdrop(pubkey);

      console.log("\nSetup complete. Run `killsol agent` to start.\n");
    }
  });

// ── agent ─────────────────────────────────────────────────────────────────────
} else if (cmd === "agent") {
  const agentPath = path.join(ROOT, "agents-sol", "agent.js");
  if (!fs.existsSync(agentPath)) {
    console.error("agents-sol/agent.js not found. Run the installer first.");
    process.exit(1);
  }
  if (!process.env.AGENT_PK) {
    console.error("AGENT_PK not set. Run `killsol setup` first.");
    process.exit(1);
  }
  spawn("node", ["agents-sol/agent.js"], {
    cwd: ROOT, stdio: "inherit",
    env: { ...process.env, FORCE_COLOR: "1" }
  });

// ── help ──────────────────────────────────────────────────────────────────────
} else {
  console.log("\nUsage: killsol <command>\n");
  console.log("  setup   Create or import your Solana wallet");
  console.log("  agent   Start the agent\n");
}
CLIEOF

chmod +x cli.js

# 5. Install dependencies and link
echo "[5/5] Installing dependencies..."
npm install --quiet
npm link --force --quiet

echo ""
echo "================================================"
echo " KILLGame Solana Agent installed at $(pwd)"
echo "================================================"
echo ""
echo "STEP 1 — Create your wallet"
echo ""
echo "  killsol setup"
echo ""
echo "  Generates a new Solana wallet and requests a"
echo "  devnet airdrop automatically. Or import an"
echo "  existing keypair."
echo ""
echo "------------------------------------------------"
echo ""
echo "STEP 2 — Configure your agents"
echo ""
echo "  Playbook  (which agents run and in what order):"
echo "  nano agents-sol/playbook.json"
echo ""
echo "  Parameters  (settings, RPC, strategy):"
echo "  nano agents-sol/config.json"
echo ""
echo "------------------------------------------------"
echo ""
echo "STEP 3 — Run your agent"
echo ""
echo "  killsol agent"
echo ""
echo "================================================"
