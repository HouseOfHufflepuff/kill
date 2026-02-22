const { ethers } = require("hardhat");
const fs = require("fs");
const path = require("path");
require("dotenv").config();

const YEL = "\x1b[33m"; const CYA = "\x1b[36m"; const PNK = "\x1b[35m"; const RES = "\x1b[0m"; const BRIGHT = "\x1b[1m";

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
    const killTokenAddr = await killGame.killToken();
    const killToken = await ethers.getContractAt("IERC20", killTokenAddr);
    
    const SPAWN_COST_PER_UNIT = 10; 
    const REAPER_BOUNTY = 3330; 

    while (true) {
        try {
            const ethBal = await ethers.provider.getBalance(wallet.address);
            const killBal = await killToken.balanceOf(wallet.address);
            const killAllow = await killToken.allowance(wallet.address, config.network.kill_game_addr);

            const scanIds = Array.from({ length: 216 }, (_, i) => i + 1);
            const stackCalls = scanIds.map(id => killGame.interface.encodeFunctionData("getFullStack", [id]));
            const results = await killGame.callStatic.multicall(stackCalls);
            
            let myStrandedStacks = [];
            let targets = [];

            for (let i = 0; i < 216; i++) {
                const stackId = i + 1;
                const items = killGame.interface.decodeFunctionResult("getFullStack", results[i])[0];
                const self = items.find(it => it.occupant.toLowerCase() === wallet.address.toLowerCase());
                const enemies = items.filter(it => it.occupant.toLowerCase() !== wallet.address.toLowerCase() && it.units.gt(0));

                if (self && stackId !== HUB_STACK && (self.units.gt(0) || self.reapers.gt(0))) {
                    myStrandedStacks.push({ id: stackId, units: self.units, reapers: self.reapers });
                }

                for (const e of enemies) {
                    const bountyVal = e.units.mul(SPAWN_COST_PER_UNIT).add(e.reapers.mul(REAPER_BOUNTY));
                    let spawnAmt = e.units.mul(KILL_MULTIPLIER);
                    if (spawnAmt.lt(MIN_SPAWN)) spawnAmt = ethers.BigNumber.from(MIN_SPAWN);
                    
                    const attackCost = spawnAmt.mul(SPAWN_COST_PER_UNIT);
                    // Ratio: 1000 for precision, then divide by 1000
                    const ratio = parseFloat(bountyVal.mul(1000).div(attackCost.gt(0) ? attackCost : 1).toString()) / 1000;
                    targets.push({ id: stackId, enemy: e, ratio, spawnAmt, bountyVal, attackCost });
                }
            }

            console.clear();
            console.log(`${BRIGHT}--- SNIPER AGENT | AUTO-APPROVE ENABLED ---${RES}`);
            
            // --- WALLET STATUS TABLE ---
            console.table([{
                ETH: ethers.utils.formatEther(ethBal).substring(0, 6),
                KILL: (parseFloat(ethers.utils.formatEther(killBal))).toFixed(1) + "K",
                APPROVED: killAllow.gt(ethers.constants.MaxUint256.div(2)) ? "MAX" : (parseFloat(ethers.utils.formatEther(killAllow))).toFixed(1) + "K"
            }]);

            // --- STRANDED UNITS ---
            if (myStrandedStacks.length > 0) {
                console.log(`\n${BRIGHT}${PNK}STRANDED UNITS (PRIORITY)${RES}`);
                myStrandedStacks.forEach(s => {
                    const hops = getPath3D(s.id, HUB_STACK).length;
                    console.log(`ID: ${s.id.toString().padEnd(4)} | Units: ${s.units.toString().padEnd(6)} | Hops: ${hops}`);
                });
            }

            // --- TARGET TABLE ---
            console.log(`\n${BRIGHT}ID   | ENEMY      | UNITS | BOUNTY   | RATIO | STATUS${RES}`);
            console.log(`-----|------------|-------|----------|-------|-------`);
            targets.sort((a,b) => b.ratio - a.ratio).slice(0, 10).forEach(t => {
                const isPass = t.ratio >= SPAWN_PROFITABILITY_THRESHOLD;
                const hasKill = killBal.gte(t.attackCost.mul(ethers.BigNumber.from(10).pow(18))); // Basic check
                const bountyStr = (parseFloat(t.bountyVal.toString()) / 1000).toFixed(1) + "K";
                
                let status = !isPass ? "LOW_ROI" : (killBal.lt(t.attackCost) ? "NO_KILL" : CYA + "READY" + RES);
                console.log(`${t.id.toString().padEnd(4)} | ${t.enemy.occupant.slice(0,10)} | ${t.enemy.units.toString().padEnd(5)} | ${bountyStr.padEnd(8)} | ${t.ratio.toFixed(2)}x | ${status}`);
            });

            const calls = [];
            if (myStrandedStacks.length > 0) {
                const s = myStrandedStacks[0];
                const moveStep = getPath3D(s.id, HUB_STACK)[0];
                console.log(`\n${YEL}[RETREAT] Moving ${s.id} -> ${moveStep.to}${RES}`);
                calls.push(killGame.interface.encodeFunctionData("move", [moveStep.from, moveStep.to, s.units, s.reapers]));
            } else {
                const best = targets.sort((a, b) => b.ratio - a.ratio)[0];
                if (best && best.ratio >= SPAWN_PROFITABILITY_THRESHOLD) {
                    if (killBal.gte(best.attackCost)) {
                        // AUTO-APPROVE
                        if (killAllow.lt(best.attackCost)) {
                            console.log(`${YEL}[AUTH] Approving KILL...${RES}`);
                            await (await killToken.connect(wallet).approve(config.network.kill_game_addr, ethers.constants.MaxUint256)).wait();
                        }

                        if (ethBal.gt(ethers.utils.parseEther("0.002"))) {
                            console.log(`\n${PNK}[ATTACK] Snipe ${best.id} | Ratio: ${best.ratio}x | Power: ${best.spawnAmt}${RES}`);
                            calls.push(killGame.interface.encodeFunctionData("spawn", [best.id, best.spawnAmt]));
                            calls.push(killGame.interface.encodeFunctionData("kill", [best.enemy.occupant, best.id, best.spawnAmt, 0]));
                        }
                    }
                }
            }

            if (calls.length > 0) {
                const tx = await killGame.connect(wallet).multicall(calls, { gasLimit: 2500000 });
                console.log(`${CYA}>> [TX]: ${tx.hash}${RES}`);
                await tx.wait();
            }
        } catch (err) { console.error("\n[ERROR]", err.message); }
        await new Promise(r => setTimeout(r, LOOP_DELAY_SECONDS * 1000));
    }
}
main();