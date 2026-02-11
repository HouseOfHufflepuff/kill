const { ethers } = require("hardhat");

const KILL_GAME = process.env.KILL_GAME;

// hardhat run scripts/kill.js --network basesepolia
async function main() {
    const [owner] = await ethers.getSigners();
    const killGame = await (await ethers.getContractFactory("KILLGame")).attach(KILL_GAME);

    const target = "0xc0974aDf4d15DB9104eF68f01123d38a3a59bEc0";
    const cube = 1;

    const stdId = cube;
    const bstId = cube + 216;

    // 1. Fetch current balances
    const myStd = await killGame.balanceOf(owner.address, stdId);
    const myBst = await killGame.balanceOf(owner.address, bstId);

    // 2. SETUP ATTACK FORCE (Limited for iteration)
    // We send 1 Reaper if available, otherwise 0.
    const sentStd = ethers.BigNumber.from(0); 
    const sentBst = myBst.gt(0) ? ethers.BigNumber.from(1) : ethers.BigNumber.from(0);

    if (sentBst.eq(0) && sentStd.eq(0)) {
        console.log("❌ Error: You have no units in this cube to attack with.");
        return;
    }

    // 3. Calculate Powers (Mirroring Solidity)
    const atkPower = sentStd.add(sentBst.mul(666));
    
    let defStd = await killGame.balanceOf(target, stdId);
    let defBst = await killGame.balanceOf(target, bstId);

    // Self-attack logic check
    if (owner.address.toLowerCase() === target.toLowerCase()) {
        defStd = defStd.sub(sentStd);
        defBst = defBst.sub(sentBst);
    }

    const baseDefPower = defStd.add(defBst.mul(666));
    // Mirroring the contract's new fallback: if def is 0, it treats it as 1
    const defPower = baseDefPower.gt(0) ? baseDefPower.mul(110).div(100) : ethers.BigNumber.from(1);

    console.log(`\n--- Battle Simulation ---`);
    console.log(`Current Balance: ${myStd} Std, ${myBst} Bst`);
    console.log(`Sending Attack: ${sentStd} Std, ${sentBst} Bst`);
    console.log(`Attacker Power: ${atkPower.toString()}`);
    console.log(`Defender Power: ${defPower.toString()} (inc. 10% buff)`);

    if (atkPower.gt(defPower)) {
        console.log("✅ RESULT: VICTORY PREDICTED.");
    } else {
        console.log("⚠️ RESULT: DEFEAT/ATTRITION PREDICTED.");
    }

    // 4. Execution
    try {
        const tx = await killGame.kill(target, cube, sentStd, sentBst, { gasLimit: 1000000 });
        console.log("Transaction sent! Hash:", tx.hash);
        const receipt = await tx.wait();
        
        // Find Killed event
        const event = receipt.events?.find(e => e.event === 'Killed');
        if (event) {
            console.log("\n--- Real-time Losses ---");
            console.log(`Attacker Lost: ${event.args.attackerStdLost} Std, ${event.args.attackerBstLost} Bst`);
            console.log(`Target Lost: ${event.args.targetStdLost} Std, ${event.args.targetBstLost} Bst`);
        }
    } catch (e) {
        console.error("Attack failed:", e.reason || e.message);
    }
}

main().catch(console.error);