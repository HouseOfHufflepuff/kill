const { ethers } = require("hardhat");
const fs = require("fs");
const path = require("path");
require("dotenv").config();

async function countdown(seconds) {
    for (let i = seconds; i > 0; i--) {
        process.stdout.write(`\r[WAIT] Next hunt in ${i}s... `);
        await new Promise(r => setTimeout(r, 1000));
    }
    process.stdout.write('\r\x1b[K');
}

async function main() {
    if (!process.env.SNIPER_PK) throw new Error("Missing SNIPER_PK");
    
    const wallet = new ethers.Wallet(process.env.SNIPER_PK, ethers.provider);
    const address = wallet.address;
    const fortressAddress = process.env.FORTRESS_PK ? new ethers.Wallet(process.env.FORTRESS_PK).address.toLowerCase() : "";

    const config = JSON.parse(fs.readFileSync(path.join(__dirname, "config.json"), "utf8"));
    const { kill_game_addr, multicall_addr } = config.network;
    const { MIN_TARGET_UNITS, SPAWN_BUFFER, LOOP_DELAY_SECONDS } = config.settings;

    const killGame = await ethers.getContractAt("KILLGame", kill_game_addr);
    
    // Get Token and Cost info directly from contract
    const killTokenAddr = await killGame.killToken();
    const SPAWN_COST = await killGame.SPAWN_COST();
    const killToken = await ethers.getContractAt("@openzeppelin/contracts/token/ERC20/IERC20.sol:IERC20", killTokenAddr);
    
    const multicall = new ethers.Contract(multicall_addr, ["function aggregate(tuple(address target, bytes callData)[] calls) public view returns (uint256 blockNumber, bytes[] returnData)"], wallet);

    // ONE-TIME APPROVAL
    console.log("Verifying Allowance...");
    const allowance = await killToken.allowance(address, kill_game_addr);
    if (allowance.lt(ethers.constants.MaxUint256.div(2))) {
        console.log("[SETUP] Approving KILL tokens...");
        await (await killToken.connect(wallet).approve(kill_game_addr, ethers.constants.MaxUint256)).wait();
    }

    while (true) {
        console.clear();
        console.log(`\n--- SNIPER AGENT ONLINE ---`);
        console.log(`OPERATING AS: ${address}\n`);

        try {
            const scanIds = Array.from({ length: 216 }, (_, i) => i + 1);
            const calls = scanIds.map(id => ({
                target: kill_game_addr,
                callData: killGame.interface.encodeFunctionData("getFullStack", [id])
            }));

            const [, returnData] = await multicall.aggregate(calls);
            let targets = [];

            for (let i = 0; i < returnData.length; i++) {
                const stackId = scanIds[i];
                const items = killGame.interface.decodeFunctionResult("getFullStack", returnData[i])[0];
                const self = items.find(it => it.occupant.toLowerCase() === address.toLowerCase());
                const enemies = items.filter(it => {
                    const occ = it.occupant.toLowerCase();
                    return occ !== address.toLowerCase() && occ !== fortressAddress && it.units.gt(MIN_TARGET_UNITS);
                });

                if (enemies.length > 0) {
                    enemies.sort((a, b) => b.units.sub(a.units).toNumber());
                    targets.push({ id: stackId, enemy: enemies[0], self });
                }
            }

            targets.sort((a, b) => b.enemy.units.sub(a.enemy.units).toNumber());

            if (targets.length > 0) {
                const target = targets[0];
                const amountToSpawn = target.enemy.units.add(SPAWN_BUFFER);
                const totalCost = amountToSpawn.mul(SPAWN_COST);

                console.log(`[TARGET] Stack ${target.id} | Enemy: ${target.enemy.occupant.slice(0, 10)}`);

                // PRE-FLIGHT CHECK
                const balance = await killToken.balanceOf(address);
                if (balance.lt(totalCost)) {
                    console.log(`[ERROR] Insufficient KILL! Have: ${ethers.utils.formatEther(balance)} | Need: ${ethers.utils.formatEther(totalCost)}`);
                } else {
                    console.log(`[ATTACK] Spawning ${amountToSpawn.toString()} units on Stack ${target.id}...`);
                    const tx = await killGame.connect(wallet).spawn(target.id, amountToSpawn, { gasLimit: 800000 });
                    await tx.wait();

                    // Re-scan for the kill
                    const freshStack = await killGame.getFullStack(target.id);
                    const me = freshStack.find(it => it.occupant.toLowerCase() === address.toLowerCase());
                    if (me && me.units.gt(target.enemy.units)) {
                        console.log(`[KILL] Executing Strike...`);
                        await (await killGame.connect(wallet).kill(target.enemy.occupant, target.id, me.units.sub(1), me.reapers, { gasLimit: 800000 })).wait();
                    }
                }
            } else {
                console.log("[SCAN] No viable targets.");
            }

        } catch (error) {
            console.error("[SNIPER ERROR]:", error.reason || error.message);
        }

        await countdown(LOOP_DELAY_SECONDS);
    }
}

main().catch(console.error);