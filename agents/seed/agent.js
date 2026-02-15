const { ethers } = require("hardhat");
const fs = require("fs");
const path = require("path");
require("dotenv").config();

async function countdown(seconds) {
    for (let i = seconds; i > 0; i--) {
        process.stdout.write(`\r[REST] Next seed in ${i}s... `);
        await new Promise(r => setTimeout(r, 1000));
    }
    process.stdout.write('\r\x1b[K');
}

async function main() {
    if (!process.env.SEED_PK) throw new Error("Missing SEED_PK in .env");

    const wallet = new ethers.Wallet(process.env.SEED_PK, ethers.provider);
    const address = wallet.address;

    const config = JSON.parse(fs.readFileSync(path.join(__dirname, "config.json"), "utf8"));
    const { kill_game_addr } = config.network;
    const { SEED_AMOUNT, LOOP_DELAY_SECONDS } = config.settings;

    const killGame = await ethers.getContractAt("KILLGame", kill_game_addr);
    const killToken = await ethers.getContractAt("@openzeppelin/contracts/token/ERC20/IERC20.sol:IERC20", await killGame.killToken());
    const SPAWN_COST = await killGame.SPAWN_COST();

    console.log(`\n--- SEED AGENT ONLINE ---`);
    console.log(`OPERATING AS: ${address}\n`);

    // Initial Approval Check
    const allowance = await killToken.allowance(address, kill_game_addr);
    if (allowance.lt(ethers.constants.MaxUint256.div(2))) {
        console.log("[SETUP] Approving KILL tokens for seeding...");
        await (await killToken.connect(wallet).approve(kill_game_addr, ethers.constants.MaxUint256)).wait();
    }

    while (true) {
        console.clear();
        console.log(`\n--- SEED AGENT ACTIVE ---`);
        
        const requiredKill = SPAWN_COST.mul(SEED_AMOUNT);
        const balance = await killToken.balanceOf(address);

        // --- STATUS TABLE ---
        console.log(`\n>> RESOURCE CHECK:`);
        console.table([{
            Wallet: address.slice(0, 10),
            Balance: ethers.utils.formatUnits(balance, 18),
            Required: ethers.utils.formatUnits(requiredKill, 18),
            Ready: balance.gte(requiredKill) ? "YES" : "NO"
        }]);

        if (balance.lt(requiredKill)) {
            console.log(`\n[WAIT] Insufficient KILL. Waiting for refill...`);
            await new Promise(r => setTimeout(r, 10000));
            continue;
        }

        const randomStack = Math.floor(Math.random() * 216) + 1;
        
        try {
            console.log(`\n[ACTION] Spawning ${SEED_AMOUNT} units on Stack ${randomStack}...`);
            const tx = await killGame.connect(wallet).spawn(randomStack, SEED_AMOUNT, { gasLimit: 800000 });
            const receipt = await tx.wait();
            
            console.log(`[SUCCESS] Seeded! Tx: ${receipt.transactionHash}`);
            await countdown(LOOP_DELAY_SECONDS);

        } catch (error) {
            console.error("\n[SEED ERROR]:", error.reason || error.message);
            await new Promise(r => setTimeout(r, 10000));
        }
    }
}

main().catch(console.error);