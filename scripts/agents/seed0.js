const { ethers } = require("hardhat");

const KILL_TOKEN = process.env.KILL_TOKEN;
const KILL_GAME = process.env.KILL_GAME;

async function main() {
    const [owner] = await ethers.getSigners();
    console.log("Using Wallet:", owner.address);

    const KillToken = await ethers.getContractFactory("KILLToken");
    const killToken = await KillToken.attach(KILL_TOKEN);

    const KillGame = await ethers.getContractFactory("KILLGame");
    const killGame = await KillGame.attach(KILL_GAME);

    const unitsToSpawn = 666;
    const costPerUnit = ethers.utils.parseUnits("10", 18);
    const totalCost = costPerUnit.mul(unitsToSpawn);

    while (true) {
        try {
            console.log("\n--- Pre-flight Checks ---");
            
            // 1. Check Balance
            const balance = await killToken.balanceOf(owner.address);
            if (balance.lt(totalCost)) {
                console.log("Minting required tokens...");
                await (await killToken.mint(owner.address, totalCost)).wait(1);
            }

            // 2. Handle Allowance
            const currentAllowance = await killToken.allowance(owner.address, KILL_GAME);
            if (currentAllowance.lt(totalCost)) {
                console.log("Approving KILLGame contract...");
                await (await killToken.approve(KILL_GAME, ethers.constants.MaxUint256)).wait(2);
            }

            // 3. Final Execution
            const cubeId = Math.floor(Math.random() * 216) + 1;
            console.log(`Spawning ${unitsToSpawn} units in Cube ${cubeId}...`);

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
            console.error(error.reason || error);
        }

        console.log("Waiting 2 seconds...");
        await new Promise(r => setTimeout(r, 2000));
    }
}

main().catch((error) => {
    console.error(error);
    process.exit(1);
});