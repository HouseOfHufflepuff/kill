#!/bin/bash
echo "🦞 KILLGame One-Line Installer: Building Environment..."

# 1. Scaffolding
mkdir -p agents/sniper agents/fortress agents/seed

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

# 3. Sniper Config
cat <<EOT > agents/sniper/config.json
{
  "network": {
    "kill_game_addr": "0x923215fD8fF71d5f7C6Dc05111f1C957d9A0ac27"
  },
  "settings": {
    "HUB_STACK": 125,
    "MIN_SPAWN": 666,
    "KILL_MULTIPLIER": 2,
    "SPAWN_PROFITABILITY_THRESHOLD": 0.01,
    "LOOP_DELAY_SECONDS": 5
  }
}
EOT

# 4. CLI Router (cli.js)
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
  fs.writeFileSync(envPath, \`\${ans.role.toUpperCase()}_PK=\${ans.pk}\n\`);
  console.log('✅ Registered in .env');
});

program.command('start <role>').action((role) => {
  const agentPath = path.join(ROOT, 'agents', role, 'agent.js');
  console.log(\`Starting \${role}...\`);
  cpSpawn('npx', ['hardhat', 'run', agentPath, '--network', 'basesepolia'], { 
    stdio: 'inherit', 
    shell: true,
    cwd: ROOT 
  });
});
program.parse(process.argv);
EOT

# 5. Full Sniper Payload
cat <<EOT > agents/sniper/agent.js
const { ethers } = require("hardhat");
const fs = require("fs");
const path = require("path");
require("dotenv").config();

const YEL = "\x1b[33m"; const CYA = "\x1b[36m"; const PNK = "\x1b[35m";
const RES = "\x1b[0m"; const BRIGHT = "\x1b[1m";

function getCoords(id) {
    const v = id - 1;
    return { x: v % 6, y: Math.floor(v / 6) % 6, z: Math.floor(v / 36) };
}
function getId(x, y, z) { return (z * 36) + (y * 6) + x + 1; }

function getPath3D(startId, endId) {
    let current = getCoords(startId);
    const target = getCoords(endId);
    const path = [];
    while (current.x !== target.x || current.y !== target.y || current.z !== target.z) {
        let fromId = getId(current.x, current.y, current.z);
        if (current.x !== target.x) current.x += (target.x > current.x ? 1 : -1);
        else if (current.y !== target.y) current.y += (target.y > current.y ? 1 : -1);
        else if (current.z !== target.z) current.z += (target.z > current.z ? 1 : -1);
        path.push({ from: fromId, to: getId(current.x, current.y, current.z) });
    }
    return path;
}

async function main() {
    const wallet = new ethers.Wallet(process.env.SNIPER_PK, ethers.provider);
    const config = JSON.parse(fs.readFileSync(path.join(__dirname, "config.json"), "utf8"));
    const { HUB_STACK, LOOP_DELAY_SECONDS, KILL_MULTIPLIER, SPAWN_PROFITABILITY_THRESHOLD, MIN_SPAWN } = config.settings;
    const killGame = await ethers.getContractAt("KILLGame", config.network.kill_game_addr);
    const SPAWN_COST = await killGame.SPAWN_COST();

    while (true) {
        try {
            const scanIds = Array.from({ length: 216 }, (_, i) => i + 1);
            const balC = scanIds.map(id => killGame.interface.encodeFunctionData("balanceOf", [wallet.address, id]));
            const rC = scanIds.map(id => killGame.interface.encodeFunctionData("balanceOf", [wallet.address, id + 216]));
            const sC = scanIds.map(id => killGame.interface.encodeFunctionData("getFullStack", [id]));
            const results = await killGame.callStatic.multicall([...balC, ...rC, ...sC]);
            
            let stranded = []; let targets = [];
            for (let i = 0; i < 216; i++) {
                const u = killGame.interface.decodeFunctionResult("balanceOf", results[i])[0];
                const r = killGame.interface.decodeFunctionResult("balanceOf", results[i + 216])[0];
                if ((u.gt(0) || r.gt(0)) && (i + 1) !== HUB_STACK) stranded.push({ id: i + 1, units: u, reapers: r });
                const items = killGame.interface.decodeFunctionResult("getFullStack", results[i + 432])[0];
                const enemies = items.filter(it => it.occupant.toLowerCase() !== wallet.address.toLowerCase() && it.units.gt(0));
                for (const e of enemies) {
                    let spawnAmt = e.units.mul(KILL_MULTIPLIER);
                    if (spawnAmt.lt(MIN_SPAWN)) spawnAmt = ethers.BigNumber.from(MIN_SPAWN);
                    const ratio = parseFloat(e.units.mul(ethers.utils.parseEther("1")).mul(1000).div(spawnAmt.mul(SPAWN_COST)).toString()) / 1000;
                    targets.push({ id: i + 1, enemy: e, ratio, spawnAmt, killVal: e.units.mul(ethers.utils.parseEther("1")) });
                }
            }

            console.clear();
            if (stranded.length > 0) {
                console.log(\`\${BRIGHT}\${PNK}STRANDED UNITS (PRIORITY)\${RES}\nID   | UNITS      | REAPERS\`);
                stranded.forEach(s => console.log(\`\${YEL}\${s.id.toString().padEnd(4)}\${RES}| \${s.units.toString().padEnd(10)} | \${s.reapers}\`));
            }
            console.log(\`\n\${BRIGHT}ID   | ENEMY      | UNITS | RATIO | ACTION\${RES}\`);
            targets.sort((a,b) => b.ratio - a.ratio).slice(0, 5).forEach(t => {
                console.log(\`\${t.id.toString().padEnd(4)} | \${t.enemy.occupant.slice(0,10)} | \${t.enemy.units.toString().padEnd(5)} | \${t.ratio.toFixed(2)}x | \${t.ratio >= SPAWN_PROFITABILITY_THRESHOLD ? CYA + "READY" : "WAIT"}\${RES}\`);
            });

            const calls = [];
            if (stranded.length > 0) {
                getPath3D(stranded[0].id, HUB_STACK).forEach(s => {
                    calls.push(killGame.interface.encodeFunctionData("move", [s.from, s.to, stranded[0].units, stranded[0].reapers]));
                });
            } else {
                const best = targets.sort((a, b) => b.ratio - a.ratio)[0];
                if (best && best.ratio >= SPAWN_PROFITABILITY_THRESHOLD) {
                    calls.push(killGame.interface.encodeFunctionData("spawn", [best.id, best.spawnAmt]));
                    calls.push(killGame.interface.encodeFunctionData("kill", [best.enemy.occupant, best.id, best.spawnAmt, 0]));
                }
            }

            if (calls.length > 0) {
                const tx = await killGame.connect(wallet).multicall(calls, { gasLimit: 5000000 });
                await tx.wait();
            }
        } catch (err) { console.error(err.message); }
        await new Promise(r => setTimeout(r, LOOP_DELAY_SECONDS * 1000));
    }
}
main();
EOT

# 6. Finalize
chmod +x cli.js
npm install
npm link --force