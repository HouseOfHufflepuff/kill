"use strict";
const { ethers } = require("hardhat");
const { GRN, YEL, RED, CYA, RES } = require('../common');

function tickToPrice(tick) { return Math.pow(1.0001, tick); }

// Module-level state — resets on agent restart
let totalSpent = 0;

module.exports = {
    async run({ wallet, killToken, pool, swapRouter, config }) {
        const { ACQUIRE, SPEND, TARGET_PRICE_USD, BUDGET, BUY_INCREMENT, BATCH_SIZE, ETH_PRICE_USD } = config.settings;
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
        if (!budgetOk)    { statusStr = 'EXHAUSTED';                                           statusColor = YEL; }
        else if (priceOk) { statusStr = acquiring === "KILL" ? 'BUY KILL' : 'SELL KILL';       statusColor = RED; }
        else              { statusStr = 'WAITING';                                             statusColor = GRN; }

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

        const amountIn       = spendingEth
            ? ethers.utils.parseEther(increment.toFixed(8))
            : ethers.utils.parseUnits(Math.floor(increment).toString(), 18);
        const walletEthFloat = parseFloat(ethers.utils.formatEther(ethBalance));

        if (spendingEth && walletEthFloat < increment + GAS_RESERVE) {
            statusRows[0].Status = `${RED}LOW ETH${RES}`;
            return [{ title: 'MARKET-TAKER', rows: statusRows, color: CYA }];
        }

        // ── Debug: pre-swap state ─────────────────────────────────────────────
        const killBal   = await killToken.balanceOf(wallet.address);
        const allowance = await killToken.allowance(wallet.address, swapRouter.address);
        const killBalFmt = Math.round(parseFloat(ethers.utils.formatEther(killBal))).toLocaleString();
        const allowFmt   = allowance.gte(ethers.constants.MaxUint256.div(2))
            ? 'MAX'
            : Math.round(parseFloat(ethers.utils.formatEther(allowance))).toLocaleString();
        const amtInFmt   = Math.round(parseFloat(ethers.utils.formatEther(amountIn))).toLocaleString();
        const tick       = slot0[1];

        actionRows.push({
            Action: 'STATE',
            Detail: `kill=${killBalFmt} allow=${allowFmt} amtIn=${amtInFmt} tick=${tick} fee=${fee_tier}`,
            Result: '',
            Tx: ''
        });

        // ── Approve (KILL spending only) ──────────────────────────────────────
        if (!spendingEth) {
            if (killBal.lt(amountIn)) {
                statusRows[0].Status = `${RED}LOW KILL${RES}`;
                actionRows.forEach(r => { if (r.Tx === undefined) r.Tx = ''; });
                return [{ title: 'MARKET-TAKER', rows: statusRows, color: CYA },
                        { title: 'MARKET-TAKER ACTIONS', rows: actionRows, color: GRN }];
            }
            if (allowance.lt(amountIn)) {
                try {
                    const approveTx = await killToken.approve(swapRouter.address, ethers.constants.MaxUint256);
                    await approveTx.wait();
                    actionRows.push({ Action: 'APPROVE', Detail: 'MaxUint256', Result: `${GRN}OK${RES}`, Tx: '' });
                } catch (ae) {
                    const msg = ae.reason || ae.message || 'unknown';
                    actionRows.push({ Action: 'APPROVE', Detail: msg.slice(0, 40), Result: `${RED}FAIL${RES}`, Tx: '' });
                    console.error('[APPROVE ERROR]', { reason: ae.reason, message: ae.message, data: ae.data });
                    actionRows.forEach(r => { if (r.Tx === undefined) r.Tx = ''; });
                    return [{ title: 'MARKET-TAKER', rows: statusRows, color: CYA },
                            { title: 'MARKET-TAKER ACTIONS', rows: actionRows, color: GRN }];
                }
            }
        }

        // ── Build multicall ───────────────────────────────────────────────────
        const maxByBudget = Math.floor(budgetLeft / increment);
        const maxByWallet = spendingEth
            ? Math.floor((walletEthFloat - GAS_RESERVE) / increment)
            : Math.floor(parseFloat(ethers.utils.formatEther(await killToken.balanceOf(wallet.address))) / increment);
        const batchCount  = Math.max(1, Math.min(batchSize, maxByBudget, maxByWallet));
        const totalValue  = amountIn.mul(batchCount);

        const singleParams = {
            tokenIn, tokenOut, fee: fee_tier,
            recipient: wallet.address,
            amountIn,
            amountOutMinimum: ethers.BigNumber.from(0),
            sqrtPriceLimitX96: 0
        };
        const callValue = spendingEth ? totalValue : ethers.BigNumber.from(0);
        const callData  = swapRouter.interface.encodeFunctionData("exactInputSingle", [singleParams]);
        const calls     = Array(batchCount).fill(callData);
        const gasLimit  = 400000 * batchCount;
        const txOpts    = spendingEth ? { value: callValue, gasLimit } : { gasLimit };

        // ── Simulate multicall ────────────────────────────────────────────────
        try {
            await swapRouter.callStatic.multicall(calls, { value: callValue, gasLimit });
            actionRows.push({ Action: 'SIMULATE', Detail: `${batchCount}x ${amtInFmt} ${SPEND.toUpperCase()}`, Result: `${GRN}OK${RES}`, Tx: '' });
        } catch (se) {
            const simErr = se.reason || se.data || se.message || 'unknown';
            actionRows.push({ Action: 'SIMULATE', Detail: String(simErr).slice(0, 50), Result: `${RED}FAIL${RES}`, Tx: '' });
            console.error('[SIMULATE ERROR]', {
                reason:  se.reason,
                message: se.message,
                data:    se.data,
                code:    se.code,
                tokenIn, tokenOut, fee_tier,
                amountIn: amountIn.toString(),
                router:   swapRouter.address,
                wallet:   wallet.address
            });
            actionRows.forEach(r => { if (r.Tx === undefined) r.Tx = ''; });
            return [{ title: 'MARKET-TAKER', rows: statusRows, color: CYA },
                    { title: 'MARKET-TAKER ACTIONS', rows: actionRows, color: GRN }];
        }

        // ── Execute ───────────────────────────────────────────────────────────
        try {
            const tx = await swapRouter.multicall(calls, txOpts);
            await tx.wait();

            const fullUrl   = `${config.network.block_explorer}/${tx.hash}`;
            const shortUrl  = `${config.network.block_explorer.replace(/^https?:\/\//, '')}/${tx.hash.slice(0, 10)}...${tx.hash.slice(-6)}`;
            const txLinkStr = config.network.block_explorer
                ? `\x1b]8;;${fullUrl}\x1b\\\x1b[4m↗ ${shortUrl}\x1b[24m\x1b]8;;\x1b\\`
                : '';

            totalSpent += increment * batchCount;
            actionRows.push({
                Action: acquiring === "KILL" ? 'BUY KILL' : 'SELL KILL',
                Detail: `${batchCount}x ${increment} ${SPEND.toUpperCase()} @ ${fmtPrice(killPriceUsd)}`,
                Result: `${GRN}OK${RES}`,
                Tx: txLinkStr
            });
        } catch (e) {
            const errDetail = e.reason || (e.data ? `data=${e.data}` : null) || e.message || 'unknown';
            actionRows.push({ Action: 'EXECUTE', Detail: String(errDetail).slice(0, 50), Result: `${RED}FAIL${RES}`, Tx: '' });
            console.error('[EXECUTE ERROR]', {
                reason:  e.reason,
                message: e.message,
                data:    e.data,
                code:    e.code
            });
        }

        actionRows.forEach(r => { if (r.Tx === undefined) r.Tx = ''; });
        return [
            { title: 'MARKET-TAKER', rows: statusRows, color: CYA },
            { title: 'MARKET-TAKER ACTIONS', rows: actionRows, color: GRN }
        ];
    }
};
