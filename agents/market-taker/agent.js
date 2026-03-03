const { ethers } = require("hardhat");
const fs = require("fs");
const path = require("path");
require("dotenv").config();

// hardhat run agents/market-taker/agent.js --network basesepolia

const CYA = "\x1b[36m"; const YEL = "\x1b[33m";
const GRN = "\x1b[32m"; const RED = "\x1b[31m"; const RES = "\x1b[0m";

// ── ABIs ──────────────────────────────────────────────────────────────────────

const ERC20_ABI = [
    "function balanceOf(address) view returns (uint256)",
    "function allowance(address, address) view returns (uint256)",
    "function approve(address, uint256) returns (bool)"
];

const POOL_ABI = [
    "function slot0() view returns (uint160 sqrtPriceX96, int24 tick, uint16, uint16, uint16, uint8, bool)"
];

// SwapRouter02 — no deadline in params; send native ETH via { value } to auto-wrap WETH
const SWAP_ROUTER_ABI = [
    "function exactInputSingle((address tokenIn, address tokenOut, uint24 fee, address recipient, uint256 amountIn, uint256 amountOutMinimum, uint160 sqrtPriceLimitX96)) payable returns (uint256 amountOut)",
    "function multicall(bytes[] calldata data) payable returns (bytes[] memory results)"
];

// ── Helpers ───────────────────────────────────────────────────────────────────

function tickToPrice(tick) {
    return Math.pow(1.0001, tick);
}

