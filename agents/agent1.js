const { ethers } = require("hardhat");

const MULTICALL_ADDR = "0xcA11bde05977b3631167028862bE2a173976CA11";
const MULTICALL_ABI = ["function aggregate(tuple(address target, bytes callData)[] calls) public view returns (uint256 blockNumber, bytes[] returnData)"];
const ERC20_ABI = ["function balanceOf(address account) view returns (uint256)", "function approve(address spender, uint256 amount) returns (bool)", "function allowance(address owner, address spender) view returns (uint256)"];

async function main() {
    const KILL_GAME_ADDR = process.env.KILL_GAME;
    const killGame = await ethers.getContractAt("KILLGame", KILL_GAME_ADDR);
    const agent1Wallet = new ethers.Wallet(process.env.AGENT1_PRIVATE_KEY, ethers.provider);
    const address = agent1Wallet.address;
    const multicall = new ethers.Contract(MULTICALL_ADDR, MULTICALL_ABI, ethers.provider);

    const REAPER_MULTIPLE = 666;
    const SPAWN_COST_PER_UNIT = await killGame.SPAWN_COST();
    const killToken = new ethers.Contract(await killGame.killToken(), ERC20_ABI, agent1Wallet);

    console.log(`\n--- AGENT1 WHALE PREDATOR: ${address} ---`);

    while (true) {
        try {
            // Fresh balance check at the start of every loop
            let killBalance = await killToken.balanceOf(address);
            let walletUnits = killBalance.div(SPAWN_COST_PER_UNIT);
            
            console.log(`\n[${new Date().toLocaleTimeString()}] SCANNING GRID...`);
            console.table([{ "KILL Balance": ethers.utils.formatEther(killBalance), "Unit Capacity": walletUnits.toString() }]);

            const calls = Array.from({ length: 216 }, (_, i) => ({
                target: KILL_GAME_ADDR,
                callData: killGame.interface.encodeFunctionData("getFullStack", [i + 1])
            }));

            const [, returnData] = await multicall.aggregate(calls);
            let candidates = [];

            for (let i = 0; i < returnData.length; i++) {
                const stackId = i + 1;
                const items = killGame.interface.decodeFunctionResult("getFullStack", returnData[i])[0];
                const enemies = items.filter(it => it.occupant.toLowerCase() !== address.toLowerCase() && it.units.gt(0));

                if (enemies.length > 0) {
                    const target = enemies[0];
                    const targetPower = target.units.add(target.reapers.mul(REAPER_MULTIPLE));
                    const requiredUnits = targetPower.mul(3); // The Threshold

                    candidates.push({
                        ID: stackId,
                        Target: target.occupant.slice(0, 10),
                        TPower: targetPower.toNumber(),
                        ReqUnits: requiredUnits, // BigNumber for math
                        Bounty: parseFloat(ethers.utils.formatEther(target.pendingBounty))
                    });
                }
            }

            if (candidates.length > 0) {
                // RESTORED TABLE: Analysis of top 5 targets
                console.table(candidates.sort((a, b) => b.Bounty - a.Bounty).slice(0, 5).map(c => ({
                    ...c, ReqUnits: c.ReqUnits.toString(), Bounty: c.Bounty.toFixed(2)
                })));

                // Pick the BEST target (Highest Bounty)
                const best = candidates.sort((a, b) => b.Bounty - a.Bounty)[0];
                const totalCost = best.ReqUnits.mul(SPAWN_COST_PER_UNIT);

                if (killBalance.gte(totalCost)) {
                    console.log(`[EXECUTION] Dropping Hammer on Stack ${best.ID} (Cost: ${ethers.utils.formatEther(totalCost)} KILL)`);
                    const tx = await killGame.connect(agent1Wallet).spawn(best.ID, best.ReqUnits, { gasLimit: 800000 });
                    await tx.wait();
                    console.log(`[SUCCESS] Stack ${best.ID} Overwhelmed.`);
                } else {
                    console.log(`[WAIT] Best target requires ${ethers.utils.formatEther(totalCost)} KILL. Insufficient funds.`);
                }
            }

        } catch (error) {
            console.error("[SYSTEM ERROR]:", error.message);
        }
        // Increased wait to allow block confirmations and balance updates
        await new Promise(r => setTimeout(r, 15000));
    }
}

main().catch(console.error);