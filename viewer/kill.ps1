# KILLGame Agentic Installer v1.1.4 — Windows PowerShell
# Run from CMD: powershell -ExecutionPolicy Bypass -Command "irm https://killgame.ai/kill.ps1 | iex"

$ErrorActionPreference = "Stop"

function Write-Step($n, $msg) { Write-Host "[${n}/7] $msg" -ForegroundColor Magenta }
function Write-OK($msg)       { Write-Host "  + $msg" -ForegroundColor Cyan }
function Write-Fail($msg)     { Write-Host "  x $msg" -ForegroundColor Red }
function WriteFile($path, $content) {
    [System.IO.File]::WriteAllText(
        (Join-Path $PWD $path),
        $content,
        [System.Text.UTF8Encoding]::new($false)   # UTF-8, no BOM
    )
}

Write-Host ""
Write-Host "  ██╗  ██╗██╗██╗     ██╗" -ForegroundColor Red
Write-Host "  ██║ ██╔╝██║██║     ██║" -ForegroundColor Red
Write-Host "  █████╔╝ ██║██║     ██║" -ForegroundColor Red
Write-Host "  ██╔═██╗ ██║██║     ██║" -ForegroundColor Red
Write-Host "  ██║  ██╗██║███████╗███████╗" -ForegroundColor Red
Write-Host ""
Write-Host "  KILL SYSTEM — Windows Installer v1.1.4" -ForegroundColor White
Write-Host "  ----------------------------------------"
Write-Host ""

# ── Prerequisite check ──────────────────────────────────────────────────────
if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
    Write-Host "ERROR: Node.js not found." -ForegroundColor Red
    Write-Host "Install from https://nodejs.org (LTS), then re-run this script." -ForegroundColor Yellow
    exit 1
}
if (-not (Get-Command npm -ErrorAction SilentlyContinue)) {
    Write-Host "ERROR: npm not found. Re-install Node.js from https://nodejs.org" -ForegroundColor Red
    exit 1
}
Write-OK "Node.js $(node --version)  /  npm $(npm --version)"

# ── 1. Scaffolding ───────────────────────────────────────────────────────────
Write-Step 1 "Creating directory structure..."
foreach ($d in @("agents\sniper","agents\fortress","agents\aftershock","data\abi")) {
    New-Item -ItemType Directory -Force -Path $d | Out-Null
}
Write-OK "agents/{sniper,fortress,aftershock}  data/abi"

# ── 2. ABIs ──────────────────────────────────────────────────────────────────
Write-Step 2 "Writing ABIs..."

