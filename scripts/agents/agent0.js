const { ethers } = require("hardhat");

/**
 * KILL // Tactical Simulation Script (Ethers v5)
 * Logic: Scout -> Siege (Spawn until lethal) -> Kill -> Repeat.
 */
async function main() {
    const KILL_TOKEN_ADDR = process.env.KILL_TOKEN;
    const KILL_GAME_ADDR = process.env.KILL_GAME;

    const KillToken = await ethers.getContractFactory("KILLToken");
    const killToken = await KillToken.attach(KILL_TOKEN_ADDR);

    const KillGame = await ethers.getContractFactory("KILLGame");
    const killGame = await KillGame.attach(KILL_GAME_ADDR);

    const allSigners = await ethers.getSigners();
    const owner = allSigners[0];

    const agents = [
        { signer: allSigners[0], name: "WHALE_A", mint: "10000", targetStack: null, targetAddr: null },
        { signer: allSigners[1], name: "WHALE_B", mint: "1000", targetStack: null, targetAddr: null },
        { signer: allSigners[2], name: "SHRIMP_A", mint: "100", targetStack: null, targetAddr: null },
        { signer: allSigners[3], name: "SHRIMP_B", mint: "50", targetStack: null, targetAddr: null },
        { signer: allSigners[4], name: "SHRIMP_C", mint: "25", targetStack: null, targetAddr: null },
        { signer: allSigners[5], name: "MINNOW", mint: "5", targetStack: null, targetAddr: null }
    ];

    console.log("--- KILL SIMULATION ENGINE: SIEGE MODE ---");

    while (true) {
        const block = await ethers.provider.getBlockNumber();
        console.log(`\n[BLOCK ${block}] --- TICK ---`);

        for (let agent of agents) {
            try {
                const { signer, name, mint } = agent;
                const address = await signer.getAddress();

                // 1. GAS CHECK: Ensure agents can pay for transactions
                const ethBalance = await signer.getBalance();
                if (ethBalance.lt(ethers.utils.parseEther("0.01")) && address !== owner.address) {
                    console.log(`[${name}] Low Gas. Requesting funds from Owner...`);
                    await (await owner.sendTransaction({
                        to: address,
                        value: ethers.utils.parseEther("0.05")
                    })).wait(1);
                }

                // 2. FUNDING: Owner mints archetype tokens
                const mintAmount = ethers.utils.parseEther(mint);
                await (await killToken.connect(owner).mint(address, mintAmount)).wait(1);

                // 3. APPROVAL
                const tokenBalance = await killToken.balanceOf(address);
                const allowance = await killToken.allowance(address, KILL_GAME_ADDR);
                if (allowance.lt(tokenBalance)) {
                    await (await killToken.connect(signer).approve(KILL_GAME_ADDR, ethers.constants.MaxUint256)).wait(1);
                }

                // 4. SIEGE LOGIC
                let currentStack = agent.targetStack;
                let currentTarget = agent.targetAddr;

                // If no target, scout a random stack (1-216)
                if (!currentStack) {
                    const scoutId = Math.floor(Math.random() * 216) + 1;
                    const [occupants] = await killGame.getRipeStacks(scoutId, false);
                    
                    for (let occ of occupants) {
                        if (occ !== address && occ !== ethers.constants.AddressZero) {
                            agent.targetStack = scoutId;
                            agent.targetAddr = occ;
                            currentStack = scoutId;
                            currentTarget = occ;
                            console.log(`[${name}] SCOUTED target ${occ.substring(0,8)} on Stack ${scoutId}. Initializing Siege.`);
                            break;
                        }
                    }
                }

                if (currentTarget) {
                    // Check if target is still there
                    const targetU = await killGame.balanceOf(currentTarget, currentStack);
                    const targetR = await killGame.balanceOf(currentTarget, currentStack + 216);
                    
                    if (targetU.add(targetR).eq(0)) {
                        console.log(`[${name}] Target on Stack ${currentStack} vanished. Resuming scouting.`);
                        agent.targetStack = null;
                        agent.targetAddr = null;
                    } else {
                        // CALC LETHALITY: Power = Units + (Reaper * 666). Target gets 10% defense bonus.
                        const defPower = (targetU.add(targetR.mul(666))).mul(110).div(100);
                        
                        const myU = await killGame.balanceOf(address, currentStack);
                        const myR = await killGame.balanceOf(address, currentStack + 216);
                        const myPower = myU.add(myR.mul(666));

                        if (myPower.gt(defPower)) {
                            console.log(`[${name}] LETHAL REACHED (${myPower} vs ${defPower}). EXECUTING KILL.`);
                            const tx = await killGame.connect(signer).kill(currentTarget, currentStack, myU, myR, { gasLimit: 1000000 });
                            await tx.wait(1);
                            // Reset after successful kill
                            agent.targetStack = null;
                            agent.targetAddr = null;
                        } else {
                            // SIEGE: Spawn more units to build power
                            const spawnAmount = tokenBalance.div(ethers.utils.parseEther("10"));
                            if (spawnAmount.gt(0)) {
                                console.log(`[${name}] SIEGING Stack ${currentStack}. Current Power: ${myPower} / Required: ${defPower.add(1)}`);
                                await (await killGame.connect(signer).spawn(currentStack, spawnAmount, { gasLimit: 800000 })).wait(1);
                            }
                        }
                    }
                } else {
                    // Random Spawn to establish presence if no target found during scouting
                    const spawnAmount = tokenBalance.div(ethers.utils.parseEther("10"));
                    const randomStack = Math.floor(Math.random() * 216) + 1;
                    if (spawnAmount.gt(0)) {
                        console.log(`[${name}] No targets. Spawning presence on Stack ${randomStack}.`);
                        await (await killGame.connect(signer).spawn(randomStack, spawnAmount, { gasLimit: 800000 })).wait(1);
                    }
                }

            } catch (err) {
                console.log(`[${agent.name}] Action failed: ${err.reason || "Revert/Network error"}`);
            }
        }

        await new Promise(r => setTimeout(r, 2000));
    }
}

main().catch((error) => {
    console.error(error);
    process.exit(1);
});