const { ethers } = require("hardhat");
const fs = require("fs");
const path = require("path");
require("dotenv").config();

// --- COORDINATE MATH ---
function getCoords(id) {
    const v = Number(id) - 1;
    return { x: v % 6, y: Math.floor(v / 6) % 6, z: Math.floor(v / 36) };
}

function getManhattanDist(id1, id2) {
    const c1 = getCoords(id1);
    const c2 = getCoords(id2);
    return Math.abs(c1.x - c2.x) + Math.abs(c1.y - c2.y) + Math.abs(c1.z - c2.z);
}

function isAdjacent(id1, id2) { return getManhattanDist(id1, id2) === 1; }
function calcPower(units, reapers) { return units.add(reapers.mul(666)); }

async function countdown(seconds) {
    for (let i = seconds; i > 0; i--) {
        process.stdout.write(`\r[WAIT] Next scan in ${i}s... `);
        await new Promise(r => setTimeout(r, 1000));
    }
    process.stdout.write('\r\x1b[K');
}

async function checkAndApprove(wallet, killGameAddr) {
    const killGame = await ethers.getContractAt("KILLGame", killGameAddr);
    const killTokenAddr = await killGame.killToken();
    const killToken = await ethers.getContractAt("IERC20", killTokenAddr);

    const allowance = await killToken.allowance(wallet.address, killGameAddr);
    if (allowance.lt(ethers.utils.parseUnits("1000000", 18))) {
        console.log(">> [SYSTEM] Insufficient allowance. Authorizing KILLGame...");
        const tx = await killToken.connect(wallet).approve(killGameAddr, ethers.constants.MaxUint256);
        await tx.wait();
        console.log(">> [SYSTEM] Authorization Successful.");
    }
}

