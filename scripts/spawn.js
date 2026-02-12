const { ethers } = require("hardhat");

const KILL_TOKEN = process.env.KILL_TOKEN;
const KILL_GAME = process.env.KILL_GAME;
const PUBLIC_KEY = process.env.PUBLIC_KEY;

//hardhat run scripts/spawn.js --network base
//hardhat run scripts/spawn.js --network basesepolia
async function main() {
    const [owner] = await ethers.getSigners();
    console.log("Using Wallet:", owner.address);

    const KillToken = await ethers.getContractFactory("KILLToken");
    const killToken = await KillToken.attach(KILL_TOKEN);

    const KillGame = await ethers.getContractFactory("KILLGame");
    const killGame = await KillGame.attach(KILL_GAME);

    const unitsToSpawn = 1332;
    const costPerUnit = ethers.utils.parseUnits("10", 18);
    const totalCost = costPerUnit.mul(unitsToSpawn);

    console.log("\n--- Pre-flight Checks ---");
    
    // 1. Check Balance
    const balance = await killToken.balanceOf(owner.address);
    if (balance.lt(totalCost)) {
        console.log(`Insufficient balance. Have: ${ethers.utils.formatUnits(balance, 18)}, Need: ${ethers.utils.formatUnits(totalCost, 18)}`);
        console.log("Minting required tokens...");
        const mintTx = await killToken.mint(owner.address, totalCost);
        await mintTx.wait(1);
    } else {
        console.log("Balance check passed.");
    }

    // 2. Handle Allowance
    const currentAllowance = await killToken.allowance(owner.address, KILL_GAME);
    if (currentAllowance.lt(totalCost)) {
        console.log("Approving KILLGame contract...");
        const approveTx = await killToken.approve(KILL_GAME, totalCost);
        console.log("Waiting for approval to be indexed (2 confirmations)...");
        await approveTx.wait(2); // Waiting 2 blocks ensures L2 state consistency
    } else {
        console.log("Allowance already sufficient.");
    }

    // 3. Final Execution
    console.log("\n--- Execution ---");
    const cubeId = 210;
    console.log(`Spawning ${unitsToSpawn} units in Cube ${cubeId}...`);

    try {
        // We use a manual gasLimit to bypass the 'estimateGas' failure
        // 500k is plenty for a spawn tx
        const spawnTx = await killGame.spawn(cubeId, unitsToSpawn, {
            gasLimit: 500000 
        });

        console.log("Transaction sent! Hash:", spawnTx.hash);
        const receipt = await spawnTx.wait();
        
        console.log("------------------------------------------");
        console.log("SUCCESS: Reaper units spawned.");
        console.log("Block Number:", receipt.blockNumber);
        console.log("------------------------------------------");

    } catch (error) {
        console.error("\nSpawn failed!");
        if (error.data) {
            console.error("Error Data:", error.data);
        } else {
            console.error(error);
        }
    }
}

main()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error(error);
        process.exit(1);
    });