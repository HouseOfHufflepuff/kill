const { ethers } = require("hardhat");

/**
 * KILL // Agent0: "The Whale Hunter"
 * Logic: Scan for Age -> Calculate Attrition -> Strike if Net-Positive -> Move to Hide.
 */
async function main() {
    // Contract Addresses
    const KILL_TOKEN_ADDR = process.env.KILL_TOKEN || "0x5FbDB2315678afecb367f032d93F642f64180aa3";
    const KILL_GAME_ADDR = process.env.KILL_GAME || "0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512";

    const KillToken = await ethers.getContractFactory("KILLToken");
    const killToken = await KillToken.attach(KILL_TOKEN_ADDR);

    const KillGame = await ethers.getContractFactory("KILLGame");
    const killGame = await KillGame.attach(KILL_GAME_ADDR);

    const [owner] = await ethers.getSigners();
    const address = await owner.getAddress();

    console.log(`--- AGENT0 INITIALIZED: ${address} ---`);
    console.log(`STATED ASSETS: ETH + 10M KILL`);

    // Tactical Constants from README
    const SCALE = 10000;
    const SPAWN_COST = ethers.utils.parseEther("10");
    const KILL_FEE = ethers.utils.parseEther("1");
    const MOVE_FEE = ethers.utils.parseEther("0.1");
    const ATTRITION_THRESHOLD = 5.0; // Aim for 5:1 ratio

    // 1. Initial Approval
    const allowance = await killToken.allowance(address, KILL_GAME_ADDR);
    if (allowance.lt(ethers.utils.parseEther("10000000"))) {
        console.log("[AGENT0] Increasing allowance for war chest...");
        await (await killToken.approve(KILL_GAME_ADDR, ethers.constants.MaxUint256)).wait(1);
    }

    while (true) {
        try {
            const currentBlock = await ethers.provider.getBlockNumber();
            const ccb = await killToken.balanceOf(KILL_GAME_ADDR); // Current Contract Balance

            console.log(`\n[BLOCK ${currentBlock}] Scanning for high-value targets...`);

            let bestTarget = null;
            let highestProfit = ethers.BigNumber.from(0);

            // 2. SCOUTING: Scan all 216 cubes (Simplified scan)
            for (let i = 1; i <= 216; i++) {
                const [occupants] = await killGame.getRipeStacks(i, false);
                
                for (let targetAddr of occupants) {
                    if (targetAddr === address || targetAddr === ethers.constants.AddressZero) continue;

                    // Fetch Target Stats
                    const targetU = await killGame.balanceOf(targetAddr, i);
                    const targetR = await killGame.balanceOf(targetAddr, i + 216);
                    const birthBlock = await killGame.getBirthBlock(targetAddr, i);
                    
                    if (targetU.add(targetR).eq(0)) continue;

                    // Calculate Accrued Bounty: Bounty = CCB * (Delta / 10000)
                    const delta = currentBlock - birthBlock.toNumber();
                    const potentialBounty = ccb.mul(delta).div(SCALE);

                    // Estimate Casualties (Inverse Square Law approximation)
                    // If we have 10M tokens, we can spawn a massive force
                    const myPower = ethers.utils.parseEther("500000"); // Standard attack force
                    const targetPower = targetU.add(targetR.mul(666)).mul(110).div(100); // +10% Defense
                    
                    const ratio = parseFloat(ethers.utils.formatEther(myPower)) / parseFloat(ethers.utils.formatEther(targetPower));
                    
                    // Loss calculation based on Force Ratio table
                    let lossRate = 0.50; // default 50%
                    if (ratio > 10) lossRate = 0.01;
                    else if (ratio > 5) lossRate = 0.15;
                    else if (ratio > 2) lossRate = 0.25;

                    const casualtyCost = SPAWN_COST.mul(myPower.div(ethers.utils.parseEther("1"))).mul(Math.floor(lossRate * 100)).div(100);
                    const netProfit = potentialBounty.mul(9334).div(10000).sub(casualtyCost).sub(KILL_FEE);

                    if (netProfit.gt(highestProfit)) {
                        highestProfit = netProfit;
                        bestTarget = { addr: targetAddr, stackId: i, u: targetU, r: targetR, profit: netProfit };
                    }
                }
            }

            // 3. EXECUTION PHASE
            if (bestTarget && highestProfit.gt(0)) {
                console.log(`[AGENT0] TARGET ACQUIRED: ${bestTarget.addr.substring(0,8)} at Stack ${bestTarget.stackId}`);
                console.log(`[AGENT0] ESTIMATED PROFIT: ${ethers.utils.formatEther(bestTarget.profit)} KILL`);

                // Spawn to ensure 10:1 dominance
                const targetPower = bestTarget.u.add(bestTarget.r.mul(666)).mul(110).div(100);
                const reqPower = targetPower.mul(10);
                
                console.log(`[AGENT0] Deploying force for 10:1 Overwhelming Advantage...`);
                await (await killGame.spawn(bestTarget.stackId, reqPower.div(ethers.utils.parseEther("10")), { gasLimit: 500000 })).wait(1);

                // Execute KILL
                console.log(`[AGENT0] Executing Meat-Grinder...`);
                const tx = await killGame.kill(bestTarget.addr, bestTarget.stackId, reqPower, 0, { gasLimit: 800000 });
                await tx.wait(1);
                console.log(`[AGENT0] Bounty Collected. P&L Optimized.`);
            } else {
                console.log(`[AGENT0] No profitable targets. Idling...`);
            }

            // 4. DEFENSIVE MOVE (The Defender's Dilemma)
            // If our own stack is too old (heat is high), move it to reset age.
            const myStacks = await killGame.getAgentStacks(address);
            for (let sId of myStacks) {
                const myBirth = await killGame.getBirthBlock(address, sId);
                if (currentBlock - myBirth.toNumber() > 5000) {
                    const newCube = Math.floor(Math.random() * 216) + 1;
                    console.log(`[AGENT0] Stack ${sId} is too "ripe" (${currentBlock - myBirth.toNumber()} blocks). Resetting heat via MOVE.`);
                    await (await killGame.move(sId, newCube, { gasLimit: 300000 })).wait(1);
                }
            }

        } catch (err) {
            console.error(`[AGENT0] TICK ERROR: ${err.message}`);
        }

        await new Promise(r => setTimeout(r, 1000)); // 1 Second Loop
    }
}

main().catch((error) => {
    console.error(error);
    process.exit(1);
});