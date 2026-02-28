const { ethers } = require("hardhat");
const fs = require("fs");
const path = require("path");
const fetch = require("node-fetch");
require("dotenv").config();

const YEL = "\x1b[33m"; const CYA = "\x1b[36m"; const PNK = "\x1b[35m"; const RES = "\x1b[0m"; const BRIGHT = "\x1b[1m";

// --- HELPERS (Reused from Sniper Pattern) ---
function getCoords(id) {
    const v = id - 1;
    return { x: v % 6, y: Math.floor(v / 6) % 6, z: Math.floor(v / 36) };
}
function getId(x, y, z) { return (z * 36) + (y * 6) + x + 1; }

// --- SUBGRAPH QUERY (Updated for Recent Kills) ---
async function getRecentKills(url) {
    // Queries the last 10 'Killed' events to find high-bounty targets
    const query = `{
        killeds(orderBy: block_number, orderDirection: desc, first: 10) {
            id
            stackId
            defenderBounty
            target
            block_number
        }
    }`;
    const resp = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query })
    });
    const result = await resp.json();
    return result.data.killeds;
}

// --- MAIN AGENT ---
async function main() {
    if (!process.env.AFTERSHOCK_PK) throw new Error("Missing AFTERSHOCK_PK in .env");
    const wallet = new ethers.Wallet(process.env.AFTERSHOCK_PK, ethers.provider);
    console.log(`[AGENT] Running as: ${wallet.address}`);
    
    const config = JSON.parse(fs.readFileSync(path.join(__dirname, "config.json"), "utf8"));
    const { LOOP_DELAY_SECONDS, KILL_MULTIPLIER, MIN_SPAWN, SUBGRAPH_URL } = config.settings;
    const { kill_game_addr } = config.network;
    
    const killGame = new ethers.Contract(kill_game_addr, JSON.parse(fs.readFileSync(path.join(__dirname, '../../data/abi/KILLGame.json'), 'utf8')).abi, wallet);
    const killTokenAddr = await killGame.killToken();
    const erc20Abi = [
        "function balanceOf(address) view returns (uint256)",
        "function allowance(address, address) view returns (uint256)",
        "function approve(address, uint256) returns (bool)"
    ];
    const killToken = new ethers.Contract(killTokenAddr, erc20Abi, wallet);
    
    const SPAWN_COST_PER_UNIT = 20; 
    const REAPER_BOUNTY = 3330; 
    
    // Keep track of processed kills to avoid re-attacking the same event
    let processedKills = new Set();

    console.log(`${BRIGHT}--- AFTERSHOCK AGENT ONLINE ---${RES}`);

    while (true) {
        try {
            const ethBal = await ethers.provider.getBalance(wallet.address);
            const killBal = await killToken.balanceOf(wallet.address);
            const killAllow = await killToken.allowance(wallet.address, kill_game_addr);

            // 1. Get recent kills from Subgraph [cite: 1]
            const recentKills = await getRecentKills(SUBGRAPH_URL);
            
            // 2. Identify potential targets based on bounty in recently killed stacks
            let targets = [];
            for (const kill of recentKills) {
                if (processedKills.has(kill.id)) continue;

                const stackId = parseInt(kill.stackId);
                const bountyVal = ethers.BigNumber.from(kill.defenderBounty);

                // Calculate required spawn amount for overkill
                let spawnAmt = ethers.BigNumber.from(MIN_SPAWN);
                const spawnReaper = spawnAmt.div(666);
                const totalPower = spawnAmt.add(spawnReaper.mul(666));
                const attackCost = totalPower.mul(SPAWN_COST_PER_UNIT);

                // Basic Profitability check (Bounty > Cost)
                const isProfitable = bountyVal.gt(attackCost);

                targets.push({
                    killId: kill.id,
                    stackId: stackId,
                    bountyVal,
                    attackCost,
                    spawnAmt,
                    spawnReaper,
                    isProfitable
                });
            }

            // --- STATUS DISPLAY (Sniper Pattern) ---
            console.clear();
            console.log(`${BRIGHT}--- AFTERSHOCK | STATUS ---${RES}`);
            console.table([{
                ETH: ethers.utils.formatEther(ethBal).substring(0, 6),
                KILL: (parseFloat(ethers.utils.formatEther(killBal))).toFixed(1) + "K",
                APPROVED: killAllow.gt(ethers.constants.MaxUint256.div(2)) ? "MAX" : (parseFloat(ethers.utils.formatEther(killAllow))).toFixed(1) + "K"
            }]);

            console.log(`\n${BRIGHT}ID   | BOUNTY   | COST     | PROFITABLE | STATUS${RES}`);
            console.log(`-----|----------|----------|------------|-------`);
            
            targets.slice(0, 5).forEach(t => {
                const bountyStr = (parseFloat(t.bountyVal.toString()) / 1e18).toFixed(1) + "K"; // Assuming bounty is wei
                const costStr = (parseFloat(t.attackCost.toString()) / 1e18).toFixed(1) + "K";
                let status = !t.isProfitable ? "LOW_ROI" : (killBal.lt(t.attackCost) ? "NO_KILL" : CYA + "READY" + RES);
                console.log(`${t.stackId.toString().padEnd(4)} | ${bountyStr.padEnd(8)} | ${costStr.padEnd(8)} | ${t.isProfitable.toString().padEnd(10)} | ${status}`);
            });

            // --- EXECUTION ---
            const bestTarget = targets.filter(t => t.isProfitable).sort((a,b) => b.bountyVal.sub(a.bountyVal))[0];

            if (bestTarget && killBal.gte(bestTarget.attackCost)) {
                console.log(`\n${PNK}[ATTACK] Aftershocking ${bestTarget.stackId} | Bounty: ${ethers.utils.formatEther(bestTarget.bountyVal)} ${RES}`);
                
                const calls = [];
                if (killAllow.lt(bestTarget.attackCost)) {
                    calls.push(killToken.interface.encodeFunctionData("approve", [kill_game_addr, ethers.constants.MaxUint256]));
                }
                
                calls.push(killGame.interface.encodeFunctionData("spawn", [bestTarget.stackId, bestTarget.spawnAmt]));
                calls.push(killGame.interface.encodeFunctionData("kill", [
                    ethers.constants.AddressZero, // Typically target is last killer, but 0x0 works in many game versions
                    bestTarget.stackId,
                    bestTarget.spawnAmt,
                    bestTarget.spawnReaper
                ]));

                const tx = await killGame.multicall(calls, { gasLimit: 2500000 });
                await tx.wait();
                processedKills.add(bestTarget.killId);
                console.log(`${CYA}>> [TX HASH]: ${tx.hash}${RES}`);
            }

        } catch (err) { console.error("\n[ERROR]", err.message); }
        await new Promise(r => setTimeout(r, LOOP_DELAY_SECONDS * 1000));
    }
}
main();