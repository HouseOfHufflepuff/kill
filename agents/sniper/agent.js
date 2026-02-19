const { ethers } = require("hardhat");
const fs = require("fs");
const path = require("path");
require("dotenv").config();

// --- TACTICAL UTILITIES ---
function toCoords(id) {
    const v = id - 1;
    return { x: v % 6, y: Math.floor(v / 6) % 6, z: Math.floor(v / 36) };
}

function getManhattanDist(id1, id2) {
    const c1 = toCoords(id1);
    const c2 = toCoords(id2);
    return Math.abs(c1.x - c2.x) + Math.abs(c1.y - c2.y) + Math.abs(c1.z - c2.z);
}

function getStepTowardHub(currentId, hubId) {
    const target = toCoords(hubId);
    let neighbors = [];
    for (let i = 1; i <= 216; i++) {
        if (getManhattanDist(currentId, i) === 1) neighbors.push({ id: i, coords: toCoords(i) });
    }
    return neighbors.sort((a, b) => {
        const distA = Math.abs(a.coords.x - target.x) + Math.abs(a.coords.y - target.y) + Math.abs(a.coords.z - target.z);
        const distB = Math.abs(b.coords.x - target.x) + Math.abs(b.coords.y - target.y) + Math.abs(b.coords.z - target.z);
        return distA - distB;
    })[0].id;
}

async function countdown(seconds) {
    for (let i = seconds; i > 0; i--) {
        process.stdout.write(`\r[WAIT] Next hunt in ${i}s... `);
        await new Promise(r => setTimeout(r, 1000));
    }
    process.stdout.write('\r\x1b[K');
}

