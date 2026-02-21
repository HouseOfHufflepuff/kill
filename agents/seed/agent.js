const { ethers } = require("hardhat");
const fs = require("fs");
const path = require("path");
require("dotenv").config();

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
    const config = JSON.parse(fs.readFileSync(path.join(__dirname, "config.json"), "utf8"));
    const { kill_game_addr } = config.network;
    const { SEED_AMOUNT, LOOP_DELAY_SECONDS, BATCH_SEED } = config.settings;
    const killGame = await ethers.getContractAt("KILLGame", kill_game_addr);
    const killToken = await ethers.getContractAt("@openzeppelin/contracts/token/ERC20/IERC20.sol:IERC20", await killGame.killToken());

    console.log(`\n--- STABILIZED SEED AGENT ONLINE ---`);

    while (true) {
        console.clear();
        const ethBalance = await wallet.getBalance();
        const killBalance = await killToken.balanceOf(wallet.address);
        const requiredKill = (await killGame.SPAWN_COST()).mul(SEED_AMOUNT).mul(BATCH_SEED);

        console.log(`\n>> RESOURCE CHECK:`);
        console.table([{
            ETH: ethers.utils.formatEther(ethBalance).slice(0, 8),
            KILL: ethers.utils.formatUnits(killBalance, 18),
            BatchSize: BATCH_SEED,
            Ready: ethBalance.gt(ethers.utils.parseEther("0.01")) ? "YES" : "LOW ETH"
        }]);

        if (ethBalance.lt(ethers.utils.parseEther("0.005"))) {
            console.log(`[STOP] ETH Critically Low. Fund ${wallet.address}`);
            await new Promise(r => setTimeout(r, 60000));
            continue;
        }

        const encodedCalls = [];
        const selected = [];
        for (let i = 0; i < BATCH_SEED; i++) {
            let s; do { s = Math.floor(Math.random() * 216) + 1; } while (selected.includes(s));
            selected.push(s);
            encodedCalls.push(killGame.interface.encodeFunctionData("spawn", [s, SEED_AMOUNT]));
        }

        try {
            console.log(`[ACTION] Simulating ${BATCH_SEED} spawns...`);
            const gasEst = await killGame.connect(wallet).estimateGas.multicall(encodedCalls);
            const feeData = await ethers.provider.getFeeData();
            const estCost = gasEst.mul(feeData.maxFeePerGas || feeData.gasPrice);

            if (estCost.gt(ethBalance)) {
                console.error(`[GAS ALERT] Estimated cost (${ethers.utils.formatEther(estCost)}) exceeds balance! Skipping...`);
                await new Promise(r => setTimeout(r, 10000));
                continue;
            }

            const tx = await killGame.connect(wallet).multicall(encodedCalls, { gasLimit: gasEst.mul(120).div(100) });
            console.log(`[PENDING] Tx: ${tx.hash}`);
            await tx.wait();
            console.log(`[SUCCESS] Batch confirmed.`);
            await countdown(LOOP_DELAY_SECONDS);
        } catch (e) {
            console.error(`[FAIL] ${e.reason || e.message}`);
            await new Promise(r => setTimeout(r, 10000));
        }
    }
}
main().catch(console.error);