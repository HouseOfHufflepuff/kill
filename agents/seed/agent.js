const { ethers } = require("hardhat");
const fs = require("fs");
const path = require("path");
require("dotenv").config();


//hardhat run agents/seed/agent.js --network basesepolia
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
    const killTokenAddr = await killGame.killToken();
    const killToken = await ethers.getContractAt("IERC20", killTokenAddr);

    console.log(`\n--- STABILIZED SEED AGENT ONLINE ---`);

    while (true) {
        const ethBalance = await wallet.getBalance();
        const killBalance = await killToken.balanceOf(wallet.address);
        const allowance = await killToken.allowance(wallet.address, kill_game_addr);
        const stack119 = await killGame.balanceOf(wallet.address, 119);

        console.log(`\n>> RESOURCE CHECK:`);
        console.table([{
            ETH: ethers.utils.formatEther(ethBalance).slice(0, 8),
            KILL: ethers.utils.formatUnits(killBalance, 18),
            Allowance: ethers.utils.formatUnits(allowance, 18),
            Stack119: stack119.toString(),
            Ready: ethBalance.gt(ethers.utils.parseEther("0.01")) ? "YES" : "LOW ETH"
        }]);

        // Fix: Automatic Approval if allowance is low
        const required = ethers.utils.parseUnits("0.01", 18).mul(SEED_AMOUNT).mul(BATCH_SEED);
        if (allowance.lt(required)) {
            console.log(`[ACTION] Approving KILL tokens...`);
            const appTx = await killToken.connect(wallet).approve(kill_game_addr, ethers.constants.MaxUint256);
            await appTx.wait();
        }

        if (ethBalance.lt(ethers.utils.parseEther("0.005"))) {
            console.log(`[STOP] ETH Critically Low.`);
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
                console.error(`[GAS ALERT] Cost exceeds balance.`);
                await new Promise(r => setTimeout(r, 10000));
                continue;
            }

            const tx = await killGame.connect(wallet).multicall(encodedCalls, { gasLimit: gasEst.mul(150).div(100) });
            console.log(`[PENDING] Tx: ${tx.hash}`);
            await tx.wait();
            console.log(`[SUCCESS] Batch confirmed.`);
            await countdown(LOOP_DELAY_SECONDS);
        } catch (e) {
            // Detailed Debugging
            if (e.data) {
                const decodedError = killGame.interface.parseError(e.data);
                console.error(`[FAIL] Custom Error: ${decodedError?.name}`);
            } else {
                console.error(`[FAIL] ${e.reason || e.message}`);
            }
            await new Promise(r => setTimeout(r, 10000));
        }
    }
}
main().catch(console.error);