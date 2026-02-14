const { ethers } = require("hardhat");

const MULTICALL_ADDR = "0xcA11bde05977b3631167028862bE2a173976CA11";
const MULTICALL_ABI = ["function aggregate(tuple(address target, bytes callData)[] calls) public view returns (uint256 blockNumber, bytes[] returnData)"];

async function main() {
    const KILL_GAME_ADDR = process.env.KILL_GAME;
    const KILL_TOKEN_ADDR = process.env.KILL_TOKEN;
    
    const KillGame = await ethers.getContractFactory("KILLGame");
    const killGame = await KillGame.attach(KILL_GAME_ADDR);
    
    const KillToken = await ethers.getContractFactory("KILLToken");
    const killToken = await KillToken.attach(KILL_TOKEN_ADDR);

    const multicall = new ethers.Contract(MULTICALL_ADDR, MULTICALL_ABI, ethers.provider);
    const [owner] = await ethers.getSigners();
    const address = await owner.getAddress();

    console.log(`--- AGENT0 SWEEPER STARTING: ${address} ---`);

    while (true) {
        try {
            const currentBlock = await ethers.provider.getBlockNumber();
            const balance = await killToken.balanceOf(address);
            
            console.log(`\n[BLOCK ${currentBlock}] Pulse: ${ethers.utils.formatEther(balance)} KILL in wallet`);
            console.log(`[SCAN] Requesting data for 216 stacks...`);

            const calls = [];
            for (let i = 1; i <= 216; i++) {
                calls.push({
                    target: KILL_GAME_ADDR,
                    callData: killGame.interface.encodeFunctionData("getFullStack", [i])
                });
            }

            const [, returnData] = await multicall.aggregate(calls);
            
            let targets = [];
            let nearMisses = [];
            let occupiedStacksCount = 0;

            returnData.forEach((raw, index) => {
                const stackId = index + 1;
                const stackItems = killGame.interface.decodeFunctionResult("getFullStack", raw)[0];

                stackItems.forEach(item => {
                    // 1. Filter out self and dead air
                    if (item.occupant.toLowerCase() === address.toLowerCase()) return;
                    if (item.units.eq(0) && item.reapers.eq(0)) return;

                    occupiedStacksCount++;

                    // 2. Calculation logic
                    const bounty = item.pendingBounty.mul(9334).div(10000); // 6.66% tax
                    const estimatedGas = ethers.utils.parseEther("0.0005"); 
                    const netProfit = bounty.sub(estimatedGas);

                    const targetData = {
                        stackId,
                        occupant: item.occupant,
                        bounty: item.pendingBounty,
                        profit: netProfit,
                        units: item.units,
                        reapers: item.reapers
                    };

                    if (netProfit.gt(0)) {
                        targets.push(targetData);
                    } else {
                        nearMisses.push(targetData);
                    }
                });
            });

            console.log(`[REPORT] Found ${occupiedStacksCount} occupied stacks.`);

            if (targets.length > 0) {
                console.log(`[!!!] TARGETS FOUND: ${targets.length}`);
                for (const t of targets.slice(0, 3)) {
                    console.log(` >> KILL READY: Stack ${t.stackId} | Profit: ${ethers.utils.formatEther(t.profit)} KILL`);
                }
            } else {
                console.log("[REPORT] No profitable targets. Analyzing best opportunities:");
                if (nearMisses.length === 0) {
                    console.log(" -> Grid is currently a ghost town (0 other agents found).");
                } else {
                    nearMisses
                        .sort((a, b) => b.profit.sub(a.profit)) // Highest profit (least negative) first
                        .slice(0, 5)
                        .forEach(m => {
                            const gap = ethers.utils.formatEther(m.profit.mul(-1));
                            console.log(` -> Stack ${m.stackId} | Target: ${m.occupant.slice(0,8)} | Bounty: ${ethers.utils.formatEther(m.bounty)} | Need ${gap} more bounty to be viable.`);
                        });
                }
            }

        } catch (error) {
            console.error("[SYSTEM ERROR]:", error.message);
        }

        await new Promise(r => setTimeout(r, 10000));
    }
}

main();