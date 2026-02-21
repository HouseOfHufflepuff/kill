#!/bin/bash
REPO_URL="https://github.com/HouseOfHufflepuff/kill.git"

echo "🦞 KILLGame Universal Installer: Fetching from GitHub..."

# 1. Initialize Git and pull only the /agents directory
git init .
git remote add origin $REPO_URL
git config core.sparseCheckout true
echo "agents/" >> .git/info/sparse-checkout
git pull origin main

# 2. Hardhat Config
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

# 3. CLI Router (cli.js)
cat <<EOT > cli.js
#!/usr/bin/env node
const { program } = require('commander');
const inquirer = require('inquirer');
const fs = require('fs');
const path = require('path');
const { spawn: cpSpawn } = require('child_process');

const ROOT = __dirname;

program.command('setup').action(async () => {
  const ans = await inquirer.prompt([
    { type: 'list', name: 'role', choices: ['sniper', 'fortress', 'seed'], message: 'Role:' },
    { type: 'input', name: 'pk', message: 'Private Key:' }
  ]);
  const envPath = path.join(ROOT, '.env');
  fs.appendFileSync(envPath, \`\${ans.role.toUpperCase()}_PK=\${ans.pk}\n\`);
  console.log('✅ Registered in .env');
});

program.command('start <role>').action((role) => {
  const agentDir = path.join(ROOT, 'agents', role);
  const configPath = path.join(agentDir, 'config.json');
  const agentPath = path.join(agentDir, 'agent.js');

  if (!fs.existsSync(configPath)) return console.error('Error: config.json missing at ' + configPath);
  
  const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  const network = config.network_name || 'basesepolia';

  console.log(\`🚀 Launching \${role} on \${network}...\`);
  
  cpSpawn('npx', ['hardhat', 'run', agentPath, '--network', network], { 
    stdio: 'inherit', 
    shell: true,
    cwd: ROOT 
  });
});
program.parse(process.argv);
EOT

# 4. Finalize
chmod +x cli.js
npm install
npm link --force

echo "------------------------------------------------"
echo "🎉 SUCCESS: Directory synced from GitHub."
echo "1. killgame setup"
echo "2. killgame start sniper"