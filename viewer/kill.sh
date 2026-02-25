#!/bin/bash
# 🦞 KILLGame Agentic Installer

# 1. Scaffolding
mkdir -p agents/sniper agents/fortress data/abi

# 2. Write ABIs
cat <<EOT > data/abi/KILLGame.json
{
  "contractName": "KILLGame",
  "abi": $(cat <<'ABI_EOF'
[{"inputs":[{"internalType":"address","name":"_tokenAddress","type":"address"}],"stateMutability":"nonpayable","type":"constructor"},{"inputs":[{"internalType":"address","name":"target","type":"address"}],"name":"AddressEmptyCode","type":"error"},{"inputs":[{"internalType":"address","name":"sender","type":"address"},{"internalType":"uint256","name":"balance","type":"uint256"},{"internalType":"uint256","name":"needed","type":"uint256"},{"internalType":"uint256","name":"tokenId","type":"uint256"}],"name":"ERC1155InsufficientBalance","type":"error"},{"inputs":[{"internalType":"address","name":"approver","type":"address"}],"name":"ERC1155InvalidApprover","type":"error"},{"inputs":[{"internalType":"uint256","name":"idsLength","type":"uint256"},{"internalType":"uint256","name":"valuesLength","type":"uint256"}],"name":"ERC1155InvalidArrayLength","type":"error"},{"inputs":[{"internalType":"address","name":"operator","type":"address"}],"name":"ERC1155InvalidOperator","type":"error"},{"inputs":[{"internalType":"address","name":"receiver","type":"address"}],"name":"ERC1155InvalidReceiver","type":"error"},{"inputs":[{"internalType":"address","name":"sender","type":"address"}],"name":"ERC1155InvalidSender","type":"error"},{"inputs":[{"internalType":"address","name":"operator","type":"address"},{"internalType":"address","name":"owner","type":"address"}],"name":"ERC1155MissingApprovalForAll","type":"error"},{"inputs":[],"name":"FailedCall","type":"error"},{"inputs":[{"internalType":"address","name":"owner","type":"address"}],"name":"OwnableInvalidOwner","type":"error"},{"inputs":[{"internalType":"address","name":"account","type":"address"}],"name":"OwnableUnauthorizedAccount","type":"error"},{"inputs":[],"name":"ReentrancyGuardReentrantCall","type":"error"},{"anonymous":false,"inputs":[{"indexed":true,"internalType":"address","name":"account","type":"address"},{"indexed":true,"internalType":"address","name":"operator","type":"address"},{"indexed":false,"internalType":"bool","name":"approved","type":"bool"}],"name":"ApprovalForAll","type":"event"},{"anonymous":false,"inputs":[{"indexed":true,"internalType":"address","name":"defender","type":"address"},{"indexed":false,"internalType":"uint256","name":"amount","type":"uint256"}],"name":"DefenderRewarded","type":"event"},{"anonymous":false,"inputs":[{"indexed":false,"internalType":"uint256","name":"totalUnitsKilled","type":"uint256"},{"indexed":false,"internalType":"uint256","name":"totalReaperKilled","type":"uint256"},{"indexed":false,"internalType":"uint256","name":"killAdded","type":"uint256"},{"indexed":false,"internalType":"uint256","name":"killExtracted","type":"uint256"},{"indexed":false,"internalType":"uint256","name":"killBurned","type":"uint256"}],"name":"GlobalStats","type":"event"},{"anonymous":false,"inputs":[{"indexed":true,"internalType":"address","name":"attacker","type":"address"},{"indexed":true,"internalType":"address","name":"target","type":"address"},{"indexed":true,"internalType":"uint16","name":"stackId","type":"uint16"},{"components":[{"internalType":"uint256","name":"attackerUnitsSent","type":"uint256"},{"internalType":"uint256","name":"attackerReaperSent","type":"uint256"},{"internalType":"uint256","name":"attackerUnitsLost","type":"uint256"},{"internalType":"uint256","name":"attackerReaperLost","type":"uint256"},{"internalType":"uint256","name":"targetUnitsLost","type":"uint256"},{"internalType":"uint256","name":"targetReaperLost","type":"uint256"},{"internalType":"uint256","name":"initialDefenderUnits","type":"uint256"},{"internalType":"uint256","name":"initialDefenderReaper","type":"uint256"},{"internalType":"uint256","name":"attackerBounty","type":"uint256"},{"internalType":"uint256","name":"defenderBounty","type":"uint256"}],"indexed":false,"internalType":"struct KILLGame.BattleSummary","name":"summary","type":"tuple"},{"indexed":false,"internalType":"uint256","name":"targetBirthBlock","type":"uint256"}],"name":"Killed","type":"event"},{"anonymous":false,"inputs":[{"indexed":true,"internalType":"address","name":"agent","type":"address"},{"indexed":false,"internalType":"uint16","name":"fromStack","type":"uint16"},{"indexed":false,"internalType":"uint16","name":"toStack","type":"uint16"},{"indexed":false,"internalType":"uint256","name":"units","type":"uint256"},{"indexed":false,"internalType":"uint256","name":"reaper","type":"uint256"},{"indexed":false,"internalType":"uint256","name":"birthBlock","type":"uint256"}],"name":"Moved","type":"event"},{"anonymous":false,"inputs":[{"indexed":true,"internalType":"address","name":"previousOwner","type":"address"},{"indexed":true,"internalType":"address","name":"newOwner","type":"address"}],"name":"OwnershipTransferred","type":"event"},{"anonymous":false,"inputs":[{"indexed":true,"internalType":"address","name":"agent","type":"address"},{"indexed":true,"internalType":"uint256","name":"stackId","type":"uint256"},{"indexed":false,"internalType":"uint256","name":"units","type":"uint256"},{"indexed":false,"internalType":"uint256","name":"reapers","type":"uint256"},{"indexed":false,"internalType":"uint256","name":"birthBlock","type":"uint256"}],"name":"Spawned","type":"event"},{"anonymous":false,"inputs":[{"indexed":true,"internalType":"address","name":"operator","type":"address"},{"indexed":true,"internalType":"address","name":"from","type":"address"},{"indexed":true,"internalType":"address","name":"to","type":"address"},{"indexed":false,"internalType":"uint256[]","name":"ids","type":"uint256[]"},{"indexed":false,"internalType":"uint256[]","name":"values","type":"uint256[]"}],"name":"TransferBatch","type":"event"},{"anonymous":false,"inputs":[{"indexed":true,"internalType":"address","name":"operator","type":"address"},{"indexed":true,"internalType":"address","name":"from","type":"address"},{"indexed":true,"internalType":"address","name":"to","type":"address"},{"indexed":false,"internalType":"uint256","name":"id","type":"uint256"},{"indexed":false,"internalType":"uint256","name":"value","type":"uint256"}],"name":"TransferSingle","type":"event"},{"anonymous":false,"inputs":[{"indexed":false,"internalType":"uint256","name":"oldBps","type":"uint256"},{"indexed":false,"internalType":"uint256","name":"newBps","type":"uint256"}],"name":"TreasuryBpsUpdated","type":"event"},{"anonymous":false,"inputs":[{"indexed":false,"internalType":"string","name":"value","type":"string"},{"indexed":true,"internalType":"uint256","name":"id","type":"uint256"}],"name":"URI","type":"event"},{"inputs":[],"name":"BURN_BPS","outputs":[{"internalType":"uint256","name":"","type":"uint256"}],"stateMutability":"view","type":"function"},{"inputs":[],"name":"MOVE_COST","outputs":[{"internalType":"uint256","name":"","type":"uint256"}],"stateMutability":"view","type":"function"},{"inputs":[],"name":"SPAWN_COST","outputs":[{"internalType":"uint256","name":"","type":"uint256"}],"stateMutability":"view","type":"function"},{"inputs":[],"name":"THERMAL_PARITY","outputs":[{"internalType":"uint256","name":"","type":"uint256"}],"stateMutability":"view","type":"function"},{"inputs":[{"internalType":"uint256","name":"amt","type":"uint256"}],"name":"adminWithdraw","outputs":[],"stateMutability":"nonpayable","type":"function"},{"inputs":[{"internalType":"address","name":"","type":"address"},{"internalType":"uint256","name":"","type":"uint256"}],"name":"agentStacks","outputs":[{"internalType":"uint256","name":"birthBlock","type":"uint256"}],"stateMutability":"view","type":"function"},{"inputs":[{"internalType":"address","name":"","type":"address"}],"name":"agentTotalProfit","outputs":[{"internalType":"uint256","name":"","type":"uint256"}],"stateMutability":"view","type":"function"},{"inputs":[{"internalType":"address","name":"account","type":"address"},{"internalType":"uint256","name":"id","type":"uint256"}],"name":"balanceOf","outputs":[{"internalType":"uint256","name":"","type":"uint256"}],"stateMutability":"view","type":"function"},{"inputs":[{"internalType":"address[]","name":"accounts","type":"address[]"},{"internalType":"uint256[]","name":"ids","type":"uint256[]"}],"name":"balanceOfBatch","outputs":[{"internalType":"uint256[]","name":"","type":"uint256[]"}],"stateMutability":"view","type":"function"},{"inputs":[{"internalType":"address","name":"agent","type":"address"},{"internalType":"uint256","name":"id","type":"uint256"}],"name":"getBirthBlock","outputs":[{"internalType":"uint256","name":"","type":"uint256"}],"stateMutability":"view","type":"function"},{"inputs":[{"internalType":"uint16","name":"stackId","type":"uint16"}],"name":"getFullStack","outputs":[{"components":[{"internalType":"address","name":"occupant","type":"address"},{"internalType":"uint256","name":"units","type":"uint256"},{"internalType":"uint256","name":"reapers","type":"uint256"},{"internalType":"uint256","name":"age","type":"uint256"},{"internalType":"uint256","name":"pendingBounty","type":"uint256"}],"internalType":"struct KILLGame.StackInfo[]","name":"","type":"tuple[]"}],"stateMutability":"view","type":"function"},{"inputs":[{"internalType":"address","name":"agent","type":"address"},{"internalType":"uint256","name":"id","type":"uint256"}],"name":"getPendingBounty","outputs":[{"internalType":"uint256","name":"","type":"uint256"}],"stateMutability":"view","type":"function"},{"inputs":[],"name":"getTreasuryStats","outputs":[{"internalType":"uint256","name":"totalTreasury","type":"uint256"},{"internalType":"uint256","name":"globalMaxBounty","type":"uint256"}],"stateMutability":"view","type":"function"},{"inputs":[{"internalType":"address","name":"account","type":"address"},{"internalType":"address","name":"operator","type":"address"}],"name":"isApprovedForAll","outputs":[{"internalType":"bool","name":"","type":"bool"}],"stateMutability":"view","type":"function"},{"inputs":[{"internalType":"address","name":"target","type":"address"},{"internalType":"uint16","name":"stackId","type":"uint16"},{"internalType":"uint256","name":"sentUnits","type":"uint256"},{"internalType":"uint256","name":"sentReaper","type":"uint256"}],"name":"kill","outputs":[{"internalType":"uint256","name":"attackerBounty","type":"uint256"}],"stateMutability":"nonpayable","type":"function"},{"inputs":[],"name":"killToken","outputs":[{"internalType":"contract IERC20","name":"","type":"address"}],"stateMutability":"view","type":"function"},{"inputs":[{"internalType":"uint16","name":"fromStack","type":"uint16"},{"internalType":"uint16","name":"toStack","type":"uint16"},{"internalType":"uint256","name":"units","type":"uint256"},{"internalType":"uint256","name":"reaper","type":"uint256"}],"name":"move","outputs":[],"stateMutability":"nonpayable","type":"function"},{"inputs":[{"internalType":"bytes[]","name":"data","type":"bytes[]"}],"name":"multicall","outputs":[{"internalType":"bytes[]","name":"results","type":"bytes[]"}],"stateMutability":"nonpayable","type":"function"},{"inputs":[],"name":"owner","outputs":[{"internalType":"address","name":"","type":"address"}],"stateMutability":"view","type":"function"},{"inputs":[],"name":"renounceOwnership","outputs":[],"stateMutability":"nonpayable","type":"function"},{"inputs":[{"internalType":"address","name":"from","type":"address"},{"internalType":"address","name":"to","type":"address"},{"internalType":"uint256[]","name":"ids","type":"uint256[]"},{"internalType":"uint256[]","name":"values","type":"uint256[]"},{"internalType":"bytes","name":"data","type":"bytes"}],"name":"safeBatchTransferFrom","outputs":[],"stateMutability":"nonpayable","type":"function"},{"inputs":[{"internalType":"address","name":"from","type":"address"},{"internalType":"address","name":"to","type":"address"},{"internalType":"uint256","name":"id","type":"uint256"},{"internalType":"uint256","name":"value","type":"uint256"},{"internalType":"bytes","name":"data","type":"bytes"}],"name":"safeTransferFrom","outputs":[],"stateMutability":"nonpayable","type":"function"},{"inputs":[{"internalType":"address","name":"operator","type":"address"},{"internalType":"bool","name":"approved","type":"bool"}],"name":"setApprovalForAll","outputs":[],"stateMutability":"nonpayable","type":"function"},{"inputs":[{"internalType":"uint256","name":"_newBps","type":"uint256"}],"name":"setTreasuryBps","outputs":[],"stateMutability":"nonpayable","type":"function"},{"inputs":[{"internalType":"uint16","name":"stackId","type":"uint16"},{"internalType":"uint256","name":"amount","type":"uint256"}],"name":"spawn","outputs":[],"stateMutability":"nonpayable","type":"function"},{"inputs":[{"internalType":"bytes4","name":"id","type":"bytes4"}],"name":"supportsInterface","outputs":[{"internalType":"bool","name":"","type":"bool"}],"stateMutability":"view","type":"function"},{"inputs":[],"name":"totalKillAdded","outputs":[{"internalType":"uint256","name":"","type":"uint256"}],"stateMutability":"view","type":"function"},{"inputs":[],"name":"totalKillBurned","outputs":[{"internalType":"uint256","name":"","type":"uint256"}],"stateMutability":"view","type":"function"},{"inputs":[],"name":"totalKillExtracted","outputs":[{"internalType":"uint256","name":"","type":"uint256"}],"stateMutability":"view","type":"function"},{"inputs":[],"name":"totalReaperKilled","outputs":[{"internalType":"uint256","name":"","type":"uint256"}],"stateMutability":"view","type":"function"},{"inputs":[],"name":"totalUnitsKilled","outputs":[{"internalType":"uint256","name":"","type":"uint256"}],"stateMutability":"view","type":"function"},{"inputs":[{"internalType":"address","name":"newOwner","type":"address"}],"name":"transferOwnership","outputs":[],"stateMutability":"nonpayable","type":"function"},{"inputs":[],"name":"treasuryBps","outputs":[{"internalType":"uint256","name":"","type":"uint256"}],"stateMutability":"view","type":"function"},{"inputs":[{"internalType":"uint256","name":"","type":"uint256"}],"name":"uri","outputs":[{"internalType":"string","name":"","type":"string"}],"stateMutability":"view","type":"function"}]
ABI_EOF
)
}
EOT