async function main() {
    const wallet = new ethers.Wallet(process.env.FORTRESS_PK, ethers.provider);
    const address = wallet.address;
    const config = JSON.parse(fs.readFileSync(path.join(__dirname, "config.json"), "utf8"));
    const { kill_game_addr, multicall_addr } = config.network;
    const { HUB_STACK, TARGET_UNITS, REPLENISH_AMT, LOOP_DELAY_SECONDS, HUB_PERIMETER } = config.settings;

    const killGame = await ethers.getContractAt("KILLGame", kill_game_addr);
    const multicall = new ethers.Contract(multicall_addr, ["function aggregate(tuple(address target, bytes callData)[] calls) public view returns (uint256 blockNumber, bytes[] returnData)"], wallet);

    // One-time setup
    await checkAndApprove(wallet, kill_game_addr);

    const ALL_IDS = Array.from({length: 216}, (_, i) => i + 1);
    const PATROL_ZONE = ALL_IDS.filter(id => id !== HUB_STACK && getManhattanDist(HUB_STACK, id) <= HUB_PERIMETER);
    const SAFE_ZONE = [HUB_STACK, ...PATROL_ZONE];

    while (true) {
        console.log(`\n--- FORTRESS AGENT: LIQUIDATION MODE ---`);
        try {
            const calls = ALL_IDS.map(id => ({ target: kill_game_addr, callData: killGame.interface.encodeFunctionData("getFullStack", [id]) }));
            const [, returnData] = await multicall.aggregate(calls);

            let hubState = { self: null, enemies: [] };
            let validTargets = [];
            let myActiveStacks = [];
            let myTotalUnitsGlobal = ethers.BigNumber.from(0);
            let tacticalData = [];

            for (let i = 0; i < returnData.length; i++) {
                const stackId = ALL_IDS[i];
                const items = killGame.interface.decodeFunctionResult("getFullStack", returnData[i])[0];
                const self = items.find(it => it.occupant.toLowerCase() === address.toLowerCase());
                const enemies = items.filter(it => it.occupant.toLowerCase() !== address.toLowerCase() && (it.units.gt(0) || it.reapers.gt(0)));
                const dist = getManhattanDist(HUB_STACK, stackId);

                if (self && (self.units.gt(0) || self.reapers.gt(0))) {
                    myTotalUnitsGlobal = myTotalUnitsGlobal.add(self.units);
                    myActiveStacks.push({ id: stackId, units: self.units, reapers: self.reapers, power: calcPower(self.units, self.reapers), dist });
                }
                const enemyPower = enemies.reduce((acc, e) => acc.add(calcPower(e.units, e.reapers)), ethers.BigNumber.from(0));
                if (SAFE_ZONE.includes(stackId) || (self && self.units.gt(0))) {
                    tacticalData.push({ ID: stackId, Dist: dist, EnemyPower: enemyPower.toString(), MyPower: self ? calcPower(self.units, self.reapers).toString() : "0", Status: (dist > HUB_PERIMETER && stackId !== HUB_STACK) ? "OUTSIDE" : (enemies.length > 0 ? "TARGET" : "OWNED") });
                }
                if (stackId === HUB_STACK) { hubState.self = self; hubState.enemies = enemies; }
                else if (PATROL_ZONE.includes(stackId) && enemies.length > 0) { validTargets.push({ id: stackId, target: enemies[0], dist }); }
            }

            console.table(tacticalData.sort((a,b) => a.Dist - b.Dist || a.ID - b.ID));

            const txOpt = { gasLimit: 1000000, gasPrice: ethers.utils.parseUnits("3", "gwei") };
            const lostArmy = myActiveStacks.find(s => s.dist > HUB_PERIMETER && s.id !== HUB_STACK);
            const battle = myActiveStacks.find(s => (s.id === HUB_STACK && hubState.enemies.length > 0) || validTargets.some(t => t.id === s.id));

            if (lostArmy) {
                let step = ALL_IDS.filter(id => isAdjacent(lostArmy.id, id) && SAFE_ZONE.includes(id)).sort((a,b) => getManhattanDist(a, HUB_STACK) - getManhattanDist(b, HUB_STACK))[0];
                console.log(`[RECOVERY] Returning to Safe ${step}`);
                await (await killGame.connect(wallet).move(lostArmy.id, step, lostArmy.units, lostArmy.reapers, txOpt)).wait();
            } else if (battle) {
                const target = (battle.id === HUB_STACK) ? hubState.enemies[0] : validTargets.find(t => t.id === battle.id).target;
                console.log(`[KILL] Liquidating target at Stack ${battle.id}`);
                await (await killGame.connect(wallet).kill(target.occupant, battle.id, battle.units.sub(1), battle.reapers, txOpt)).wait();
            } else if (myTotalUnitsGlobal.lt(ethers.BigNumber.from(TARGET_UNITS).sub(REPLENISH_AMT))) {
                console.log(`[SPAWN] Injecting ${REPLENISH_AMT} units to Hub...`);
                await (await killGame.connect(wallet).spawn(HUB_STACK, REPLENISH_AMT, txOpt)).wait();
            } else if (validTargets.length > 0) {
                const raid = validTargets.sort((a,b) => a.dist - b.dist)[0];
                const army = myActiveStacks.sort((a,b) => b.power.sub(a.power))[0];
                let step = ALL_IDS.filter(id => isAdjacent(army.id, id) && SAFE_ZONE.includes(id)).sort((a,b) => getManhattanDist(a, raid.id) - getManhattanDist(b, raid.id))[0];
                console.log(`[OFFENSE] Moving to ${step}`);
                await (await killGame.connect(wallet).move(army.id, step, army.units, army.reapers, txOpt)).wait();
            } else if (myActiveStacks.some(s => s.id !== HUB_STACK)) {
                // CONSOLIDATION: Move units back to Hub if no threats remain
                const army = myActiveStacks.find(s => s.id !== HUB_STACK);
                let step = ALL_IDS.filter(id => isAdjacent(army.id, id) && SAFE_ZONE.includes(id))
                    .sort((a,b) => getManhattanDist(a, HUB_STACK) - getManhattanDist(b, HUB_STACK))[0];
                console.log(`[CONSOLIDATE] ${army.id} -> ${step} (Returning to Hub)`);
                await (await killGame.connect(wallet).move(army.id, step, army.units, army.reapers, txOpt)).wait();
            }
        } catch (e) { console.error("[ERROR]:", e.message.substring(0, 100)); }
        await countdown(LOOP_DELAY_SECONDS);
    }
}
main();