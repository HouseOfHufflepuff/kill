const { ethers } = require("hardhat");
const fs = require("fs");
const path = require("path");
require("dotenv").config();

const YEL = "\x1b[33m";
const CYA = "\x1b[36m";
const PNK = "\x1b[35m";
const RES = "\x1b[0m";
const BRIGHT = "\x1b[1m";

function getCoords(id) {
    const v = id - 1;
    return { x: v % 6, y: Math.floor(v / 6) % 6, z: Math.floor(v / 36) };
}

function getId(x, y, z) {
    return (z * 36) + (y * 6) + x + 1;
}

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
            const balanceCalls = scanIds.map(id => killGame.interface.encodeFunctionData("balanceOf", [wallet.address, id]));
            const reaperCalls = scanIds.map(id => killGame.interface.encodeFunctionData("balanceOf", [wallet.address, id + 216]));
            const stackCalls = scanIds.map(id => killGame.interface.encodeFunctionData("getFullStack", [id]));
            
            // 648 calls batched
            const results = await killGame.callStatic.multicall([...balanceCalls, ...reaperCalls, ...stackCalls]);
            
            let myStrandedStacks = [];
            let targets = [];

            for (let i = 0; i < 216; i++) {
                const uBal = killGame.interface.decodeFunctionResult("balanceOf", results[i])[0];
                const rBal = killGame.interface.decodeFunctionResult("balanceOf", results[i + 216])[0];
                const stackId = i + 1;

                if ((uBal.gt(0) || rBal.gt(0)) && stackId !== HUB_STACK) {
                    myStrandedStacks.push({ id: stackId, units: uBal, reapers: rBal });
                }

                const items = killGame.interface.decodeFunctionResult("getFullStack", results[i + 432])[0];
                const enemies = items.filter(it => it.occupant.toLowerCase() !== wallet.address.toLowerCase() && it.units.gt(0));
                for (const e of enemies) {
                    const killValWei = e.units.mul(ethers.utils.parseEther("1")); 
                    let calcSpawn = e.units.mul(KILL_MULTIPLIER);
                    let finalSpawnAmt = calcSpawn.lt(MIN_SPAWN) ? ethers.BigNumber.from(MIN_SPAWN) : calcSpawn;
                    const costWei = finalSpawnAmt.mul(SPAWN_COST);
                    const ratio = parseFloat(killValWei.mul(1000).div(costWei).toString()) / 1000;
                    targets.push({ id: stackId, enemy: e, ratio, spawnAmt: finalSpawnAmt, killVal: killValWei });
                }
            }

            console.clear();
            
            // --- STRANDED UNITS TABLE ---
            if (myStrandedStacks.length > 0) {
                console.log(`${BRIGHT}${PNK}OUT-OF-HUB DETECTED (PRIORITY)${RES}`);
                console.log(`ID   | UNITS      | REAPERS    | DISTANCE`);
                console.log(`-----|------------|------------|---------`);
                myStrandedStacks.forEach(s => {
                    const path = getPath3D(s.id, HUB_STACK);
                    console.log(`${YEL}${s.id.toString().padEnd(4)}${RES}| ${s.units.toString().padEnd(10)} | ${s.reapers.toString().padEnd(10)} | ${path.length} hops`);
                });
                console.log("");
            }

            // --- TARGET TABLE ---
            console.log(`${BRIGHT}ID   | ENEMY      | UNITS | KILL VAL   | RATIO | ACTION${RES}`);
            console.log(`-----|------------|-------|------------|-------|-------`);
            targets.sort((a,b) => b.ratio - a.ratio).slice(0, 10).forEach(t => {
                const isPass = t.ratio >= SPAWN_PROFITABILITY_THRESHOLD;
                const killValStr = (parseFloat(ethers.utils.formatUnits(t.killVal, 18)) / 1000).toFixed(1) + "K";
                console.log(`${t.id.toString().padEnd(4)} | ${t.enemy.occupant.slice(0,10)} | ${t.enemy.units.toString().padEnd(5)} | ${killValStr.padEnd(10)} | ${t.ratio.toFixed(2)}x | ${isPass ? CYA + "READY" : "WAIT"}${RES}`);
            });

            const calls = [];

            // PRIORITY 1: RETREAT STRANDED
            if (myStrandedStacks.length > 0) {
                const targetStack = myStrandedStacks[0];
                console.log(`\n${YEL}[RETREAT] Moving Stack ${targetStack.id} to Hub ${HUB_STACK}${RES}`);
                const pathMoves = getPath3D(targetStack.id, HUB_STACK);
                pathMoves.forEach(step => {
                    calls.push(killGame.interface.encodeFunctionData("move", [step.from, step.to, targetStack.units, targetStack.reapers]));
                });
            } 
            // PRIORITY 2: SPAWN & KILL (Only if house is clean)
            else {
                const best = targets.sort((a, b) => b.ratio - a.ratio)[0];
                if (best && best.ratio >= SPAWN_PROFITABILITY_THRESHOLD) {
                    console.log(`\n${PNK}[ATTACK] Snipe Stack ${best.id} with ${best.spawnAmt} units${RES}`);
                    calls.push(killGame.interface.encodeFunctionData("spawn", [best.id, best.spawnAmt]));
                    calls.push(killGame.interface.encodeFunctionData("kill", [best.enemy.occupant, best.id, best.spawnAmt, 0]));
                }
            }

            if (calls.length > 0) {
                const tx = await killGame.connect(wallet).multicall(calls, { gasLimit: 5000000 });
                await tx.wait();
                console.log(`${CYA}[SUCCESS] Block sequence confirmed.${RES}`);
            } else {
                console.log(`\n${CYA}[IDLE] No profitable targets or stranded units found.${RES}`);
            }
        } catch (err) { console.error("\n[ERROR]", err.message); }
        await new Promise(r => setTimeout(r, LOOP_DELAY_SECONDS * 1000));
    }
}
main();