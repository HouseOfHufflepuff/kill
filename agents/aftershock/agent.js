const { ethers } = require("hardhat");
const fs = require("fs");
const path = require("path");
const fetch = require("node-fetch");
require("dotenv").config();

const YEL = "\x1b[33m"; const CYA = "\x1b[36m"; const PNK = "\x1b[35m"; const RES = "\x1b[0m"; const BRIGHT = "\x1b[1m";

async function getRecentKills(url) {
    const query = `{
        killeds(orderBy: block_number, orderDirection: desc, first: 10) {
            id
            stackId
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

async function main() {
    if (!process.env.AFTERSHOCK_PK) throw new Error("Missing AFTERSHOCK_PK in .env");
    const wallet = new ethers.Wallet(process.env.AFTERSHOCK_PK, ethers.provider);
    
    const config = JSON.parse(fs.readFileSync(path.join(__dirname, "config.json"), "utf8"));
    const { LOOP_DELAY_SECONDS, SUBGRAPH_URL, KILL_MULTIPLIER, MIN_SPAWN, MAX_KILL } = config.settings;
    const { kill_game_addr } = config.network;
    
    const killGame = new ethers.Contract(kill_game_addr, JSON.parse(fs.readFileSync(path.join(__dirname, '../../data/abi/KILLGame.json'), 'utf8')).abi, wallet);
    const killToken = new ethers.Contract(await killGame.killToken(), ["function balanceOf(address) view returns (uint256)", "function allowance(address, address) view returns (uint256)", "function approve(address, uint256) returns (bool)"], wallet);
    
    let processedKills = new Set();
    let pendingAttacks = []; // Run A -> Run B memory
    let isFirstRun = true;

    console.log(`${BRIGHT}--- AFTERSHOCK AGENT ONLINE ---${RES}`);

    while (true) {
        try {
            const ethBal = await ethers.provider.getBalance(wallet.address);
            const killBal = await killToken.balanceOf(wallet.address);
            const killAllow = await killToken.allowance(wallet.address, kill_game_addr);

            // 1. EXECUTION PHASE (Handle pending attacks from previous run)
            if (pendingAttacks.length > 0) {
                const attack = pendingAttacks.shift();
                console.log(`\n${PNK}[RUN B: EXECUTION] Killing ${attack.target.slice(0,10)} on Stack ${attack.stackId}${RES}`);

                // Re-read stack live using same callStatic.multicall + decodeFunctionResult as sniper
                const stackCall = [killGame.interface.encodeFunctionData("getFullStack", [attack.stackId])];
                const stackResults = await killGame.callStatic.multicall(stackCall);
                const freshItems = killGame.interface.decodeFunctionResult("getFullStack", stackResults[0])[0];
                const targetData = freshItems.find(it => it.occupant.toLowerCase() === attack.target.toLowerCase());

                if (!targetData || targetData.units.eq(0)) {
                    console.log(`${YEL}[SKIP] Target no longer present on stack ${attack.stackId}.${RES}`);
                } else {
                    const effectivePower = targetData.units.add(targetData.reapers.mul(666));

                    if (effectivePower.gt(MAX_KILL)) {
                        console.log(`${YEL}[SKIP] Target too powerful: ${effectivePower.toString()} > MAX_KILL ${MAX_KILL}${RES}`);
                    } else {
                    let spawnAmt = effectivePower.mul(KILL_MULTIPLIER);
                    if (spawnAmt.lt(MIN_SPAWN)) spawnAmt = ethers.BigNumber.from(MIN_SPAWN);
                    const spawnReaper = spawnAmt.div(666);
                    const requiredCost = spawnAmt.mul(20);
                    const requiredCostWei = ethers.utils.parseEther(requiredCost.toString());

                    console.log(`${YEL}[LIVE] Units: ${targetData.units.toString()} | Reapers: ${targetData.reapers.toString()} | Effective: ${effectivePower.toString()} | Sending: ${spawnAmt.toString()} + ${spawnReaper.toString()} reaper | Cost: ${requiredCost.toString()} KILL${RES}`);

                    if (killAllow.lt(requiredCostWei)) {
                        console.log(`${YEL}[AUTH] Allowance too low. Approving MAX...${RES}`);
                        await (await killToken.approve(kill_game_addr, ethers.constants.MaxUint256)).wait();
                    }

                    if (killBal.lt(requiredCostWei)) {
                        console.log(`${YEL}[SKIP] Insufficient KILL balance. Need ${requiredCost.toString()} KILL, have ${Math.floor(parseFloat(ethers.utils.formatEther(killBal))).toString()} KILL${RES}`);
                    } else if (ethBal.gt(ethers.utils.parseEther("0.002"))) {
                        const calls = [
                            killGame.interface.encodeFunctionData("spawn", [attack.stackId, spawnAmt]),
                            killGame.interface.encodeFunctionData("kill", [attack.target, attack.stackId, spawnAmt, spawnReaper])
                        ];
                        try {
                            const tx = await killGame.connect(wallet).multicall(calls, { gasLimit: 2500000 });
                            console.log(`${CYA}>> [TX SENT]: ${tx.hash}${RES}`);
                            console.log(`${CYA}>> https://sepolia.basescan.org/tx/${tx.hash}${RES}`);
                            await tx.wait();
                            console.log(`${CYA}>> [TX CONFIRMED]${RES}`);
                        } catch (e) {
                            console.log(`${YEL}[TX REVERTED] Battle failed: ${e.message}${RES}`);
                        }
                    }
                    }
                }
            }

            // 2. DETECTION PHASE (Run A)
            const recentKills = await getRecentKills(SUBGRAPH_URL);
            
            if (isFirstRun) {
                recentKills.forEach(k => processedKills.add(k.id));
                console.log(`${YEL}[BASELINE] ${processedKills.size} kills recorded. Watching for new aftershocks...${RES}`);
                isFirstRun = false;
            } else {
                for (const k of recentKills) {
                    if (processedKills.has(k.id)) continue;

                    const stackId = parseInt(k.stackId);
                    const stackCall = [killGame.interface.encodeFunctionData("getFullStack", [stackId])];
                    const stackResults = await killGame.callStatic.multicall(stackCall);
                    const items = killGame.interface.decodeFunctionResult("getFullStack", stackResults[0])[0];

                    // Find the address that just won the last battle
                    const targetData = items.find(it => it.occupant.toLowerCase() === k.target.toLowerCase());

                    if (targetData && targetData.occupant.toLowerCase() !== wallet.address.toLowerCase()) {
                        const effectivePower = targetData.units.add(targetData.reapers.mul(666));

                        if (effectivePower.gt(MAX_KILL)) {
                            console.log(`${YEL}[SKIP] Stack ${stackId} too powerful: ${effectivePower.toString()} > MAX_KILL ${MAX_KILL}${RES}`);
                        } else {
                            let spawnAmt = effectivePower.mul(KILL_MULTIPLIER);
                            if (spawnAmt.lt(MIN_SPAWN)) spawnAmt = ethers.BigNumber.from(MIN_SPAWN);
                            const estCost = spawnAmt.mul(20);

                            console.log(`\n${BRIGHT}[RUN A: DETECTION] New Kill on Stack ${stackId}${RES}`);
                            console.log(`Target: ${targetData.occupant}`);
                            console.log(`Units: ${targetData.units.toString()} | Reapers: ${targetData.reapers.toString()} | Effective: ${effectivePower.toString()}`);
                            console.log(`Sending: ~${spawnAmt.toString()} (est) | Cost: ${estCost.toString()} KILL`);

                            pendingAttacks.push({ stackId, target: targetData.occupant });
                        }
                    }
                    processedKills.add(k.id);
                }
            }

            // 3. STATUS LOGGING
            console.log(`${BRIGHT}--- STATUS | ETH: ${ethers.utils.formatEther(ethBal).slice(0,6)} | KILL: ${(parseFloat(ethers.utils.formatEther(killBal))/1000).toFixed(1)}k | PENDING: ${pendingAttacks.length} ---${RES}`);

        } catch (err) { console.error("\n[ERROR]", err.message); }
        await new Promise(r => setTimeout(r, LOOP_DELAY_SECONDS * 1000));
    }
}
main();