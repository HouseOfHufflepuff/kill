#!/bin/bash
# KILLGame Agent Installer v2.0.0

set -e

BASE_URL="https://raw.githubusercontent.com/HouseOfHufflepuff/kill/main"
AGENTS="sniper fortress aftershock seed market-maker market-taker"

# 1. Scaffold directories
echo "[1/5] Scaffolding directories..."
for ROLE in $AGENTS; do
  mkdir -p "agents/$ROLE"
done

# 2. Pull agent files from GitHub
echo "[2/5] Fetching agent files from GitHub..."
for ROLE in $AGENTS; do
  curl -f -s "$BASE_URL/agents/$ROLE/capability.js" -o "agents/$ROLE/capability.js"
  curl -f -s "$BASE_URL/agents/$ROLE/config.json"   -o "agents/$ROLE/config.json"
done
curl -f -s "$BASE_URL/agents/agent.js"      -o "agents/agent.js"
curl -f -s "$BASE_URL/agents/common.js"     -o "agents/common.js"
curl -f -s "$BASE_URL/agents/playbook.json" -o "agents/playbook.json"
curl -f -s "$BASE_URL/agents/config.json"   -o "agents/config.json"
curl -f -s "$BASE_URL/agents/KillGame.json" -o "agents/KillGame.json"

# 3. Write package.json
echo "[3/5] Writing package.json..."
cat <<'EOT' > package.json
{
  "name": "killgame",
  "version": "2.0.0",
  "bin": { "killgame": "./cli.js" },
  "dependencies": {
    "node-fetch": "^2.6.7",
    "commander": "^11.0.0",
    "inquirer": "^8.2.4",
    "dotenv": "^16.4.5",
    "ethers": "^5.7.2",
    "hardhat": "^2.19.1",
    "@nomiclabs/hardhat-ethers": "^2.2.3",
    "@nomicfoundation/hardhat-toolbox": "^2.0.2"
  }
}
EOT

# 4. Write hardhat.config.js (reads network from agents/config.json)
echo "[4/5] Writing hardhat.config.js..."
cat <<'EOT' > hardhat.config.js
require("@nomicfoundation/hardhat-toolbox");
require("dotenv").config();
const fs = require("fs");
const cfg = JSON.parse(fs.readFileSync("./agents/config.json", "utf8"));
module.exports = {
  solidity: "0.8.24",
  networks: {
    [cfg.network.network_name]: {
      url:      cfg.network.rpc_url,
      accounts: process.env.AGENT_PK ? [process.env.AGENT_PK] : []
    }
  }
};
EOT

# 5. Write cli.js
echo "[5/5] Writing CLI..."
cat <<'CLIEOF' > cli.js
#!/usr/bin/env node
const { program } = require('commander');
const inquirer    = require('inquirer');
const fs          = require('fs');
const path        = require('path');
const { spawn }   = require('child_process');
const ROOT        = __dirname;
require('dotenv').config({ path: path.join(ROOT, '.env') });

program
  .command('setup')
  .description('Set agent private key')
  .action(async () => {
    const ans = await inquirer.prompt([
      {
        type:     'password',
        name:     'pk',
        message:  'Agent Private Key (AGENT_PK):',
        mask:     '*',
        validate: v => v.length > 0 || 'Required'
      }
    ]);

    // Write AGENT_PK to .env (preserve other existing vars)
    const envPath  = path.join(ROOT, '.env');
    const existing = fs.existsSync(envPath) ? fs.readFileSync(envPath, 'utf8') : '';
    const lines    = existing.split('\n').filter(l => !l.startsWith('AGENT_PK=') && l.trim() !== '');
    lines.push(`AGENT_PK=${ans.pk}`);
    fs.writeFileSync(envPath, lines.join('\n') + '\n');

    console.log('\n✅ Private key saved to .env\n');
  });

program
  .command('agent')
  .description('Start the agent (network read from agents/config.json)')
  .action(() => {
    const configPath = path.join(ROOT, 'agents', 'config.json');
    if (!fs.existsSync(configPath)) {
      console.error('❌ agents/config.json not found. Run the installer first.');
      process.exit(1);
    }
    const config  = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    const network = config.network.network_name || 'basesepolia';
    if (!process.env.AGENT_PK) {
      console.error('❌ AGENT_PK not set. Run `killgame setup` first.');
      process.exit(1);
    }
    console.log(`Starting agent on network: ${network}`);
    spawn('npx', ['hardhat', 'run', 'agents/agent.js', '--network', network], {
      cwd: ROOT, stdio: 'inherit', shell: true,
      env: { ...process.env, FORCE_COLOR: '1' }
    });
  });

program.parseAsync(process.argv);
CLIEOF

chmod +x cli.js
npm install --quiet
npm link --force --quiet

echo ""
echo "================================================"
echo " KILLGame Agent installed at $(pwd)"
echo "================================================"
echo ""
echo "STEP 1 — Set your private key"
echo ""
echo "  killgame setup"
echo ""
echo "  Saves your AGENT_PK to .env so the agent can"
echo "  sign transactions on your behalf."
echo ""
echo "------------------------------------------------"
echo ""
echo "STEP 2 — Configure your agents"
echo ""
echo "  Option A: Terminal"
echo ""
echo "    Playbook  (which agents run and in what order):"
echo "    nano agents/playbook.json"
echo ""
echo "    Parameters  (hub stack, gas, strategy settings):"
echo "    nano agents/config.json"
echo ""
echo "  Option B: Web UI"
echo ""
echo "    Visit https://killgame.ai"
echo "    Use the Agent configure panel to set your"
echo "    playbook and parameters, then sync to this folder."
echo ""
echo "------------------------------------------------"
echo ""
echo "STEP 3 — Run your agent"
echo ""
echo "  killgame agent"
echo ""
echo "================================================"
