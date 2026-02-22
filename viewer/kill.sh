#!/bin/bash
# Ensure the URL matches your GitHub structure exactly
BASE_URL="https://raw.githubusercontent.com/HouseOfHufflepuff/kill/main"

echo "🦞 KILLGame Installer: Fetching via CURL..."

# 1. Scaffolding
mkdir -p agents/sniper agents/fortress agents/seed

# 2. Fetch Agent Files with Success Verification
for ROLE in sniper fortress seed; do
  echo "Checking $ROLE..."
  
  # Fetch agent.js
  curl -f -s "$BASE_URL/agents/$ROLE/agent.js" -o "agents/$ROLE/agent.js"
  if [ $? -ne 0 ]; then echo "⚠️ Warning: agent.js not found for $ROLE"; fi
  
  # Fetch config.json
  curl -f -s "$BASE_URL/agents/$ROLE/config.json" -o "agents/$ROLE/config.json"
  if [ $? -ne 0 ]; then 
    echo "⚠️ config.json not found for $ROLE. Creating default..."
    cat <<EOT > "agents/$ROLE/config.json"
{
  "network_name": "basesepolia",
  "network": { "kill_game_addr": "0x923215fD8fF71d5f7C6Dc05111f1C957d9A0ac27" },
  "settings": {
    "HUB_STACK": 125,
    "MIN_SPAWN": 666,
    "KILL_MULTIPLIER": 2,
    "SPAWN_PROFITABILITY_THRESHOLD": 0.01,
    "LOOP_DELAY_SECONDS": 5
  }
}
EOT
  fi
done

# 3. Generate Hardhat Config
cat <<EOT > hardhat.config.js
require("@nomicfoundation/hardhat-toolbox");
require("dotenv").config();
module.exports = {
  solidity: "0.8.24",
  networks: {
    basesepolia: {
      url: "https://base-sepolia.g.alchemy.com/v2/nnFLqX2LjPIlLmGBWsr2I5voBfb-6-Gs",
      accounts: [process.env.SNIPER_PK, process.env.FORTRESS_PK, process.env.SEED_PK].filter(Boolean)
    }
  }
};
EOT

# 4. Generate CLI Router
cat <<EOT > cli.js
#!/usr/bin/env node
const { program } = require('commander');
const inquirer = require('inquirer');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const ROOT = __dirname;

program.command('setup').action(async () => {
  const ans = await inquirer.prompt([
    { type: 'list', name: 'role', choices: ['sniper', 'fortress', 'seed'], message: 'Role:' },
    { type: 'input', name: 'pk', message: 'Private Key:' }
  ]);
  const envPath = path.join(ROOT, '.env');
  let content = fs.existsSync(envPath) ? fs.readFileSync(envPath, 'utf8') : '';
  const key = \`\${ans.role.toUpperCase()}_PK\`;
  const lines = content.split('\n').filter(l => !l.startsWith(key) && l.trim() !== '');
  lines.push(\`\${key}=\${ans.pk}\`);
  fs.writeFileSync(envPath, lines.join('\n') + '\n');
  console.log('✅ Registered ' + key);
});

program.command('start <role>').action((role) => {
  const agentDir = path.join(ROOT, 'agents', role);
  const agentPath = path.join(agentDir, 'agent.js');
  const configPath = path.join(agentDir, 'config.json');

  if (!fs.existsSync(agentPath)) return console.error('❌ Agent file missing.');

  let network = 'basesepolia';
  if (fs.existsSync(configPath)) {
      network = JSON.parse(fs.readFileSync(configPath, 'utf8')).network_name || network;
  }

  spawn('npx', ['hardhat', 'run', agentPath, '--network', network], {
    cwd: ROOT,
    stdio: 'inherit',
    shell: true,
    env: { ...process.env, FORCE_COLOR: "1" }
  });
});
program.parse(process.argv);
EOT

# 5. Finalize
chmod +x cli.js
npm install
npm link --force

echo "------------------------------------------------"
echo "🎉 SUCCESS: KILLGame Suite Installed."