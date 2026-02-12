const { ethers } = require("hardhat");

const KILL_GAME = process.env.KILL_GAME;

// hardhat run scripts/kill.js --network basesepolia
async function main() {
    const [owner] = await ethers.getSigners();
    
    // Attach to the contract
    const killGame = await ethers.getContractAt("KILLGame", KILL_GAME);

    const target = "0xc0974aDf4d15DB9104eF68f01123d38a3a59bEc0";
    const stackId = 1; 

    const stdId = BigInt(stackId);
    const bstId = BigInt(stackId) + 216n;

    // 1. Fetch current balances and explicitly cast to BigInt
    const myStd = BigInt(await killGame.balanceOf(owner.address, stdId));
    const myBst = BigInt(await killGame.balanceOf(owner.address, bstId));

    // 2. SETUP ATTACK FORCE
    const sentStd = 0n; 
    const sentBst = myBst > 0n ? 1n : 0n;

    if (sentBst === 0n && sentStd === 0n) {
        console.log("❌ Error: You have no units on this stack to attack with.");
        return;
    }

    // 3. Calculate Powers (Mirroring Solidity)
    const atkPower = sentStd + (sentBst * 666n);
    
    let defStd = BigInt(await killGame.balanceOf(target, stdId));
    let defBst = BigInt(await killGame.balanceOf(target, bstId));

    // Self-attack logic check
    if (owner.address.toLowerCase() === target.toLowerCase()) {
        defStd = defStd - sentStd;
        defBst = defBst - sentBst;
    }

    const baseDefPower = defStd + (defBst * 666n);
    
    // Fallback: if def is 0, it treats it as 1
    const defPower = baseDefPower > 0n ? (baseDefPower * 110n) / 100n : 1n;

    console.log(`\n--- Battle Simulation ---`);
    console.log(`Current Balance: ${myStd.toString()} Std, ${myBst.toString()} Bst`);
    console.log(`Sending Attack: ${sentStd.toString()} Std, ${sentBst.toString()} Bst`);
    console.log(`Attacker Power: ${atkPower.toString()}`);
    console.log(`Defender Power: ${defPower.toString()} (inc. 10% buff)`);

    if (atkPower > defPower) {
        console.log("✅ RESULT: VICTORY PREDICTED.");
    } else {
        console.log("⚠️ RESULT: DEFEAT/ATTRITION PREDICTED.");
    }

    // 4. Execution
    try {
        // Passing the values to the contract. Ethers v6 handles BigInt automatically here.
        const tx = await killGame.kill(target, stackId, sentStd, sentBst);
        console.log("Transaction sent! Hash:", tx.hash);
        
        const receipt = await tx.wait();
        
        // Find Killed event in Ethers v6
        const killedEvent = receipt.logs
            .map((log) => {
                try { return killGame.interface.parseLog(log); } catch (e) { return null; }
            })
            .find((event) => event && event.name === 'Killed');

        if (killedEvent) {
            const args = killedEvent.args;
            console.log("\n--- Real-time Losses ---");
            // Mapping to your Solidity event: 
            // attackerUnitsLost, attackerReaperLost, targetUnitsLost, targetReaperLost
            console.log(`Attacker Lost: ${args.attackerUnitsLost.toString()} Std, ${args.attackerReaperLost.toString()} Bst`);
            console.log(`Target Lost: ${args.targetUnitsLost.toString()} Std, ${args.targetReaperLost.toString()} Bst`);
            
            if (args.netBounty > 0n) {
                console.log(`Net Bounty: ${ethers.formatEther(args.netBounty)} KILL`);
            }
        } else {
            console.log("\n⚠️ Transaction succeeded but 'Killed' event not found.");
        }
    } catch (e) {
        console.error("\n❌ Attack failed:", e.reason || e.message);
    }
}

main().catch(console.error);