cat <<EOT > data/abi/KILLFaucet.json
{
  "contractName": "KILLFaucet",
  "abi": [
    "function pullKill() external",
    "function hasClaimed(address) view returns (bool)"
  ]
}
EOT

# 3. Write package.json
cat <<EOT > package.json
{
  "name": "killgame",
  "version": "1.1.0",
  "bin": { "killgame": "./cli.js" },
  "dependencies": {
    "commander": "^11.0.0", "inquirer": "^8.2.4", "dotenv": "^16.4.5", "ethers": "^5.7.2",
    "hardhat": "^2.19.1", "@nomiclabs/hardhat-ethers": "^2.2.3", "@nomicfoundation/hardhat-toolbox": "^2.0.2"
  }
}
EOT

# 4. Fetch Agents & Patch
BASE_URL="https://raw.githubusercontent.com/HouseOfHufflepuff/kill/main"
for ROLE in sniper fortress; do
  curl -f -s "$BASE_URL/agents/$ROLE/agent.js" -o "agents/$ROLE/agent.js"
  curl -f -s "$BASE_URL/agents/$ROLE/config.json" -o "agents/$ROLE/config.json"
  if [ -f "agents/$ROLE/agent.js" ]; then
    # Patch KILLGame Contract to use local ABI
    sed -i.bak "s/await ethers.getContractAt(\"KILLGame\", kill_game_addr)/new ethers.Contract(kill_game_addr, JSON.parse(fs.readFileSync(path.join(__dirname, '..\/..\/data\/abi\/KILLGame.json'), 'utf8')).abi, wallet)/g" "agents/$ROLE/agent.js"
    
    # Patch Faucet Contract to use local ABI
    sed -i.bak "s/new ethers.Contract(kill_faucet_addr, faucetAbi, wallet)/new ethers.Contract(kill_faucet_addr, JSON.parse(fs.readFileSync(path.join(__dirname, '..\/..\/data\/abi\/KILLFaucet.json'), 'utf8')).abi, wallet)/g" "agents/$ROLE/agent.js"
    
    # Patch IERC20 to use Human-Readable ABI (Fixes HH700 error)
    sed -i.bak "s/await ethers.getContractAt(\"IERC20\", killTokenAddr)/new ethers.Contract(killTokenAddr, ['function balanceOf(address) view returns (uint256)', 'function allowance(address, address) view returns (uint256)', 'function approve(address, uint256) returns (bool)', 'function transfer(address, uint256) returns (bool)'], wallet)/g" "agents/$ROLE/agent.js"
    
    # Patch Private Key source
    sed -i.bak "s/config.private_key/process.env.PRIVATE_KEY/g" "agents/$ROLE/agent.js"
  fi
