const { ethers } = require("hardhat");

const MULTICALL_ADDR = "0xcA11bde05977b3631167028862bE2a173976CA11";
const MULTICALL_ABI = ["function aggregate(tuple(address target, bytes callData)[] calls) public view returns (uint256 blockNumber, bytes[] returnData)"];

async function main() {
    const KILL_GAME_ADDR = process.env.KILL_GAME;
    const killGame = await ethers.getContractAt("KILLGame", KILL_GAME_ADDR);
    const agent1Wallet = new ethers.Wallet(process.env.AGENT1_PRIVATE_KEY, ethers.provider);
    const address = agent1Wallet.address;
    const multicall = new ethers.Contract(MULTICALL_ADDR, MULTICALL_ABI, ethers.provider);

    const REAPER_MULTIPLE = 666;

    console.log(`--- AGENT1 WHALE PREDATOR: ${address} ---`);

    while (true) {
        try {
            console.log(`\n[${new Date().toLocaleTimeString()}] --- SCANNING ALL STACKS ---`);
            
            const calls = Array.from({ length: 216 }, (_, i) => ({
                target: KILL_GAME_ADDR,
                callData: killGame.interface.encodeFunctionData("getFullStack", [i + 1])
            }));

            const [, returnData] = await multicall.aggregate(calls);
            
            let allOpportunities = [];
            let activeEngagements = [];

            for (let i = 0; i < returnData.length; i++) {
                const stackId = i + 1;
                const items = killGame.interface.decodeFunctionResult("getFullStack", returnData[i])[0];
                
                const self = items.find(it => it.occupant.toLowerCase() === address.toLowerCase());
                const enemies = items.filter(it => it.occupant.toLowerCase() !== address.toLowerCase() && it.units.gt(0));

                // Process unique enemies on this stack
                if (enemies.length > 0) {
                    const target = enemies[0]; // Primary target on stack
                    const myUnits = self ? self.units : ethers.BigNumber.from(0);
                    const myReapers = self ? self.reapers : ethers.BigNumber.from(0);
                    const targetUnits = target.units;
                    const targetReapers = target.reapers || ethers.BigNumber.from(0);
                    const targetBounty = parseFloat(ethers.utils.formatEther(target.pendingBounty));
                    
                    const myPower = myUnits.add(myReapers.mul(REAPER_MULTIPLE));
                    const targetPower = targetUnits.add(targetReapers.mul(REAPER_MULTIPLE));

                    // ACTIVE ENGAGEMENT (We are already on the stack)
                    if (myPower.gt(0)) {
                        activeEngagements.push({
                            stackId,
                            target: target.occupant.slice(0, 8),
                            targetAddr: target.occupant,
                            myU: myUnits.toNumber(),
                            myR: myReapers.toNumber(),
                            targetU: targetUnits.toNumber(),
                            targetR: targetReapers.toNumber(),
                            myP: myPower.toNumber(),
                            targetP: targetPower.toNumber(),
                            canKill: myPower.gt(targetPower.mul(2))
                        });
                    }

                    // OPPORTUNITY CALCULATION (Whale Logic: Spend max bounty for max power)
                    const netBounty = targetBounty * 0.9334;
                    // We spend as much of the netBounty as possible in 666 increments
                    const multiples = Math.floor(netBounty / REAPER_MULTIPLE);
                    const spawnAmount = multiples * REAPER_MULTIPLE;
                    
                    // Only consider if we can at least match 3x target power within the bounty budget
                    const potentialPower = ethers.BigNumber.from(spawnAmount).add(ethers.BigNumber.from(multiples).mul(REAPER_MULTIPLE));
                    const isProfitable = spawnAmount > 0 && potentialPower.gt(targetPower.mul(3));

                    if (isProfitable && !self) {
                        allOpportunities.push({
                            stackId,
                            target: target.occupant.slice(0, 8),
                            targetAddr: target.occupant,
                            bounty: targetBounty.toFixed(2),
                            spawnCost: spawnAmount,
                            profit: (netBounty - spawnAmount).toFixed(2),
                            reapers: multiples
                        });
                    }
                }
            }

            // --- DISPLAY AND EXECUTE KILLS ---
            if (activeEngagements.length > 0) {
                console.log(">> ACTIVE ENGAGEMENTS:");
                console.table(activeEngagements.map(({targetAddr, ...rest}) => rest));
                
                for (const eng of activeEngagements.filter(e => e.canKill)) {
                    console.log(`[EXECUTION] All-In Attack Stack ${eng.stackId}...`);
                    await (await killGame.connect(agent1Wallet).kill(eng.targetAddr, eng.stackId, eng.myU > 0 ? eng.myU - 1 : 0, eng.myR, { gasLimit: 1200000 })).wait();
                }
            }

            // --- DISPLAY AND EXECUTE PROFITABLE SPAWNS ---
            if (allOpportunities.length > 0) {
                console.log(">> PROFITABLE WHALE OPPORTUNITIES:");
                const sortedOps = allOpportunities.sort((a, b) => b.profit - a.profit);
                console.table(sortedOps.map(({targetAddr, ...rest}) => rest));

                for (const op of sortedOps) {
                    console.log(`[WHALE SPAWN] Dropping ${op.spawnCost} units (${op.reapers} Reapers) on Stack ${op.stackId}`);
                    await (await killGame.connect(agent1Wallet).spawn(op.stackId, op.spawnCost, { gasLimit: 600000 })).wait();
                }
            } else {
                console.log("[WAIT] No profitable stacks justify a Whale Spawn currently.");
            }

        } catch (error) {
            console.error("[SYSTEM ERROR]:", error.message);
        }
        await new Promise(r => setTimeout(r, 10000));
    }
}

main().catch(console.error);