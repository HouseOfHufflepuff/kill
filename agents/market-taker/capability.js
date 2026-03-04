"use strict";
const { ethers } = require("hardhat");
const { GRN, YEL, RED, CYA, RES } = require('../common');

function tickToPrice(tick) { return Math.pow(1.0001, tick); }

// Module-level state — resets on agent restart
let totalSpent = 0;

module.exports = {
    async run({ wallet, killToken, pool, swapRouter, config }) {
        const { ACQUIRE, SPEND, TARGET_PRICE_USD, BUDGET, BUY_INCREMENT, BATCH_SIZE, SLIPPAGE_BPS, ETH_PRICE_USD } = config.settings;
        const { weth_addr, fee_tier } = config.network;

        const killTokenAddr = killToken.address;
        const token0IsKill  = killTokenAddr.toLowerCase() < weth_addr.toLowerCase();
        const acquiring     = ACQUIRE.toUpperCase();
        const spendingEth   = SPEND.toUpperCase() === "ETH";
        const tokenIn       = spendingEth ? weth_addr : killTokenAddr;
        const tokenOut      = spendingEth ? killTokenAddr : weth_addr;

        const target    = parseFloat(TARGET_PRICE_USD);
        const budget    = parseFloat(BUDGET);
        const increment = parseFloat(BUY_INCREMENT);
        const batchSize = parseInt(BATCH_SIZE, 10) || 1;

        const ethBalance = await wallet.getBalance();
        const slot0      = await pool.slot0();
        const killPerEth = token0IsKill ? (1 / tickToPrice(slot0[1])) : tickToPrice(slot0[1]);
        const killPriceUsd = (1 / killPerEth) * parseFloat(ETH_PRICE_USD);

        const priceOk    = acquiring === "KILL" ? killPriceUsd < target : killPriceUsd > target;
        const budgetLeft = budget - totalSpent;
        const budgetOk   = budgetLeft >= increment;
        const spendLabel = spendingEth
            ? `${totalSpent.toFixed(6)} / ${budget} ETH`
            : `${totalSpent.toLocaleString()} / ${budget.toLocaleString()} KILL`;

        let statusStr, statusColor;
        if (!budgetOk)    { statusStr = 'EXHAUSTED';                               statusColor = YEL; }
        else if (priceOk) { statusStr = acquiring === "KILL" ? 'BUY KILL' : 'SELL KILL'; statusColor = RED; }
        else              { statusStr = 'WAITING';                                 statusColor = GRN; }

        const fmtPrice = v => v < 0.000001 ? `$${v.toFixed(10)}` : `$${v.toFixed(8)}`;
        const statusRows = [{
            'KILL Price': fmtPrice(killPriceUsd),
            'Target':     fmtPrice(target),
            'Direction':  acquiring,
            'Spent':      spendLabel,
            'Status':     `${statusColor}${statusStr}${RES}`
        }];

        if (!budgetOk || !priceOk) {
            return [{ title: 'MARKET-TAKER', rows: statusRows, color: CYA }];
        }

        // ── Execute swap ──────────────────────────────────────────────────────
        const actionRows = [];
        const GAS_RESERVE = 0.005;

        try {
            const amountIn       = spendingEth
                ? ethers.utils.parseEther(increment.toFixed(8))
                : ethers.utils.parseUnits(Math.floor(increment).toString(), 18);
            const walletEthFloat = parseFloat(ethers.utils.formatEther(ethBalance));

            if (spendingEth && walletEthFloat < increment + GAS_RESERVE) {
                statusRows[0].Status = `${RED}LOW ETH${RES}`;
                return [{ title: 'MARKET-TAKER', rows: statusRows, color: CYA }];
            }

            if (!spendingEth) {
                const walletKillBal = await killToken.balanceOf(wallet.address);
                if (walletKillBal.lt(amountIn)) {
                    statusRows[0].Status = `${RED}LOW KILL${RES}`;
                    return [{ title: 'MARKET-TAKER', rows: statusRows, color: CYA }];
                }
                const allowance = await killToken.allowance(wallet.address, swapRouter.address);
                if (allowance.lt(amountIn)) {
                    await (await killToken.approve(swapRouter.address, ethers.constants.MaxUint256)).wait();
                    actionRows.push({ Action: 'APPROVE', Detail: 'MaxUint256', Result: `${GRN}OK${RES}` });
                }
            }

            const maxByBudget = Math.floor(budgetLeft / increment);
            const maxByWallet = spendingEth
                ? Math.floor((walletEthFloat - GAS_RESERVE) / increment)
                : Math.floor(parseFloat(ethers.utils.formatEther(await killToken.balanceOf(wallet.address))) / increment);
            const batchCount  = Math.max(1, Math.min(batchSize, maxByBudget, maxByWallet));
            const totalValue  = amountIn.mul(batchCount);

            const singleParams = { tokenIn, tokenOut, fee: fee_tier, recipient: wallet.address, amountIn, amountOutMinimum: ethers.BigNumber.from(0), sqrtPriceLimitX96: 0 };
            const callValue    = spendingEth ? amountIn : ethers.BigNumber.from(0);

            // Simulate before broadcasting
            await swapRouter.callStatic.exactInputSingle(singleParams, { value: callValue });

            const callData = swapRouter.interface.encodeFunctionData("exactInputSingle", [singleParams]);
            const calls    = Array(batchCount).fill(callData);
            const txOpts   = spendingEth ? { value: totalValue, gasLimit: 300000 * batchCount } : { gasLimit: 300000 * batchCount };

            const tx = await swapRouter.multicall(calls, txOpts);
            await tx.wait();
            if (config.network.block_explorer) console.log(`  ↗ ${config.network.block_explorer}/${tx.hash}`);

            totalSpent += increment * batchCount;
            actionRows.push({
                Action: acquiring === "KILL" ? 'BUY KILL' : 'SELL KILL',
                Detail: `${batchCount}x ${increment} ${SPEND.toUpperCase()} @ ${fmtPrice(killPriceUsd)}`,
                Result: `${GRN}OK${RES}`
            });
        } catch (e) {
            actionRows.push({ Action: 'SWAP', Detail: e.reason || e.message, Result: `${RED}FAIL${RES}` });
        }

        return [
            { title: 'MARKET-TAKER', rows: statusRows, color: CYA },
            { title: 'MARKET-TAKER ACTIONS', rows: actionRows, color: GRN }
        ];
    }
};