async function countdown(seconds) {
    for (let i = seconds; i > 0; i--) {
        process.stdout.write(`\r[REST] Recheck in ${i}s... `);
        await new Promise(r => setTimeout(r, 1000));
    }
    process.stdout.write('\r\x1b[K');
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
    if (!process.env.MT_PK) throw new Error("Missing MT_PK in .env");

    const wallet = new ethers.Wallet(process.env.MT_PK, ethers.provider);
    console.log(`${CYA}[MARKET-TAKER] Wallet: ${wallet.address}${RES}`);

    const config = JSON.parse(fs.readFileSync(path.join(__dirname, "config.json"), "utf8"));
    const { kill_game_addr, weth_addr, pool_addr, swap_router, fee_tier } = config.network;
    const {
        ACQUIRE, SPEND,
        TARGET_PRICE_USD, BUDGET, BUY_INCREMENT, BATCH_SIZE,
        SLIPPAGE_BPS, ETH_PRICE_USD, LOOP_DELAY_SECONDS
    } = config.settings;

    const killGame = new ethers.Contract(kill_game_addr, ["function killToken() view returns (address)"], wallet);
    const kill_token_addr = await killGame.killToken();
    console.log(`${CYA}[INFO] KILL Token: ${kill_token_addr}${RES}`);

    const killToken  = new ethers.Contract(kill_token_addr, ERC20_ABI, wallet);
    const pool       = new ethers.Contract(pool_addr, POOL_ABI, wallet);
    const swapRouter = new ethers.Contract(swap_router, SWAP_ROUTER_ABI, wallet);

    const token0IsKill = kill_token_addr.toLowerCase() < weth_addr.toLowerCase();

    // Direction config
    const acquiring   = ACQUIRE.toUpperCase(); // "KILL" or "ETH"
    const spending    = SPEND.toUpperCase();   // "ETH" or "KILL"
    const spendingEth = spending === "ETH";
    const tokenIn     = spendingEth ? weth_addr : kill_token_addr;
    const tokenOut    = spendingEth ? kill_token_addr : weth_addr;

    const target    = parseFloat(TARGET_PRICE_USD);
    const budget    = parseFloat(BUDGET);
    const increment = parseFloat(BUY_INCREMENT);
    const batchSize = parseInt(BATCH_SIZE, 10) || 1;
    const slippage  = parseFloat(SLIPPAGE_BPS);
    const ethPriceUsd = parseFloat(ETH_PRICE_USD);
    const GAS_RESERVE = 0.005;

    // In-memory spend tracker — resets on agent restart
    let totalSpent = 0;

    console.log(`[CONFIG] Acquiring ${acquiring} | Spending ${spending} | Target $${target.toExponential(3)}`);
    console.log(`[CONFIG] Budget ${budget} ${spending} | Increment ${increment} ${spending} | Batch ${batchSize} | Slippage ${slippage / 100}%`);

    while (true) {
        try {
            const ethBalance  = await wallet.getBalance();
            const killBalance = await killToken.balanceOf(wallet.address);
            const slot0       = await pool.slot0();
            const currentTick = slot0[1];

            const rawPrice        = tickToPrice(currentTick);
            const killPerEth      = token0IsKill ? (1 / rawPrice) : rawPrice;
            const priceEthPerKill = 1 / killPerEth;
            const killPriceUsd    = priceEthPerKill * ethPriceUsd;

            // Trigger condition: acquiring KILL → buy when price below target
            //                    acquiring ETH  → buy (sell KILL) when price above target
            const priceOk  = acquiring === "KILL" ? killPriceUsd < target : killPriceUsd > target;
            const budgetLeft  = budget - totalSpent;
            const budgetOk    = budgetLeft >= increment;
            const spendLabel  = spendingEth
                ? `${totalSpent.toFixed(6)} / ${budget} ETH`
                : `${totalSpent.toLocaleString()} / ${budget.toLocaleString()} KILL`;

            let statusStr;
            if (!budgetOk)        statusStr = `${YEL}BUDGET EXHAUSTED${RES}`;
            else if (priceOk)     statusStr = `${RED}ACTIVE — ${acquiring === "KILL" ? "BUYING KILL" : "SELLING KILL"}${RES}`;
            else                  statusStr = `${GRN}WAITING${RES}`;

            console.log(`\n${CYA}── MARKET-TAKER STATUS ─────────────────────────────${RES}`);
            console.table([{
                "ETH Balance":  parseFloat(ethers.utils.formatEther(ethBalance)).toFixed(6),
                "KILL Balance": parseFloat(ethers.utils.formatEther(killBalance)).toLocaleString(),
                "KILL Price":   `$${killPriceUsd.toExponential(3)}`,
                "Target":       `$${target.toExponential(3)}`,
                "Acquiring":    acquiring,
                "Spent":        spendLabel,
                "Status":       statusStr
            }]);

            if (!budgetOk) {
                console.log(`${YEL}[TAKER] Budget exhausted. Restart agent to reset.${RES}`);
            } else if (priceOk) {
                if (spendingEth) {
                    // ── Buy KILL with ETH (multicall batch) ──────────────────
                    const walletEthFloat = parseFloat(ethers.utils.formatEther(ethBalance));
                    // Cap batch to budget and wallet balance
                    const maxByBudget  = Math.floor(budgetLeft / increment);
                    const maxByWallet  = Math.floor((walletEthFloat - GAS_RESERVE) / increment);
                    const batchCount   = Math.max(1, Math.min(batchSize, maxByBudget, maxByWallet));
                    const amountIn     = ethers.utils.parseEther(increment.toFixed(8));
                    const totalValue   = amountIn.mul(batchCount);

                    if (walletEthFloat < increment + GAS_RESERVE) {
                        console.log(`${RED}[BUY] Insufficient ETH — have ${walletEthFloat.toFixed(6)}, need ${(increment + GAS_RESERVE).toFixed(6)}.${RES}`);
                    } else {
                        const expectedKillRaw = increment * killPerEth;
                        console.log(`${YEL}[BUY] Price $${killPriceUsd.toExponential(3)} | Tick ${currentTick} | killPerEth ${killPerEth.toExponential(4)} | batch ${batchCount}×${increment} ETH = ${(increment * batchCount).toFixed(6)} ETH${RES}`);
                        console.log(`[DEBUG] Per swap: ${increment} ETH → ~${Math.round(expectedKillRaw).toLocaleString()} KILL | tokenIn: ${tokenIn} | tokenOut: ${tokenOut} | fee: ${fee_tier}`);

                        // Simulate one swap with 0 min — reveals pool/liquidity errors before broadcasting
                        const singleParams = {
                            tokenIn, tokenOut, fee: fee_tier,
                            recipient: wallet.address,
                            amountIn, amountOutMinimum: ethers.BigNumber.from(0), sqrtPriceLimitX96: 0
                        };
                        let simOut;
                        try {
                            simOut = await swapRouter.callStatic.exactInputSingle(singleParams, { value: amountIn });
                            console.log(`[DEBUG] Simulation OK — ~${parseFloat(ethers.utils.formatUnits(simOut, 18)).toLocaleString()} KILL per swap × ${batchCount} = ~${Math.round(parseFloat(ethers.utils.formatUnits(simOut, 18)) * batchCount).toLocaleString()} KILL total`);
                        } catch (simErr) {
                            const r = simErr.reason || simErr.error?.message || simErr.message;
                            console.log(`${RED}[DEBUG] Simulation failed: "${r}" — skipping batch.${RES}`);
                            throw simErr;
                        }

                        // Build multicall: N identical exactInputSingle calls
                        const callData = swapRouter.interface.encodeFunctionData("exactInputSingle", [singleParams]);
                        const calls    = Array(batchCount).fill(callData);

                        console.log(`${YEL}[BUY] Submitting ${batchCount}-tx multicall...${RES}`);
                        const tx      = await swapRouter.multicall(calls, { value: totalValue, gasLimit: 300000 * batchCount });
                        const receipt = await tx.wait();
                        totalSpent   += increment * batchCount;
                        console.log(`${GRN}[BUY] Done. Tx: ${receipt.transactionHash} | Total spent: ${totalSpent.toFixed(6)} / ${budget} ETH.${RES}`);
                    }
                } else {
                    // ── Sell KILL for ETH (output is WETH, multicall batch) ──
                    const killIncrement = ethers.utils.parseUnits(Math.floor(increment).toString(), 18);
                    const walletKillBal = await killToken.balanceOf(wallet.address);
                    const maxByBudget   = Math.floor(budgetLeft / increment);
                    const maxByWallet   = Math.floor(parseFloat(ethers.utils.formatEther(walletKillBal)) / increment);
                    const batchCount    = Math.max(1, Math.min(batchSize, maxByBudget, maxByWallet));
                    const totalKillIn   = killIncrement.mul(batchCount);

                    if (walletKillBal.lt(killIncrement)) {
                        console.log(`${RED}[SELL] Insufficient KILL — have ${ethers.utils.formatEther(walletKillBal)}, need ${increment.toLocaleString()}.${RES}`);
                    } else {
                        const allowance = await killToken.allowance(wallet.address, swap_router);
                        if (allowance.lt(totalKillIn)) {
                            await (await killToken.approve(swap_router, ethers.constants.MaxUint256)).wait();
                        }

                        const expectedEthRaw = increment / killPerEth;
                        console.log(`${YEL}[SELL] Price $${killPriceUsd.toExponential(3)} | Tick ${currentTick} | batch ${batchCount}×${increment.toLocaleString()} KILL = ${(increment * batchCount).toLocaleString()} KILL total${RES}`);
                        console.log(`[DEBUG] Per swap: ${increment.toLocaleString()} KILL → ~${expectedEthRaw.toFixed(8)} ETH | tokenIn: ${tokenIn} | tokenOut: ${tokenOut}`);

                        const singleParams = {
                            tokenIn, tokenOut, fee: fee_tier,
                            recipient: wallet.address,
                            amountIn: killIncrement, amountOutMinimum: ethers.BigNumber.from(0), sqrtPriceLimitX96: 0
                        };
                        try {
                            const simOut = await swapRouter.callStatic.exactInputSingle(singleParams);
                            console.log(`[DEBUG] Simulation OK — ~${ethers.utils.formatEther(simOut)} ETH per swap × ${batchCount}`);
                        } catch (simErr) {
                            const r = simErr.reason || simErr.error?.message || simErr.message;
                            console.log(`${RED}[DEBUG] Simulation failed: "${r}" — skipping batch.${RES}`);
                            throw simErr;
                        }

                        const callData = swapRouter.interface.encodeFunctionData("exactInputSingle", [singleParams]);
                        const calls    = Array(batchCount).fill(callData);

                        console.log(`${YEL}[SELL] Submitting ${batchCount}-tx multicall...${RES}`);
                        const tx      = await swapRouter.multicall(calls, { gasLimit: 300000 * batchCount });
                        const receipt = await tx.wait();
                        totalSpent   += increment * batchCount;
                        console.log(`${GRN}[SELL] Done. Tx: ${receipt.transactionHash} | Total spent: ${totalSpent.toLocaleString()} / ${budget.toLocaleString()} KILL.${RES}`);
                    }
                }
            } else {
                const dir = acquiring === "KILL" ? `above target ($${target.toExponential(3)})` : `below target ($${target.toExponential(3)})`;
                console.log(`${GRN}[TAKER] Price is ${dir} — holding.${RES}`);
            }

        } catch (e) {
            console.error(`${RED}[ERROR] ${e.reason || e.message}${RES}`);
        }

        await countdown(LOOP_DELAY_SECONDS);
    }
}

main().catch(console.error);