$killGameAbi = @'
{
  "contractName": "KILLGame",
  "abi": [{"inputs":[{"internalType":"address","name":"_tokenAddress","type":"address"}],"stateMutability":"nonpayable","type":"constructor"},{"inputs":[{"internalType":"address","name":"target","type":"address"}],"name":"AddressEmptyCode","type":"error"},{"inputs":[{"internalType":"address","name":"sender","type":"address"},{"internalType":"uint256","name":"balance","type":"uint256"},{"internalType":"uint256","name":"needed","type":"uint256"},{"internalType":"uint256","name":"tokenId","type":"uint256"}],"name":"ERC1155InsufficientBalance","type":"error"},{"inputs":[{"internalType":"address","name":"approver","type":"address"}],"name":"ERC1155InvalidApprover","type":"error"},{"inputs":[{"internalType":"uint256","name":"idsLength","type":"uint256"},{"internalType":"uint256","name":"valuesLength","type":"uint256"}],"name":"ERC1155InvalidArrayLength","type":"error"},{"inputs":[{"internalType":"address","name":"operator","type":"address"}],"name":"ERC1155InvalidOperator","type":"error"},{"inputs":[{"internalType":"address","name":"receiver","type":"address"}],"name":"ERC1155InvalidReceiver","type":"error"},{"inputs":[{"internalType":"address","name":"sender","type":"address"}],"name":"ERC1155InvalidSender","type":"error"},{"inputs":[{"internalType":"address","name":"operator","type":"address"},{"internalType":"address","name":"owner","type":"address"}],"name":"ERC1155MissingApprovalForAll","type":"error"},{"inputs":[],"name":"FailedCall","type":"error"},{"inputs":[{"internalType":"address","name":"owner","type":"address"}],"name":"OwnableInvalidOwner","type":"error"},{"inputs":[{"internalType":"address","name":"account","type":"address"}],"name":"OwnableUnauthorizedAccount","type":"error"},{"inputs":[],"name":"ReentrancyGuardReentrantCall","type":"error"},{"anonymous":false,"inputs":[{"indexed":true,"internalType":"address","name":"account","type":"address"},{"indexed":true,"internalType":"address","name":"operator","type":"address"},{"indexed":false,"internalType":"bool","name":"approved","type":"bool"}],"name":"ApprovalForAll","type":"event"},{"anonymous":false,"inputs":[{"indexed":true,"internalType":"address","name":"defender","type":"address"},{"indexed":false,"internalType":"uint256","name":"amount","type":"uint256"}],"name":"DefenderRewarded","type":"event"},{"anonymous":false,"inputs":[{"indexed":false,"internalType":"uint256","name":"totalUnitsKilled","type":"uint256"},{"indexed":false,"internalType":"uint256","name":"totalReaperKilled","type":"uint256"},{"indexed":false,"internalType":"uint256","name":"killAdded","type":"uint256"},{"indexed":false,"internalType":"uint256","name":"killExtracted","type":"uint256"},{"indexed":false,"internalType":"uint256","name":"killBurned","type":"uint256"}],"name":"GlobalStats","type":"event"},{"anonymous":false,"inputs":[{"indexed":true,"internalType":"address","name":"attacker","type":"address"},{"indexed":true,"internalType":"address","name":"target","type":"address"},{"indexed":true,"internalType":"uint16","name":"stackId","type":"uint16"},{"components":[{"internalType":"uint256","name":"attackerUnitsSent","type":"uint256"},{"internalType":"uint256","name":"attackerReaperSent","type":"uint256"},{"internalType":"uint256","name":"attackerUnitsLost","type":"uint256"},{"internalType":"uint256","name":"attackerReaperLost","type":"uint256"},{"internalType":"uint256","name":"targetUnitsLost","type":"uint256"},{"internalType":"uint256","name":"targetReaperLost","type":"uint256"},{"internalType":"uint256","name":"initialDefenderUnits","type":"uint256"},{"internalType":"uint256","name":"initialDefenderReaper","type":"uint256"},{"internalType":"uint256","name":"attackerBounty","type":"uint256"},{"internalType":"uint256","name":"defenderBounty","type":"uint256"}],"indexed":false,"internalType":"struct KILLGame.BattleSummary","name":"summary","type":"tuple"},{"indexed":false,"internalType":"uint256","name":"targetBirthBlock","type":"uint256"}],"name":"Killed","type":"event"},{"anonymous":false,"inputs":[{"indexed":true,"internalType":"address","name":"agent","type":"address"},{"indexed":false,"internalType":"uint16","name":"fromStack","type":"uint16"},{"indexed":false,"internalType":"uint16","name":"toStack","type":"uint16"},{"indexed":false,"internalType":"uint256","name":"units","type":"uint256"},{"indexed":false,"internalType":"uint256","name":"reaper","type":"uint256"},{"indexed":false,"internalType":"uint256","name":"birthBlock","type":"uint256"}],"name":"Moved","type":"event"},{"anonymous":false,"inputs":[{"indexed":true,"internalType":"address","name":"previousOwner","type":"address"},{"indexed":true,"internalType":"address","name":"newOwner","type":"address"}],"name":"OwnershipTransferred","type":"event"},{"anonymous":false,"inputs":[{"indexed":true,"internalType":"address","name":"agent","type":"address"},{"indexed":true,"internalType":"uint256","name":"stackId","type":"uint256"},{"indexed":false,"internalType":"uint256","name":"units","type":"uint256"},{"indexed":false,"internalType":"uint256","name":"reapers","type":"uint256"},{"indexed":false,"internalType":"uint256","name":"birthBlock","type":"uint256"}],"name":"Spawned","type":"event"},{"anonymous":false,"inputs":[{"indexed":true,"internalType":"address","name":"operator","type":"address"},{"indexed":true,"internalType":"address","name":"from","type":"address"},{"indexed":true,"internalType":"address","name":"to","type":"address"},{"indexed":false,"internalType":"uint256[]","name":"ids","type":"uint256[]"},{"indexed":false,"internalType":"uint256[]","name":"values","type":"uint256[]"}],"name":"TransferBatch","type":"event"},{"anonymous":false,"inputs":[{"indexed":true,"internalType":"address","name":"operator","type":"address"},{"indexed":true,"internalType":"address","name":"from","type":"address"},{"indexed":true,"internalType":"address","name":"to","type":"address"},{"indexed":false,"internalType":"uint256","name":"id","type":"uint256"},{"indexed":false,"internalType":"uint256","name":"value","type":"uint256"}],"name":"TransferSingle","type":"event"},{"anonymous":false,"inputs":[{"indexed":false,"internalType":"uint256","name":"oldBps","type":"uint256"},{"indexed":false,"internalType":"uint256","name":"newBps","type":"uint256"}],"name":"TreasuryBpsUpdated","type":"event"},{"anonymous":false,"inputs":[{"indexed":false,"internalType":"string","name":"value","type":"string"},{"indexed":true,"internalType":"uint256","name":"id","type":"uint256"}],"name":"URI","type":"event"},{"inputs":[],"name":"BURN_BPS","outputs":[{"internalType":"uint256","name":"","type":"uint256"}],"stateMutability":"view","type":"function"},{"inputs":[],"name":"MOVE_COST","outputs":[{"internalType":"uint256","name":"","type":"uint256"}],"stateMutability":"view","type":"function"},{"inputs":[],"name":"SPAWN_COST","outputs":[{"internalType":"uint256","name":"","type":"uint256"}],"stateMutability":"view","type":"function"},{"inputs":[],"name":"THERMAL_PARITY","outputs":[{"internalType":"uint256","name":"","type":"uint256"}],"stateMutability":"view","type":"function"},{"inputs":[{"internalType":"uint256","name":"amt","type":"uint256"}],"name":"adminWithdraw","outputs":[],"stateMutability":"nonpayable","type":"function"},{"inputs":[{"internalType":"address","name":"","type":"address"},{"internalType":"uint256","name":"","type":"uint256"}],"name":"agentStacks","outputs":[{"internalType":"uint256","name":"birthBlock","type":"uint256"}],"stateMutability":"view","type":"function"},{"inputs":[{"internalType":"address","name":"","type":"address"}],"name":"agentTotalProfit","outputs":[{"internalType":"uint256","name":"","type":"uint256"}],"stateMutability":"view","type":"function"},{"inputs":[{"internalType":"address","name":"account","type":"address"},{"internalType":"uint256","name":"id","type":"uint256"}],"name":"balanceOf","outputs":[{"internalType":"uint256","name":"","type":"uint256"}],"stateMutability":"view","type":"function"},{"inputs":[{"internalType":"address[]","name":"accounts","type":"address[]"},{"internalType":"uint256[]","name":"ids","type":"uint256[]"}],"name":"balanceOfBatch","outputs":[{"internalType":"uint256[]","name":"","type":"uint256[]"}],"stateMutability":"view","type":"function"},{"inputs":[{"internalType":"address","name":"agent","type":"address"},{"internalType":"uint256","name":"id","type":"uint256"}],"name":"getBirthBlock","outputs":[{"internalType":"uint256","name":"getBirthBlock","type":"uint256"}],"stateMutability":"view","type":"function"},{"inputs":[{"internalType":"uint16","name":"stackId","type":"uint16"}],"name":"getFullStack","outputs":[{"components":[{"internalType":"address","name":"occupant","type":"address"},{"internalType":"uint256","name":"units","type":"uint256"},{"internalType":"uint256","name":"reapers","type":"uint256"},{"internalType":"uint256","name":"age","type":"uint256"},{"internalType":"uint256","name":"pendingBounty","type":"uint256"}],"internalType":"struct KILLGame.StackInfo[]","name":"","type":"tuple[]"}],"stateMutability":"view","type":"function"},{"inputs":[{"internalType":"address","name":"agent","type":"address"},{"internalType":"uint256","name":"id","type":"uint256"}],"name":"getPendingBounty","outputs":[{"internalType":"uint256","name":"getPendingBounty","type":"uint256"}],"stateMutability":"view","type":"function"},{"inputs":[],"name":"getTreasuryStats","outputs":[{"internalType":"uint256","name":"totalTreasury","type":"uint256"},{"internalType":"uint256","name":"globalMaxBounty","type":"uint256"}],"stateMutability":"view","type":"function"},{"inputs":[{"internalType":"address","name":"account","type":"address"},{"internalType":"address","name":"operator","type":"address"}],"name":"isApprovedForAll","outputs":[{"internalType":"bool","name":"","type":"bool"}],"stateMutability":"view","type":"function"},{"inputs":[{"internalType":"address","name":"target","type":"address"},{"internalType":"uint16","name":"stackId","type":"uint16"},{"internalType":"uint256","name":"sentUnits","type":"uint256"},{"internalType":"uint256","name":"sentReaper","type":"uint256"}],"name":"kill","outputs":[{"internalType":"uint256","name":"attackerBounty","type":"uint256"}],"stateMutability":"nonpayable","type":"function"},{"inputs":[],"name":"killToken","outputs":[{"internalType":"contract IERC20","name":"","type":"address"}],"stateMutability":"view","type":"function"},{"inputs":[{"internalType":"uint16","name":"fromStack","type":"uint16"},{"internalType":"uint16","name":"toStack","type":"uint16"},{"internalType":"uint256","name":"units","type":"uint256"},{"internalType":"uint256","name":"reaper","type":"uint256"}],"name":"move","outputs":[],"stateMutability":"nonpayable","type":"function"},{"inputs":[{"internalType":"bytes[]","name":"data","type":"bytes[]"}],"name":"multicall","outputs":[{"internalType":"bytes[]","name":"results","type":"bytes[]"}],"stateMutability":"nonpayable","type":"function"},{"inputs":[],"name":"owner","outputs":[{"internalType":"address","name":"","type":"address"}],"stateMutability":"view","type":"function"},{"inputs":[],"name":"renounceOwnership","outputs":[],"stateMutability":"nonpayable","type":"function"},{"inputs":[{"internalType":"address","name":"from","type":"address"},{"internalType":"address","name":"to","type":"address"},{"internalType":"uint256[]","name":"ids","type":"uint256[]"},{"internalType":"uint256[]","name":"values","type":"uint256[]"},{"internalType":"bytes","name":"data","type":"bytes"}],"name":"safeBatchTransferFrom","outputs":[],"stateMutability":"nonpayable","type":"function"},{"inputs":[{"internalType":"address","name":"from","type":"address"},{"internalType":"address","name":"to","type":"address"},{"internalType":"uint256","name":"id","type":"uint256"},{"internalType":"uint256","name":"value","type":"uint256"},{"internalType":"bytes","name":"data","type":"bytes"}],"name":"safeTransferFrom","outputs":[],"stateMutability":"nonpayable","type":"function"},{"inputs":[{"internalType":"address","name":"operator","type":"address"},{"internalType":"bool","name":"approved","type":"bool"}],"name":"setApprovalForAll","outputs":[],"stateMutability":"nonpayable","type":"function"},{"inputs":[{"internalType":"uint256","name":"_newBps","type":"uint256"}],"name":"setTreasuryBps","outputs":[],"stateMutability":"nonpayable","type":"function"},{"inputs":[{"internalType":"uint16","name":"stackId","type":"uint16"},{"internalType":"uint256","name":"amount","type":"uint256"}],"name":"spawn","outputs":[],"stateMutability":"nonpayable","type":"function"},{"inputs":[{"internalType":"bytes4","name":"id","type":"bytes4"}],"name":"supportsInterface","outputs":[{"internalType":"bool","name":"","type":"bool"}],"stateMutability":"view","type":"function"},{"inputs":[],"name":"totalKillAdded","outputs":[{"internalType":"uint256","name":"","type":"uint256"}],"stateMutability":"view","type":"function"},{"inputs":[],"name":"totalKillBurned","outputs":[{"internalType":"uint256","name":"","type":"uint256"}],"stateMutability":"view","type":"function"},{"inputs":[],"name":"totalKillExtracted","outputs":[{"internalType":"uint256","name":"","type":"uint256"}],"stateMutability":"view","type":"function"},{"inputs":[],"name":"totalReaperKilled","outputs":[{"internalType":"uint256","name":"","type":"uint256"}],"stateMutability":"view","type":"function"},{"inputs":[],"name":"totalUnitsKilled","outputs":[{"internalType":"uint256","name":"","type":"uint256"}],"stateMutability":"view","type":"function"},{"inputs":[{"internalType":"address","name":"newOwner","type":"address"}],"name":"transferOwnership","outputs":[{"internalType":"address","name":"","type":"address"}],"stateMutability":"view","type":"function"},{"inputs":[],"name":"treasuryBps","outputs":[{"internalType":"uint256","name":"","type":"uint256"}],"stateMutability":"view","type":"function"},{"inputs":[{"internalType":"uint256","name":"","type":"uint256"}],"name":"uri","outputs":[{"internalType":"string","name":"","type":"string"}],"stateMutability":"view","type":"function"}]
}
'@

