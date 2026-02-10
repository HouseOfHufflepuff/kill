const { ethers } = require("hardhat");

const KILL_GAME = process.env.KILL_GAME;

async function main() {
    const [attacker] = await ethers.getSigners();
    const KillGame = await ethers.getContractFactory("KILLGame");
    const killGame = await KillGame.attach(KILL_GAME);

    // TARGET DATA
    const targetAddress = "0xc0974aDf4d15DB9104eF68f01123d38a3a59bEc0"; // Your wallet
    const activeCube = 2; // Where the units currently reside

    // ID Definitions based on your contract: Std = ID, Bst = ID + 216
    const stdId = activeCube;
    const bstId = activeCube + 216;

    console.log(`\n--- Battle Prep: Local Combat in Cube ${activeCube} ---`);

    // 1. Check YOUR units in Cube 2
    const myStd = await killGame.balanceOf(attacker.address, stdId);
    const myBst = await killGame.balanceOf(attacker.address, bstId);

    // 2. Check TARGET units in Cube 2
    const tarStd = await killGame.balanceOf(targetAddress, stdId);
    const tarBst = await killGame.balanceOf(targetAddress, bstId);

    // 3. Check Pending Bounty (Treasury Payout)
    const pendingBounty = await killGame.getPendingBounty(targetAddress, bstId);

    console.log(`Attacker Force (Cube ${activeCube}): ${myStd} Std, ${myBst} Bst`);
    console.log(`Target Force (Cube ${activeCube}): ${tarStd} Std, ${tarBst} Bst`);
    console.log(`Potential Bounty: ${ethers.utils.formatUnits(pendingBounty, 18)} KILL`);

    if (myStd.eq(0) && myBst.eq(0)) {
        console.log("❌ Error: You still have no units in Cube 2. Check your balance on BaseScan.");
        return;
    }

    // 4. Execution - Sending all your local Reapers
    const sentStd = 0;
    const sentBst = myBst; 

    console.log(`\nInitiating combat with ${sentBst} Reaper(s) against target...`);

    try {
        // kill(address target, uint16 cube, uint256 sentStd, uint256 sentBst)
        const killTx = await killGame.kill(
            targetAddress,
            activeCube,
            sentStd,
            sentBst,
            { gasLimit: 1200000 } // Quadratic attrition + bounty transfers require significant gas
        );

        console.log("Attack Transaction sent! Hash:", killTx.hash);
        const receipt = await killTx.wait(1);

        // Find the Killed event
        const event = receipt.events?.find(e => e.event === 'Killed');
        if (event) {
            const [atk, trg, cb, aStdL, aBstL, tStdL, tBstL, bounty] = event.args;
            console.log("------------------------------------------");
            console.log("BATTLE RESULTS:");
            console.log(`Attacker Lost: ${aStdL} Std, ${aBstL} Bst`);
            console.log(`Target Lost: ${tStdL} Std, ${tBstL} Bst`);
            console.log(`Bounty Claimed: ${ethers.utils.formatUnits(bounty, 18)} KILL`);
            console.log("------------------------------------------");
        }

    } catch (error) {
        console.error("\nCombat failed!");
        console.error(error.reason || error.message);
    }
}

main().catch((error) => {
    console.error(error);
    process.exit(1);
});