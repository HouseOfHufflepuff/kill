#!/bin/bash
echo "🦞 KILLGame One-Line Installer: Building Environment..."

# 1. Scaffolding
mkdir -p agents/sniper agents/fortress agents/seed

# 2. Generate Hardhat Config
cat <<EOT > hardhat.config.js
require("@nomicfoundation/hardhat-toolbox");
require("dotenv").config();
module.exports = {
  solidity: "0.8.24",
  networks: {
    basesepolia: {
      url: process.env.RPC_URL || "https://base-sepolia.g.alchemy.com/v2/nnFLqX2LjPIlLmGBWsr2I5voBfb-6-Gs",
      accounts: [process.env.SNIPER_PK, process.env.FORTRESS_PK, process.env.SEED_PK].filter(Boolean)
    }
  }
};
EOT

# 3. Generate package.json
cat <<EOT > package.json
{
  "name": "kill",
  "version": "1.0.0",
  "bin": { "killgame": "./cli.js" },
  "dependencies": {
    "commander": "^11.0.0",
    "inquirer": "^8.2.4",
    "dotenv": "^16.4.5",
    "ethers": "^5.7.2",
    "hardhat": "^2.28.4",
    "@nomicfoundation/hardhat-toolbox": "^2.0.2"
  }
}
EOT

# 4. Generate CLI (The Router)
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
  fs.appendFileSync(envPath, \`\${ans.role.toUpperCase()}_PK=\${ans.pk}\n\`);
  console.log('✅ Key saved to ' + envPath);
});

program.command('start <role>').action((role) => {
  const agentPath = path.join(ROOT, 'agents', role, 'agent.js');
  spawn('npx', ['hardhat', 'run', agentPath, '--network', 'basesepolia'], { 
    stdio: 'inherit', 
    shell: true,
    cwd: ROOT 
  });
});
program.parse(process.argv);
EOT

# 5. Inject the Full Sniper Agent logic (The Payload)
cat <<EOT > agents/sniper/agent.js
const { ethers } = require("hardhat");
const fs = require("fs");
const path = require("path");
require("dotenv").config();

async function main() {
    console.log("--- SNIPER AGENT ONLINE ---");
    const wallet = new ethers.Wallet(process.env.SNIPER_PK, ethers.provider);
    console.log("Wallet Loaded:", wallet.address);
    // ... (Your full Sniper logic here) ...
}
main().catch(console.error);
EOT

# 6. Finalize
chmod +x cli.js
npm install
npm link --force

echo "------------------------------------------------"
echo "🎉 SUCCESS: Run 'killgame setup' then 'killgame start sniper'"