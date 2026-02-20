const { ethers } = require("hardhat");
const fs = require("fs");
const path = require("path");
require("dotenv").config();

// hardhat run agents/seed/agent.js --network basesepolia

const MULTICALL_ABI = [
    "function aggregate3(tuple(address target, bool allowFailure, bytes callData)[] calls) public payable returns (tuple(bool success, bytes returnData)[] returnData)"
];

async function countdown(seconds) {
    for (let i = seconds; i > 0; i--) {
        process.stdout.write(`\r[REST] Next seed batch in ${i}s... `);
        await new Promise(r => setTimeout(r, 1000));
    }
    process.stdout.write('\r\x1b[K');
}

async function main() {
    if (!process.env.SEED_PK) throw new Error("Missing SEED_PK in .env");

    const wallet = new ethers.Wallet(process.env.SEED_PK, ethers.provider);
    const address = wallet.address;

    const config = JSON.parse(fs.readFileSync(path.join(__dirname, "config.json"), "utf8"));
    const { kill_game_addr, multicall_addr } = config.network;
    const { SEED_AMOUNT, LOOP_DELAY_SECONDS, BATCH_SEED } = config.settings;

    const killGame = await ethers.getContractAt("KILLGame", kill_game_addr);
    const killToken = await ethers.getContractAt("@openzeppelin/contracts/token/ERC20/IERC20.sol:IERC20", await killGame.killToken());
    const multicall = new ethers.Contract(multicall_addr, MULTICALL_ABI, wallet);
    
    const SPAWN_COST = await killGame.SPAWN_COST();

    console.log(`\n--- BATCH SEED AGENT ONLINE ---`);
    console.log(`OPERATING AS: ${address}\n`);

    while (true) {
        console.clear();
        console.log(`\n--- SEED AGENT ACTIVE (BATCH: ${BATCH_SEED}) ---`);
        
        const ethBalance = await wallet.getBalance();
        const killBalance = await killToken.balanceOf(address);
        const allowance = await killToken.allowance(address, kill_game_addr);
        const requiredKill = SPAWN_COST.mul(SEED_AMOUNT).mul(BATCH_SEED);

        // --- STATUS TABLE ---
        console.log(`\n>> RESOURCE CHECK:`);
        console.table([{
            ETH: ethers.utils.formatEther(ethBalance).slice(0, 6),
            KILL_Bal: ethers.utils.formatUnits(killBalance, 18),
            KILL_Allow: ethers.utils.formatUnits(allowance, 18),
            Required: ethers.utils.formatUnits(requiredKill, 18),
            Ready: ethBalance.gt(ethers.utils.parseEther("0.005")) && killBalance.gte(requiredKill) ? "YES" : "NO"
        }]);

        // Fix ETH Shortage
        if (ethBalance.lt(ethers.utils.parseEther("0.005"))) {
            console.log(`\n[CRITICAL] Insufficient ETH for gas. Please fund ${address}`);
            await new Promise(r => setTimeout(r, 30000));
            continue;
        }

        // Fix Allowance
        if (allowance.lt(requiredKill)) {
            console.log(`\n[ACTION] Allowance too low (${ethers.utils.formatUnits(allowance, 18)}). Approving Max...`);
            try {
                const tx = await killToken.connect(wallet).approve(kill_game_addr, ethers.constants.MaxUint256);
                await tx.wait();
                console.log(`[SUCCESS] Max Allowance granted to ${kill_game_addr}`);
            } catch (err) {
                console.error("[ERROR] Approval failed:", err.message);
                await new Promise(r => setTimeout(r, 5000));
                continue;
            }
        }

        if (killBalance.lt(requiredKill)) {
            console.log(`\n[WAIT] Insufficient KILL. Waiting for refill...`);
            await new Promise(r => setTimeout(r, 10000));
            continue;
        }

        const calls = [];
        const selectedStacks = [];
        for (let i = 0; i < BATCH_SEED; i++) {
            let randomStack;
            do { randomStack = Math.floor(Math.random() * 216) + 1; } 
            while (selectedStacks.includes(randomStack));
            selectedStacks.push(randomStack);

            calls.push({
                target: kill_game_addr,
                allowFailure: true,
                callData: killGame.interface.encodeFunctionData("spawn", [randomStack, SEED_AMOUNT])
            });
        }
        
        try {
            console.log(`\n[ACTION] Sending batch spawn for stacks: ${selectedStacks.join(", ")}...`);
            
            const results = await multicall.callStatic.aggregate3(calls);
            
            let allSuccess = true;
            for (let i = 0; i < results.length; i++) {
                if (!results[i].success) {
                    allSuccess = false;
                    const errorHex = results[i].returnData;
                    console.log(`\n[DEBUG] Call ${i} (Stack ${selectedStacks[i]}) failed.`);
                    
                    if (errorHex.startsWith("0xfb8f41b2")) {
                        console.error(`[REASON]: ERC20InsufficientAllowance (Agent still lacking allowance for ${kill_game_addr})`);
                    } else {
                        try {
                            const decoded = killGame.interface.parseError(errorHex);
                            console.error(`[CONTRACT ERROR]: ${decoded.name}`);
                        } catch (e) {
                            console.error(`[RAW HEX]: ${errorHex}`);
                        }
                    }
                }
            }

            if (!allSuccess) throw new Error("BATCH_SIMULATION_FAILED");

            const tx = await multicall.aggregate3(calls, { gasLimit: 800000 * BATCH_SEED });
            const receipt = await tx.wait();
            
            console.log(`[SUCCESS] Batch Seeded! Tx: ${receipt.transactionHash}`);
            await countdown(LOOP_DELAY_SECONDS);

        } catch (error) {
            if (error.message !== "BATCH_SIMULATION_FAILED") {
                console.error("\n[EXECUTION ERROR]:", error.reason || error.message);
            }
            await new Promise(r => setTimeout(r, 5000));
        }
    }
}

main().catch(console.error);