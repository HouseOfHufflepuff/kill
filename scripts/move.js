const { ethers } = require("hardhat");

const KILL_GAME = process.env.KILL_GAME;
const PUBLIC_KEY = process.env.PUBLIC_KEY;


//hardhat run scripts/move.js --network basesepolia
//hardhat run scripts/move.js --network base
async function main() {
    const [owner] = await ethers.getSigners();
    console.log("Using Wallet:", owner.address);

    const KillGame = await ethers.getContractFactory("KILLGame");
    const killGame = await KillGame.attach(KILL_GAME);

    // Configuration
    const fromCube = 1;
    const toCube = 2;

    // In your contract: 
    // ID = Cube (Standard)
    // ID = Cube + 216 (Boosted)
    const stdId = fromCube;
    const bstId = fromCube + 216;
    
    console.log("\n--- Checking ERC1155 Balances ---");

    // Using the standard ERC1155 balanceOf function
    const stdBalance = await killGame.balanceOf(owner.address, stdId);
    const bstBalance = await killGame.balanceOf(owner.address, bstId);

    console.log(`Cube ${fromCube} Contents:`);
    console.log(` - Standard Units (ID ${stdId}): ${stdBalance.toString()}`);
    console.log(` - Boosted Units (ID ${bstId}): ${bstBalance.toString()}`);

    if (stdBalance.eq(0) && bstBalance.eq(0)) {
        console.log("❌ Error: No units found in source cube!");
        return;
    }

    console.log("\n--- Execution ---");
    console.log(`Moving units to Cube ${toCube}...`);

    try {
        // move(uint16 fromCube, uint16 toCube, uint256 stdUnits, uint256 bstUnits)
        const moveTx = await killGame.move(
            fromCube, 
            toCube, 
            stdBalance, 
            bstBalance, 
            {
                gasLimit: 500000 
            }
        );

        console.log("Transaction broadcast! Hash:", moveTx.hash);
        const receipt = await moveTx.wait(1);
        
        console.log("------------------------------------------");
        console.log("SUCCESS: Move completed.");
        console.log("Block:", receipt.blockNumber);
        console.log("------------------------------------------");

        // Verification using standard ERC1155 balanceOf
        const finalStd = await killGame.balanceOf(owner.address, toCube);
        const finalBst = await killGame.balanceOf(owner.address, toCube + 216);
        console.log(`Cube ${toCube} Final: ${finalStd.toString()} Std, ${finalBst.toString()} Bst`);

    } catch (error) {
        console.error("\nMove failed!");
        // Your contract has specific require messages like "Bad move" (not adjacent)
        console.error(error.reason || error.message || error);
    }
}

main()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error(error);
        process.exit(1);
    });