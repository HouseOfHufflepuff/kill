const { ethers } = require("hardhat");
const fs = require("fs");
const path = require("path");
require("dotenv").config();

async function countdown(seconds) {
    for (let i = seconds; i > 0; i--) {
        process.stdout.write(`\r[WAIT] Next hunt in ${i}s... `);
        await new Promise(r => setTimeout(r, 1000));
    }
    process.stdout.write('\r\x1b[K');
}

function toCoords(id) {
    const v = id - 1;
    return { x: v % 6, y: Math.floor(v / 6) % 6, z: Math.floor(v / 36) };
}

function getStepTowardHub(currentId, hubId) {
    const target = toCoords(hubId);
    let neighbors = [];
    for (let i = 1; i <= 216; i++) {
        const c1 = toCoords(currentId);
        const c2 = toCoords(i);
        if ((Math.abs(c1.x - c2.x) + Math.abs(c1.y - c2.y) + Math.abs(c1.z - c2.z)) === 1) {
            neighbors.push({ id: i, coords: c2 });
        }
    }
    return neighbors.sort((a, b) => {
        const distA = Math.abs(a.coords.x - target.x) + Math.abs(a.coords.y - target.y) + Math.abs(a.coords.z - target.z);
        const distB = Math.abs(b.coords.x - target.x) + Math.abs(b.coords.y - target.y) + Math.abs(b.coords.z - target.z);
        return distA - distB;
    })[0].id;
}

async function main() {
    if (!process.env.SNIPER_PK) throw new Error("Missing SNIPER_PK");
    const wallet = new ethers.Wallet(process.env.SNIPER_PK, ethers.provider);
    const address = wallet.address;
    const fortressAddress = process.env.FORTRESS_PK ? new ethers.Wallet(process.env.FORTRESS_PK).address.toLowerCase() : "";

    const config = JSON.parse(fs.readFileSync(path.join(__dirname, "config.json"), "utf8"));
    const { kill_game_addr, multicall_addr } = config.network;
    const { HUB_STACK, MIN_TARGET_UNITS, SPAWN_MULTIPLIER, SPAWN_BUFFER, LOOP_DELAY_SECONDS } = config.settings;

    const killGame = await ethers.getContractAt("KILLGame", kill_game_addr);
    const killToken = await ethers.getContractAt("@openzeppelin/contracts/token/ERC20/IERC20.sol:IERC20", await killGame.killToken());
    const multicall = new ethers.Contract(multicall_addr, ["function aggregate(tuple(address target, bytes callData)[] calls) public view returns (uint256 blockNumber, bytes[] returnData)"], wallet);
    const SPAWN_COST = await killGame.SPAWN_COST();

    while (true) {
        console.clear();
        console.log(`\n--- SNIPER AGENT ONLINE | HUB: ${HUB_STACK} ---`);
        
        try {
            const ethBalance = await wallet.getBalance();
            const killBalance = await killToken.balanceOf(address);

            // Pre-flight check: Need at least ~0.005 ETH for a smooth experience
            if (ethBalance.lt(ethers.utils.parseEther("0.002"))) {
                console.log(`\n[!!!] CRITICAL: LOW ETH GAS`);
                console.log(`Have: ${ethers.utils.formatEther(ethBalance)} ETH | Need more for gas.`);
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
                const enemies = items.filter(it => it.occupant.toLowerCase() !== address.toLowerCase() && it.occupant.toLowerCase() !== fortressAddress && (it.units.gt(0) || it.reapers.gt(0)));

                if (stackId === HUB_STACK) {
                    if (self) myHubState = self;
                    if (enemies.length > 0) hubIntruders = enemies;
                }
                if (enemies.length > 0 && stackId !== HUB_STACK) {
                    allEnemies.push({ id: stackId, enemy: enemies.sort((a,b) => b.units.sub(a.units))[0] });
                } else if (self && stackId !== HUB_STACK && (self.units.gt(0) || self.reapers.gt(0))) {
                    stragglers.push({ id: stackId, units: self.units, reapers: self.reapers });
                }
            }

            console.log(`>> HUB STATUS: ${myHubState.units.toString()} Units | ${hubIntruders.length} Intruders`);

            const actionable = allEnemies.filter(e => e.enemy.units.gte(MIN_TARGET_UNITS)).sort((a,b) => b.enemy.units.sub(a.enemy.units))[0];

            if (hubIntruders.length > 0) {
                const intruder = hubIntruders[0];
                const spawnAmt = intruder.units.mul(SPAWN_MULTIPLIER).add(SPAWN_BUFFER);
                if (myHubState.units.lte(intruder.units)) {
                    if (killBalance.gte(SPAWN_COST.mul(spawnAmt)) && ethBalance.gt(0)) {
                        console.log(`[DEFENSE] Spawning ${spawnAmt.toString()} units...`);
                        await (await killGame.connect(wallet).spawn(HUB_STACK, spawnAmt, { gasLimit: 800000 })).wait();
                    }
                }
                const updated = await killGame.getFullStack(HUB_STACK);
                const me = updated.find(it => it.occupant.toLowerCase() === address.toLowerCase());
                if (me && me.units.gt(0)) {
                    await (await killGame.connect(wallet).kill(intruder.occupant, HUB_STACK, me.units.sub(1), me.reapers, { gasLimit: 800000 })).wait();
                }
            } 
            else if (actionable) {
                const spawnAmt = actionable.enemy.units.mul(SPAWN_MULTIPLIER).add(SPAWY_BUFFER || 1000);
                const requiredKill = SPAWN_COST.mul(spawnAmt);

                if (killBalance.lt(requiredKill)) {
                    console.log(`[SKIP] Insufficient KILL for attack.`);
                } else if (ethBalance.lt(ethers.utils.parseEther("0.0015"))) {
                    console.log(`[SKIP] ETH Gas too low for attack.`);
                } else {
                    console.log(`[ATTACK] Stack ${actionable.id} | Enemy: ${actionable.enemy.units.toString()} | Spawning: ${spawnAmt.toString()}`);
                    await (await killGame.connect(wallet).spawn(actionable.id, spawnAmt, { gasLimit: 800000 })).wait();
                    const fresh = await killGame.getFullStack(actionable.id);
                    const me = fresh.find(it => it.occupant.toLowerCase() === address.toLowerCase());
                    if (me && me.units.gt(actionable.enemy.units)) {
                        await (await killGame.connect(wallet).kill(actionable.enemy.occupant, actionable.id, me.units.sub(1), me.reapers, { gasLimit: 800000 })).wait();
                    }
                }
            } 
            else if (stragglers.length > 0) {
                const s = stragglers[0];
                const next = getStepTowardHub(s.id, HUB_STACK);
                console.log(`[MOVE] Straggler ${s.id} -> ${next}`);
                await (await killGame.connect(wallet).move(s.id, next, s.units, s.reapers, { gasLimit: 500000 })).wait();
            }

            if (allEnemies.length > 0) {
                console.log("\n>> MAP ENEMIES:");
                console.table(allEnemies.slice(0, 5).map(e => ({ Stack: e.id, Units: e.enemy.units.toString(), Target: e.enemy.units.gte(MIN_TARGET_UNITS) ? "YES" : "NO" })));
            }

        } catch (err) { console.error("\n[RUNTIME ERROR]", err.message); }
        await countdown(LOOP_DELAY_SECONDS);
    }
}
main().catch(console.error);