$killFaucetAbi = @'
{
  "contractName": "KILLFaucet",
  "abi": [
    "function pullKill() external",
    "function hasClaimed(address) view returns (bool)"
  ]
}
'@

WriteFile "data\abi\KILLGame.json"   $killGameAbi
WriteFile "data\abi\KILLFaucet.json" $killFaucetAbi
Write-OK "KILLGame.json  KILLFaucet.json"

# ── 3. package.json ──────────────────────────────────────────────────────────
Write-Step 3 "Writing package.json..."
$packageJson = @'
{
  "name": "killgame",
  "version": "1.1.4",
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
'@
WriteFile "package.json" $packageJson
Write-OK "package.json"

# ── 4. Fetch + patch agents ──────────────────────────────────────────────────
Write-Step 4 "Fetching agents from GitHub..."
$BASE_URL = "https://raw.githubusercontent.com/HouseOfHufflepuff/kill/main"

foreach ($role in @("sniper","fortress","aftershock")) {
    try {
        Invoke-WebRequest -Uri "$BASE_URL/agents/$role/agent.js"     -OutFile "agents\$role\agent.js"     -UseBasicParsing
        Invoke-WebRequest -Uri "$BASE_URL/agents/$role/config.json"  -OutFile "agents\$role\config.json"  -UseBasicParsing
        Write-OK "$role fetched"
    } catch {
        Write-Fail "Could not fetch $role — check network / repo visibility"
        continue
    }

    $agentFile = "agents\$role\agent.js"
    if (Test-Path $agentFile) {
        $c = [System.IO.File]::ReadAllText((Resolve-Path $agentFile))

        # Mirror the four sed patches from kill.sh
        $c = $c.Replace(
            'await ethers.getContractAt("KILLGame", kill_game_addr)',
            "new ethers.Contract(kill_game_addr, JSON.parse(fs.readFileSync(path.join(__dirname, '../../data/abi/KILLGame.json'), 'utf8')).abi, wallet)"
        )
        $c = $c.Replace(
            'new ethers.Contract(kill_faucet_addr, faucetAbi, wallet)',
            "new ethers.Contract(kill_faucet_addr, JSON.parse(fs.readFileSync(path.join(__dirname, '../../data/abi/KILLFaucet.json'), 'utf8')).abi, wallet)"
        )
        $c = $c.Replace(
            'await ethers.getContractAt("IERC20", killTokenAddr)',
            "new ethers.Contract(killTokenAddr, ['function balanceOf(address) view returns (uint256)', 'function allowance(address, address) view returns (uint256)', 'function approve(address, uint256) returns (bool)', 'function transfer(address, uint256) returns (bool)'], wallet)"
        )
        $c = $c.Replace('config.private_key', 'process.env.PRIVATE_KEY')

        [System.IO.File]::WriteAllText((Resolve-Path $agentFile), $c, [System.Text.UTF8Encoding]::new($false))
        Write-OK "$role patched"
    }
}

# ── 5. hardhat.config.js ─────────────────────────────────────────────────────
Write-Step 5 "Writing hardhat config..."
$hardhatConfig = @'
require("@nomicfoundation/hardhat-toolbox");
require("dotenv").config();
module.exports = {
  solidity: "0.8.24",
  networks: {
    basesepolia: {
      url: "https://sepolia.base.org",
      accounts: [process.env.SNIPER_PK, process.env.FORTRESS_PK, process.env.AFTERSHOCK_PK].filter(Boolean)
    }
  }
};
'@
WriteFile "hardhat.config.js" $hardhatConfig
Write-OK "hardhat.config.js"

# ── 6. cli.js ────────────────────────────────────────────────────────────────
Write-Step 6 "Writing CLI..."
# Note: backticks in the JS template literals below are literal JS backticks,
# preserved correctly inside PowerShell single-quoted here-strings.
$cliJs = @'
#!/usr/bin/env node
const { program } = require('commander');
const inquirer = require('inquirer');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const ROOT = __dirname;
require('dotenv').config({ path: path.join(ROOT, '.env') });

const stackValidator = (val) => {
    const n = parseInt(val);
    if (n >= 1 && n <= 216) return true;
    return "Stack ID must be between 1 and 216";
};

program.command('setup').action(async () => {
  const ans = await inquirer.prompt([
    { type: 'input', name: 'pk',         message: 'Enter Private Key (used for all agents):', mask: '*' },
    { type: 'input', name: 'hub',        message: 'Hub Stack [1-216]:', default: '1', validate: stackValidator },
    { type: 'input', name: 'units',      message: 'Target Units:', default: '666' },
    { type: 'input', name: 'f_replenish',message: 'Fortress: REPLENISH_AMT:', default: '666' },
    { type: 'input', name: 'f_perimeter',message: 'Fortress: HUB_PERIMETER:', default: '1' },
    { type: 'input', name: 's_mult',     message: 'Sniper/Aftershock: KILL_MULTIPLIER:', default: '3' },
    { type: 'input', name: 's_thresh',   message: 'Sniper: PROFIT_THRESHOLD:', default: '0.25' },
    { type: 'input', name: 'a_max_kill', message: 'Aftershock: MAX_KILL (effective power limit):', default: '1000000' }
  ]);

  fs.writeFileSync(path.join(ROOT, '.env'), `SNIPER_PK=${ans.pk}\nFORTRESS_PK=${ans.pk}\nAFTERSHOCK_PK=${ans.pk}\n`);

  const fPath = path.join(ROOT, 'agents/fortress/config.json');
  if (fs.existsSync(fPath)) {
    let fConf = JSON.parse(fs.readFileSync(fPath, 'utf8'));
    fConf.settings.HUB_STACK    = parseInt(ans.hub);
    fConf.settings.TARGET_UNITS = parseInt(ans.units);
    fConf.settings.REPLENISH_AMT = parseInt(ans.f_replenish);
    fConf.settings.HUB_PERIMETER = parseInt(ans.f_perimeter);
    fs.writeFileSync(fPath, JSON.stringify(fConf, null, 2));
  }

  const sPath = path.join(ROOT, 'agents/sniper/config.json');
  if (fs.existsSync(sPath)) {
    let sConf = JSON.parse(fs.readFileSync(sPath, 'utf8'));
    sConf.settings.HUB_STACK = parseInt(ans.hub);
    sConf.settings.KILL_MULTIPLIER = parseInt(ans.s_mult);
    sConf.settings.SPAWN_PROFITABILITY_THRESHOLD = parseFloat(ans.s_thresh);
    sConf.settings.SUBGRAPH_URL = "https://api.goldsky.com/api/public/project_cmlgypvyy520901u8f5821f19/subgraphs/kill-testnet-subgraph/1.0.2/gn";
    fs.writeFileSync(sPath, JSON.stringify(sConf, null, 2));
  }

  const aPath = path.join(ROOT, 'agents/aftershock/config.json');
  if (fs.existsSync(aPath)) {
    let aConf = JSON.parse(fs.readFileSync(aPath, 'utf8'));
    aConf.settings.KILL_MULTIPLIER = parseInt(ans.s_mult);
    aConf.settings.MAX_KILL        = parseInt(ans.a_max_kill);
    aConf.settings.SUBGRAPH_URL    = "https://api.goldsky.com/api/public/project_cmlgypvyy520901u8f5821f19/subgraphs/kill-testnet-subgraph/1.0.2/gn";
    fs.writeFileSync(aPath, JSON.stringify(aConf, null, 2));
  }

  console.log('Setup complete. Run: killgame start <agent>');
});

program.command('list agents').action(() => {
    console.log(JSON.stringify(['fortress', 'sniper', 'aftershock']));
});

program.command('start <role>').action((role) => {
  const agentDir  = path.join(ROOT, 'agents', role);
  if (!fs.existsSync(agentDir)) {
    console.error(`Role ${role} not found. Use: killgame list agents`);
    return;
  }
  const agentPath  = path.join(agentDir, 'agent.js');
  const config     = JSON.parse(fs.readFileSync(path.join(agentDir, 'config.json'), 'utf8'));
  const networkName = config.network.network_name || 'basesepolia';
  const pk = process.env[`${role.toUpperCase()}_PK`];
  if (!pk) { console.error("Run 'killgame setup' first."); process.exit(1); }

  spawn('npx', ['hardhat', 'run', agentPath, '--network', networkName], {
    cwd: ROOT, stdio: 'inherit', shell: true,
    env: { ...process.env, PRIVATE_KEY: pk, FORCE_COLOR: '1' }
  });
});

program.parse(process.argv);
'@
WriteFile "cli.js" $cliJs
Write-OK "cli.js"

# ── 7. npm install + link ────────────────────────────────────────────────────
Write-Step 7 "Installing dependencies (this takes a minute)..."
npm install --quiet
if ($LASTEXITCODE -ne 0) { Write-Fail "npm install failed"; exit 1 }

Write-Host ""
Write-Host "  Linking global command..." -ForegroundColor DarkGray
npm link --force --quiet
if ($LASTEXITCODE -ne 0) {
    Write-Host ""
    Write-Host "  npm link failed — try running this script as Administrator," -ForegroundColor Yellow
    Write-Host "  or run agents directly with: node cli.js start <agent>" -ForegroundColor Yellow
} else {
    Write-OK "killgame command registered globally"
}

# ── Done ─────────────────────────────────────────────────────────────────────
Write-Host ""
Write-Host "------------------------------------------------" -ForegroundColor Magenta
Write-Host "  SUCCESS: KILLGame installed in $PWD" -ForegroundColor Green
Write-Host "------------------------------------------------"
Write-Host "  1.  killgame setup"
Write-Host "  2.  killgame list agents"
Write-Host "  3.  killgame start aftershock"
Write-Host "------------------------------------------------"
Write-Host ""
