#!/bin/bash
BASE_URL="https://raw.githubusercontent.com/HouseOfHufflepuff/kill/main"

echo "🦞 KILLGame Installer: Fetching via CURL..."

# 1. Scaffolding
mkdir -p agents/sniper agents/fortress agents/seed

# 2. Fetch Agent Files
for ROLE in sniper fortress seed; do
  echo "Fetching $ROLE..."
  curl -s "$BASE_URL/agents/$ROLE/agent.js" -o "agents/$ROLE/agent.js"
  curl -s "$BASE_URL/agents/$ROLE/config.json" -o "agents/$ROLE/config.json"
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

# 4. Generate CLI Router (cli.js)
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
  
  // Clean existing entries for this key
  const lines = content.split('\n').filter(l => !l.startsWith(key) && l.trim() !== '');
  lines.push(\`\${key}=\${ans.pk}\`);
  
  fs.writeFileSync(envPath, lines.join('\n') + '\n');
  console.log('✅ Registered ' + key + ' in .env');
});

program.command('start <role>').action((role) => {
  const agentDir = path.join(ROOT, 'agents', role);
  const agentPath = path.join(agentDir, 'agent.js');
  const configPath = path.join(agentDir, 'config.json');

  if (!fs.existsSync(agentPath)) {
    console.error('❌ Agent file missing at: ' + agentPath);
    process.exit(1);
  }

  // Read network from config, fallback to basesepolia
  let network = 'basesepolia';
  if (fs.existsSync(configPath)) {
    try {
      const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
      network = config.network_name || network;
    } catch (e) {}
  }

  console.log(\`🚀 Launching \${role} on \${network}...\`);

  // stdio: inherit ensures the terminal handles the tables/colors/clears
  const child = spawn('npx', ['hardhat', 'run', agentPath, '--network', network], {
    cwd: ROOT,
    stdio: 'inherit',
    shell: true,
    env: { ...process.env, FORCE_COLOR: "1" }
  });

  child.on('close', (code) => {
    if (code !== 0) console.log(\`Agent exited with code \${code}\`);
  });
});

program.parse(process.argv);
EOT

# 5. Finalize
chmod +x cli.js
npm install
npm link --force

echo "------------------------------------------------"
echo "🎉 SUCCESS: Files pulled via curl."
echo "1. killgame setup"
echo "2. killgame start sniper"