const { ethers } = require("hardhat");
const fs = require("fs");
const path = require("path");
require("dotenv").config();

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

async function main() {
    if (!process.env.FORTRESS_PK) throw new Error("Missing FORTRESS_PK in .env");
    const wallet = new ethers.Wallet(process.env.FORTRESS_PK, ethers.provider);
    const address = wallet.address;
    console.log(`[AGENT] Running as: ${address}`);

    const config = JSON.parse(fs.readFileSync(path.join(__dirname, "config.json"), "utf8"));
    const { kill_game_addr, kill_faucet_addr } = config.network;
    const { HUB_STACK, TARGET_UNITS, REPLENISH_AMT, LOOP_DELAY_SECONDS, HUB_PERIMETER, MAX_GAS_PRICE_GWEI } = config.settings;

    const killGame = new ethers.Contract(kill_game_addr, JSON.parse(fs.readFileSync(path.join(__dirname, '../../data/abi/KILLGame.json'), 'utf8')).abi, wallet);
    const killTokenAddr = await killGame.killToken();
    const killToken = new ethers.Contract(killTokenAddr, ['function balanceOf(address) view returns (uint256)', 'function allowance(address, address) view returns (uint256)', 'function approve(address, uint256) returns (bool)'], wallet);

    const ALL_IDS = Array.from({length: 216}, (_, i) => i + 1);
    const SAFE_ZONE = ALL_IDS.filter(id => getManhattanDist(HUB_STACK, id) <= HUB_PERIMETER);

    console.log(`\n--- FORTRESS AGENT: ATOMIC LIQUIDATION MODE ---`);

    while (true) {
        try {
            const ethBal = await ethers.provider.getBalance(address);
            const killBal = await killToken.balanceOf(address);
            const allow = await killToken.allowance(address, kill_game_addr);

            const readCalls = ALL_IDS.map(id => killGame.interface.encodeFunctionData("getFullStack", [id]));
            const returnData = await killGame.callStatic.multicall(readCalls);

            let hubState = { self: null, enemies: [] };
            let validTargets = [];
            let myActiveStacks = [];
            let totalPowerGlobal = ethers.BigNumber.from(0);
            let tacticalData = [];

            for (let i = 0; i < returnData.length; i++) {
                const stackId = ALL_IDS[i];
                const items = killGame.interface.decodeFunctionResult("getFullStack", returnData[i])[0];
                const self = items.find(it => it.occupant.toLowerCase() === address.toLowerCase());
                const enemies = items.filter(it => it.occupant.toLowerCase() !== address.toLowerCase() && (it.units.gt(0) || it.reapers.gt(0)));
                const dist = getManhattanDist(HUB_STACK, stackId);

                if (self && (self.units.gt(0) || self.reapers.gt(0))) {
                    const stackPower = calcPower(self.units, self.reapers);
                    totalPowerGlobal = totalPowerGlobal.add(stackPower);
                    myActiveStacks.push({ id: stackId, units: self.units, reapers: self.reapers, power: stackPower, dist });
                    if (stackId === HUB_STACK) hubState.self = self;
                }

                if (SAFE_ZONE.includes(stackId)) {
                    const ep = enemies.reduce((acc, e) => acc.add(calcPower(e.units, e.reapers)), ethers.BigNumber.from(0));
                    const mp = self ? calcPower(self.units, self.reapers) : ethers.BigNumber.from(0);
                    
                    tacticalData.push({ 
                        ID: stackId, 
                        Dist: dist, 
                        EnemyPower: ep.toString(), 
                        MyPower: mp.toString(), 
                        Status: enemies.length > 0 ? "HOSTILE" : "SECURE" 
                    });
                    
                    if (enemies.length > 0) validTargets.push({ id: stackId, target: enemies[0], dist });
                }
                if (stackId === HUB_STACK) hubState.enemies = enemies;
            }

            console.log(`\n>> RESOURCE CHECK:`);
            console.table([{ 
                ETH: ethers.utils.formatEther(ethBal).substring(0, 6), 
                KILL: killBal.toString().substring(0, 10) + "...", 
                APPROVED: allow.gt(ethers.constants.MaxUint256.div(2)) ? "MAX" : "LOW" 
            }]);

            console.log(`>> TACTICAL VIEW (Perimeter Dist <= ${HUB_PERIMETER}):`);
            console.table(tacticalData.sort((a,b) => a.Dist - b.Dist || a.ID - b.ID));
            console.log(`GLOBAL POWER: ${totalPowerGlobal.toString()} / ${TARGET_UNITS}`);

            const txOpt = { gasLimit: 2000000, gasPrice: ethers.utils.parseUnits(MAX_GAS_PRICE_GWEI.toString(), "gwei") };
            let actionBatch = [];
            let logs = [];

            // 1. SPAWN
            if (totalPowerGlobal.lt(ethers.BigNumber.from(TARGET_UNITS))) {
                const spawnAmt = ethers.BigNumber.from(REPLENISH_AMT);
                actionBatch.push(killGame.interface.encodeFunctionData("spawn", [HUB_STACK, spawnAmt]));
                logs.push(`[SPAWN] ${REPLENISH_AMT} units -> Stack ${HUB_STACK}`);
            }

            // 2. COMBAT / MOVEMENT
            if (hubState.enemies.length > 0 && hubState.self) {
                actionBatch.push(killGame.interface.encodeFunctionData("kill", [hubState.enemies[0].occupant, HUB_STACK, hubState.self.units, hubState.self.reapers]));
                logs.push(`[KILL] Target ${hubState.enemies[0].occupant} on HUB`);
            } 
            else if (validTargets.length > 0 && myActiveStacks.length > 0) {
                const raid = validTargets.sort((a,b) => a.dist - b.dist)[0];
                const army = myActiveStacks.sort((a,b) => b.power.sub(a.power))[0];
                
                if (army.id === raid.id) {
                    actionBatch.push(killGame.interface.encodeFunctionData("kill", [raid.target.occupant, raid.id, army.units, army.reapers]));
                    logs.push(`[KILL] Target ${raid.target.occupant} on Stack ${raid.id}`);
                } else {
                    let step = ALL_IDS.filter(id => isAdjacent(army.id, id)).sort((a,b) => getManhattanDist(a, raid.id) - getManhattanDist(b, raid.id))[0];
                    actionBatch.push(killGame.interface.encodeFunctionData("move", [army.id, step, army.units, army.reapers]));
                    logs.push(`[MOVE] ${army.power} Power: Stack ${army.id} -> ${step} (Heading to ${raid.id})`);
                }
            }
            else if (myActiveStacks.some(s => s.id !== HUB_STACK)) {
                const army = myActiveStacks.find(s => s.id !== HUB_STACK);
                let step = ALL_IDS.filter(id => isAdjacent(army.id, id)).sort((a,b) => getManhattanDist(a, HUB_STACK) - getManhattanDist(b, HUB_STACK))[0];
                actionBatch.push(killGame.interface.encodeFunctionData("move", [army.id, step, army.units, army.reapers]));
                logs.push(`[RETREAT] Stack ${army.id} -> ${step} (Returning to HUB)`);
            }

            if (actionBatch.length > 0) {
                logs.forEach(msg => console.log(msg));
                const tx = await killGame.multicall(actionBatch, txOpt);
                console.log(`>> [TX SENT]: ${tx.hash}`);
                await tx.wait();
            }

        } catch (e) { console.error("[ERROR]:", e.reason || e.message); }
        await countdown(LOOP_DELAY_SECONDS);
    }
}
main();