async function main() {
    const wallet = new ethers.Wallet(process.env.SNIPER_PK, ethers.provider);
    const address = wallet.address;
    const config = JSON.parse(fs.readFileSync(path.join(__dirname, "config.json"), "utf8"));
    const { kill_game_addr, multicall_addr } = config.network;
    const { HUB_STACK, MIN_TARGET_UNITS, SPAWN_MULTIPLIER, SPAWN_BUFFER, LOOP_DELAY_SECONDS, DEFENSE_MULTIPLIER } = config.settings;

    const killGame = await ethers.getContractAt("KILLGame", kill_game_addr);
    const killTokenAddr = await killGame.killToken();
    const killToken = await ethers.getContractAt("IERC20", killTokenAddr);
    const multicall = new ethers.Contract(multicall_addr, ["function aggregate(tuple(address target, bytes callData)[] calls) public view returns (uint256 blockNumber, bytes[] returnData)"], wallet);

    const TX_OPTS = { gasLimit: 1200000, gasPrice: ethers.utils.parseUnits("3", "gwei") };

    while (true) {
        console.log(`\n--- SNIPER AGENT: LIQUIDATOR-DEFENDER ---`);
        
        try {
            const [killBalance, allowance, treasury] = await Promise.all([
                killToken.balanceOf(address),
                killToken.allowance(address, kill_game_addr),
                killToken.balanceOf(kill_game_addr)
            ]);

            if (allowance.lt(ethers.utils.parseUnits("100000000", 18))) {
                await (await killToken.connect(wallet).approve(kill_game_addr, ethers.constants.MaxUint256, TX_OPTS)).wait();
            }

            const scanIds = Array.from({ length: 216 }, (_, i) => i + 1);
            const calls = scanIds.map(id => ({ target: kill_game_addr, callData: killGame.interface.encodeFunctionData("getFullStack", [id]) }));
            const [, returnData] = await multicall.aggregate(calls);
            
            let allEnemies = [];
            let stragglers = [];
            let hubIntruders = [];
            let myHubState = { units: ethers.BigNumber.from(0), reapers: ethers.BigNumber.from(0) };

            for (let i = 0; i < returnData.length; i++) {
                const stackId = scanIds[i];
                const items = killGame.interface.decodeFunctionResult("getFullStack", returnData[i])[0];
                const self = items.find(it => it.occupant.toLowerCase() === address.toLowerCase());
                const enemies = items.filter(it => it.occupant.toLowerCase() !== address.toLowerCase() && (it.units.gt(0) || it.reapers.gt(0)));

                if (stackId === HUB_STACK) {
                    if (self) myHubState = self;
                    hubIntruders = enemies;
                }
                if (enemies.length > 0 && stackId !== HUB_STACK) {
                    allEnemies.push({ id: stackId, enemy: enemies.sort((a,b) => b.units.sub(a.units))[0] });
                } else if (self && stackId !== HUB_STACK && (self.units.gt(0) || self.reapers.gt(0))) {
                    stragglers.push({ id: stackId, units: self.units, reapers: self.reapers });
                }
            }

            console.table({
                "Wallet KILL": ethers.utils.formatUnits(killBalance, 18),
                "Treasury": ethers.utils.formatUnits(treasury, 18),
                "Hub Status": hubIntruders.length > 0 ? "!! UNDER ATTACK !!" : "SECURE",
                "Targets": allEnemies.length
            });

            // --- PRIORITY 1: OVERWHELMING HUB DEFENSE ---
            if (hubIntruders.length > 0) {
                const intruder = hubIntruders.sort((a,b) => b.units.sub(a.units))[0];
                
                // Calculate Overwhelming Force: 10x the enemy or whatever we can afford
                let spawnAmt = intruder.units.mul(DEFENSE_MULTIPLIER || 10).add(SPAWN_BUFFER);
                const maxAffordable = killBalance.div(ethers.utils.parseUnits("10", 18));
                
                if (spawnAmt.gt(maxAffordable)) spawnAmt = maxAffordable;

                console.log(`[DEFENSE] Intruder: ${intruder.units} units. Spawning: ${spawnAmt} (Overwhelming Force)`);
                
                if (myHubState.units.lt(intruder.units.mul(2))) { // Spawn if we don't have at least double their units
                    await (await killGame.connect(wallet).spawn(HUB_STACK, spawnAmt, TX_OPTS)).wait();
                    // Refresh state to ensure we have the units
                    const fresh = await killGame.getFullStack(HUB_STACK);
                    myHubState = fresh.find(it => it.occupant.toLowerCase() === address.toLowerCase());
                }

                if (myHubState.units.gt(intruder.units)) {
                    console.log(`[KILL] Purging ${intruder.occupant.slice(0,8)}...`);
                    await (await killGame.connect(wallet).kill(intruder.occupant, HUB_STACK, myHubState.units.sub(1), 0, TX_OPTS)).wait();
                }
            } 
            // --- PRIORITY 2: PROFITABLE SNIPE ---
            else if (allEnemies.length > 0) {
                const target = allEnemies.filter(e => e.enemy.units.gte(MIN_TARGET_UNITS)).sort((a,b) => b.enemy.units.sub(a.enemy.units))[0];
                if (target) {
                    const spawnAmt = target.enemy.units.mul(SPAWN_MULTIPLIER).add(SPAWN_BUFFER);
                    const cost = spawnAmt.mul(ethers.utils.parseUnits("10", 18));
                    const bountyPct = await killGame.BOUNTY_PERCENTAGE();
                    const expectedBounty = treasury.mul(bountyPct).div(100);

                    if (expectedBounty.gt(cost)) {
                        console.log(`[ATTACK] Profit: ${ethers.utils.formatUnits(expectedBounty.sub(cost), 18)} KILL. Spawning on ${target.id}`);
                        await (await killGame.connect(wallet).spawn(target.id, spawnAmt, TX_OPTS)).wait();
                        await (await killGame.connect(wallet).kill(target.enemy.occupant, target.id, spawnAmt.sub(1), 0, TX_OPTS)).wait();
                    }
                }
            } 
            // --- PRIORITY 3: RETURN TO BASE ---
            else if (stragglers.length > 0) {
                const s = stragglers[0];
                const next = getStepTowardHub(s.id, HUB_STACK);
                console.log(`[CONSOLIDATE] ${s.id} -> ${next}`);
                await (await killGame.connect(wallet).move(s.id, next, s.units, s.reapers, TX_OPTS)).wait();
            }

        } catch (err) { console.error("\n[ERROR]", err.message.substring(0,100)); }
        await countdown(LOOP_DELAY_SECONDS);
    }
}
main().catch(console.error);