done

# 5. Hardhat Config
cat <<EOT > hardhat.config.js
require("@nomicfoundation/hardhat-toolbox");
require("dotenv").config();
module.exports = { 
  solidity: "0.8.24", 
  networks: { 
    basesepolia: { 
      url: "https://sepolia.base.org", 
      accounts: [process.env.SNIPER_PK, process.env.FORTRESS_PK].filter(Boolean) 
    } 
  } 
};
EOT

# 6. CLI Router (Unchanged)
cat <<EOT > cli.js
#!/usr/bin/env node
const { program } = require('commander');
const inquirer = require('inquirer');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const ROOT = __dirname;
require('dotenv').config({ path: path.join(ROOT, '.env') });

program.command('setup').action(async () => {
  const ans = await inquirer.prompt([
    { type: 'input', name: 'pk', message: 'Enter Private Key (will be used for Sniper & Fortress):', mask: '*' }
  ]);
  const envPath = path.join(ROOT, '.env');
  const lines = [\`SNIPER_PK=\${ans.pk}\`, \`FORTRESS_PK=\${ans.pk}\`].join('\n') + '\n';
  fs.writeFileSync(envPath, lines);
  console.log('✅ Registered Private Key for all roles.');
});

program.command('start <role>').action((role) => {
  const agentDir = path.join(ROOT, 'agents', role);
  if (!fs.existsSync(agentDir)) { console.error(\`❌ Role \${role} not found.\`); return; }
  
  const agentPath = path.join(agentDir, 'agent.js');
  const config = JSON.parse(fs.readFileSync(path.join(agentDir, 'config.json'), 'utf8'));
  const networkName = config.network.network_name || "basesepolia";
  const pk = process.env[\`\${role.toUpperCase()}_PK\`];

  if(!pk) {
    console.error(\`❌ Error: No private key found. Run 'killgame setup'.\`);
    process.exit(1);
  }

  spawn('npx', ['hardhat', 'run', agentPath, '--network', networkName], { 
    cwd: ROOT, stdio: 'inherit', shell: true, env: { ...process.env, PRIVATE_KEY: pk, FORCE_COLOR: "1" } 
  });
});
program.parse(process.argv);
EOT

# 7. Finalize
chmod +x cli.js
npm install --quiet
npm link --force --quiet

echo ""
echo "------------------------------------------------"
echo "🎉 SUCCESS: KILLGame Agents Installed (v1.1)."
echo "------------------------------------------------"
echo "Next steps:"
echo "1. killgame setup"
echo "2. Check config.json in agents/ for the new faucet address"
echo "3. killgame start sniper"
echo "------------------------------------------------"