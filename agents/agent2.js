const { ethers } = require("hardhat");

const MULTICALL_ADDR = "0xcA11bde05977b3631167028862bE2a173976CA11";
const MULTICALL_ABI = ["function aggregate(tuple(address target, bytes callData)[] calls) public view returns (uint256 blockNumber, bytes[] returnData)"];
const ERC20_ABI = ["function balanceOf(address account) view returns (uint256)", "function approve(address spender, uint256 amount) returns (bool)"];

async function main() {
    const KILL_GAME_ADDR = process.env.KILL_GAME;
    const killGame = await ethers.getContractAt("KILLGame", KILL_GAME_ADDR);
    const agent2Wallet = new ethers.Wallet(process.env.AGENT2_PRIVATE_KEY, ethers.provider);
    const address = agent2Wallet.address;
    const multicall = new ethers.Contract(MULTICALL_ADDR, MULTICALL_ABI, ethers.provider);

    const REAPER_MULTIPLE = 666;
    const SPAWN_COST_PER_UNIT = await killGame.SPAWN_COST();
    const killToken = new ethers.Contract(await killGame.killToken(), ERC20_ABI, agent2Wallet);

    // Sniper Constants
    const MIN_SPAWN_UNITS = ethers.BigNumber.from(1000); // Prevent "Dusting" reverts
    const POWER_MULTIPLIER = 25; // 2.5x (Safe margin for defender bonus)

    console.log(`\n--- AGENT2 ROI BOUNTY SNIPER: ${address} ---`);

    while (true) {
        try {
            let killBalance = await killToken.balanceOf(address);
            
            console.log(`\n[${new Date().toLocaleTimeString()}] SCANNING FOR PROFIT...`);
            console.table([{ "KILL Balance": ethers.utils.formatEther(killBalance), "Min Snipe Cost": "10,000 KILL" }]);

            const calls = Array.from({ length: 216 }, (_, i) => ({
                target: KILL_GAME_ADDR,
                callData: killGame.interface.encodeFunctionData("getFullStack", [i + 1])
            }));

            const [, returnData] = await multicall.aggregate(calls);
            let opportunities = [];

            for (let i = 0; i < returnData.length; i++) {
                const stackId = i + 1;
                const items = killGame.interface.decodeFunctionResult("getFullStack", returnData[i])[0];
                
                const enemies = items.filter(it => it.occupant.toLowerCase() !== address.toLowerCase() && it.units.gt(0));
                const alreadyPresent = items.find(it => it.occupant.toLowerCase() === address.toLowerCase());

                if (enemies.length > 0 && !alreadyPresent) {
                    const target = enemies[0];
                    const targetPower = target.units.add(target.reapers.mul(REAPER_MULTIPLE));
                    
                    // Calculate required units (2.5x target)
                    let reqUnits = targetPower.mul(POWER_MULTIPLIER).div(10);
                    if (reqUnits.lt(MIN_SPAWN_UNITS)) reqUnits = MIN_SPAWN_UNITS;

                    const costInKill = reqUnits.mul(SPAWN_COST_PER_UNIT);
                    const netBounty = target.pendingBounty.mul(93).div(100); 
                    
                    if (netBounty.gt(costInKill)) {
                        const profit = netBounty.sub(costInKill);
                        const roiPercent = (parseFloat(ethers.utils.formatEther(profit)) / parseFloat(ethers.utils.formatEther(costInKill))) * 100;

                        opportunities.push({
                            ID: stackId,
                            Target: target.occupant.slice(0, 10),
                            Cost: parseFloat(ethers.utils.formatEther(costInKill)).toFixed(2),
                            Bounty: parseFloat(ethers.utils.formatEther(netBounty)).toFixed(2),
                            ROI: roiPercent.toFixed(1) + "%",
                            RawROI: roiPercent,
                            ReqUnits: reqUnits
                        });
                    }
                }
            }

            if (opportunities.length > 0) {
                const sortedOps = opportunities.sort((a, b) => b.RawROI - a.RawROI);
                console.table(sortedOps.slice(0, 5).map(({RawROI, ReqUnits, ...rest}) => rest));

                const best = sortedOps[0];
                if (killBalance.gte(best.ReqUnits.mul(SPAWN_COST_PER_UNIT))) {
                    console.log(`[SNIPE] Attacking Stack ${best.ID} for ${best.ROI} ROI...`);
                    const tx = await killGame.connect(agent2Wallet).spawn(best.ID, best.ReqUnits, { gasLimit: 800000 });
                    await tx.wait();
                    console.log(`[SUCCESS] Sniper pocketed ${best.Bounty} KILL.`);
                }
            } else {
                console.log(`[SCAN] No ROI > 100% found. Scouting...`);
            }

        } catch (error) {
            console.error("[AGENT2 ERROR]:", error.message);
        }
        await new Promise(r => setTimeout(r, 15000));
    }
}

main().catch(console.error);