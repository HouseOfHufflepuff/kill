const { ethers } = require("hardhat");

const MULTICALL_ADDR = "0xcA11bde05977b3631167028862bE2a173976CA11";
const MULTICALL_ABI = ["function aggregate(tuple(address target, bytes callData)[] calls) public view returns (uint256 blockNumber, bytes[] returnData)"];
const ERC20_ABI = ["function balanceOf(address account) view returns (uint256)", "function approve(address spender, uint256 amount) returns (bool)", "function allowance(address owner, address spender) view returns (uint256)"];

async function main() {
    const KILL_GAME_ADDR = process.env.KILL_GAME;
    const killGame = await ethers.getContractAt("KILLGame", KILL_GAME_ADDR);
    const agent2Wallet = new ethers.Wallet(process.env.AGENT2_PRIVATE_KEY, ethers.provider);
    const address = agent2Wallet.address;
    const multicall = new ethers.Contract(MULTICALL_ADDR, MULTICALL_ABI, ethers.provider);

    const REAPER_MULTIPLE = 666;
    const SPAWN_COST_PER_UNIT = await killGame.SPAWN_COST();
    const killToken = new ethers.Contract(await killGame.killToken(), ERC20_ABI, agent2Wallet);

    console.log(`\n--- AGENT2 ROI BOUNTY SNIPER: ${address} ---`);

    // Setup Approval
    const allowance = await killToken.allowance(address, KILL_GAME_ADDR);
    if (allowance.lt(ethers.utils.parseEther("1000000"))) {
        await (await killToken.approve(KILL_GAME_ADDR, ethers.constants.MaxUint256)).wait();
    }

    while (true) {
        try {
            let killBalance = await killToken.balanceOf(address);
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
                
                if (enemies.length > 0) {
                    const target = enemies[0];
                    const targetPower = target.units.add(target.reapers.mul(REAPER_MULTIPLE));
                    const reqUnits = targetPower.mul(3); // 3x for guaranteed victory
                    const costInKill = reqUnits.mul(SPAWN_COST_PER_UNIT);
                    const netBounty = target.pendingBounty.mul(93).div(100);
                    
                    if (netBounty.gt(costInKill)) {
                        opportunities.push({
                            ID: stackId,
                            TargetAddr: target.occupant,
                            TargetDisplay: target.occupant.slice(0, 10),
                            Cost: parseFloat(ethers.utils.formatEther(costInKill)).toFixed(2),
                            Bounty: parseFloat(ethers.utils.formatEther(netBounty)).toFixed(2),
                            RawROI: (parseFloat(ethers.utils.formatEther(netBounty)) / parseFloat(ethers.utils.formatEther(costInKill))),
                            ReqUnits: reqUnits
                        });
                    }
                }
            }

            if (opportunities.length > 0) {
                const best = opportunities.sort((a, b) => b.RawROI - a.RawROI)[0];
                const totalCost = best.ReqUnits.mul(SPAWN_COST_PER_UNIT);

                if (killBalance.gte(totalCost)) {
                    console.log(`\n[ATTACK] Stack ${best.ID} | Target: ${best.TargetDisplay}`);
                    
                    // 1. SPAWN
                    console.log(`   -> Spawning ${best.ReqUnits.toString()} units...`);
                    const spawnTx = await killGame.connect(agent2Wallet).spawn(best.ID, best.ReqUnits, { gasLimit: 500000 });
                    await spawnTx.wait();

                    // 2. KILL (The missing step)
                    console.log(`   -> Executing Kill on ${best.TargetDisplay}...`);
                    const killTx = await killGame.connect(agent2Wallet).kill(
                        best.TargetAddr, 
                        best.ID, 
                        best.ReqUnits.sub(1), // Use all but 1 unit to attack
                        0,                    // 0 reapers for now
                        { gasLimit: 800000 }
                    );
                    await killTx.wait();
                    
                    console.log(`[SUCCESS] Bounty Collected!`);
                }
            }

            console.table([{ 
                Balance: ethers.utils.formatEther(await killToken.balanceOf(address)),
                TargetsFound: opportunities.length 
            }]);

        } catch (error) {
            console.error("[AGENT2 ERROR]:", error.message);
        }
        await new Promise(r => setTimeout(r, 12000));
    }
}

main().catch(console.error);