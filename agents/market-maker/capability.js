"use strict";
const { ethers } = require("hardhat");
const { CYA, GRN, YEL, RED, PNK, RES } = require('../common');

// ── Math helpers ──────────────────────────────────────────────────────────────

function priceToTick(price, spacing) {
    const raw = Math.floor(Math.log(price) / Math.log(1.0001));
    return Math.round(raw / spacing) * spacing;
}

function tickToPrice(tick) { return Math.pow(1.0001, tick); }

function buildTickRange(killAddr, wethAddr, mcapMin, mcapMax, totalSupply, ethPriceUsd, feeSpacing) {
    const token0IsKill = killAddr.toLowerCase() < wethAddr.toLowerCase();
    const priceEthMin  = mcapMin / (totalSupply * ethPriceUsd);
    const priceEthMax  = mcapMax / (totalSupply * ethPriceUsd);
    let tickLower, tickUpper;
    if (token0IsKill) {
        tickLower = priceToTick(priceEthMin, feeSpacing);
        tickUpper = priceToTick(priceEthMax, feeSpacing);
    } else {
        tickLower = priceToTick(1 / priceEthMax, feeSpacing);
        tickUpper = priceToTick(1 / priceEthMin, feeSpacing);
    }
    return { tickLower: Math.max(tickLower, -887200), tickUpper: Math.min(tickUpper, 887200) };
}

function getPositionAmounts(sqrtPriceX96, tickLower, tickUpper, liquidity) {
    const sqrtP = parseFloat(sqrtPriceX96.toString()) / Math.pow(2, 96);
    const sqrtA = Math.sqrt(Math.pow(1.0001, tickLower));
    const sqrtB = Math.sqrt(Math.pow(1.0001, tickUpper));
    const liq   = parseFloat(liquidity.toString());
    let amount0 = 0, amount1 = 0;
    if (sqrtP <= sqrtA)     { amount0 = liq * (sqrtB - sqrtA) / (sqrtA * sqrtB) / 1e18; }
    else if (sqrtP < sqrtB) { amount0 = liq * (sqrtB - sqrtP) / (sqrtP * sqrtB) / 1e18; amount1 = liq * (sqrtP - sqrtA) / 1e18; }
    else                    { amount1 = liq * (sqrtB - sqrtA) / 1e18; }
    return { amount0, amount1 };
}

// Module-level persistent state
let positionTokenId = null;

module.exports = {
    async run({ wallet, killToken, weth, pool, posManager, config }) {
        const { ETH_TARGET, KILL_TARGET, MCAP_MIN_USD, MCAP_MAX_USD, ETH_PRICE_USD, TOTAL_SUPPLY } = config.settings;
        const { weth_addr, position_manager, fee_tier } = config.network;

        const killTokenAddr = killToken.address;
        const token0IsKill  = killTokenAddr.toLowerCase() < weth_addr.toLowerCase();
        const [token0, token1] = token0IsKill ? [killTokenAddr, weth_addr] : [weth_addr, killTokenAddr];

        const slot0        = await pool.slot0();
        const sqrtPriceX96 = slot0[0];
        const currentTick  = slot0[1];
        const killPerEth   = token0IsKill ? (1 / tickToPrice(currentTick)) : tickToPrice(currentTick);
        const killPriceUsd = (1 / killPerEth) * ETH_PRICE_USD;
        const fmtUsd       = v => v < 0.000001 ? `$${v.toFixed(10)}` : `$${v.toFixed(8)}`;

        // Resolve position ID
        if (positionTokenId === null) {
            const nftCount = await posManager.balanceOf(wallet.address);
            if (nftCount.gt(0)) {
                positionTokenId = (await posManager.tokenOfOwnerByIndex(wallet.address, 0)).toNumber();
            }
        }

        // ── Position status ───────────────────────────────────────────────────
        const posRows    = [];
        const actionRows = [];
        let pos = null, posEth = 0, inRange = false, feeTotalUsd = null;

        if (positionTokenId !== null) {
            pos = await posManager.positions(positionTokenId);
            const { amount0, amount1 } = getPositionAmounts(sqrtPriceX96, pos.tickLower, pos.tickUpper, pos.liquidity);
            posEth  = token0IsKill ? amount1 : amount0;
            inRange = currentTick >= pos.tickLower && currentTick <= pos.tickUpper;

            const MAX_UINT128 = ethers.BigNumber.from(2).pow(128).sub(1);
            const collected   = await posManager.callStatic.collect({ tokenId: positionTokenId, recipient: wallet.address, amount0Max: MAX_UINT128, amount1Max: MAX_UINT128 });
            const feeEth  = parseFloat(ethers.utils.formatEther(token0IsKill ? collected.amount1 : collected.amount0));
            const feeKill = parseFloat(ethers.utils.formatEther(token0IsKill ? collected.amount0 : collected.amount1));
            feeTotalUsd   = feeEth * ETH_PRICE_USD + feeKill * killPriceUsd;

            posRows.push({
                'Pos ID':     String(positionTokenId),
                'ETH in Pos': posEth.toFixed(6),
                'In Range':   inRange ? `${GRN}YES${RES}` : `${RED}NO${RES}`,
                'Fees USD':   fmtUsd(feeTotalUsd),
                'KILL Price': fmtUsd(killPriceUsd)
            });
        } else {
            posRows.push({ 'Pos ID': 'none', 'ETH in Pos': '-', 'In Range': '-', 'Fees USD': '-', 'KILL Price': fmtUsd(killPriceUsd) });
        }

        // ── Top-up if needed ──────────────────────────────────────────────────
        if (pos !== null && posEth < parseFloat(ETH_TARGET)) {
            if (!inRange) {
                actionRows.push({ Action: 'TOP-UP', Detail: `ETH low (${posEth.toFixed(6)}) out of range`, Result: `${YEL}WAIT${RES}` });
            } else {
                const killBal      = await killToken.balanceOf(wallet.address);
                const wethBal      = await weth.balanceOf(wallet.address);
                const walletEth    = parseFloat(ethers.utils.formatEther(await wallet.getBalance()));
                const GAS_RESERVE  = 0.005;
                const ethToAdd     = parseFloat(ETH_TARGET) - posEth;

                if (killBal.lt(ethers.utils.parseUnits("1000", 18))) {
                    actionRows.push({ Action: 'TOP-UP', Detail: `KILL too low (${ethers.utils.formatEther(killBal)})`, Result: `${RED}SKIP${RES}` });
                } else if (walletEth + parseFloat(ethers.utils.formatEther(wethBal)) < ethToAdd + GAS_RESERVE) {
                    actionRows.push({ Action: 'TOP-UP', Detail: `Insufficient ETH (have ${walletEth.toFixed(4)})`, Result: `${RED}SKIP${RES}` });
                } else {
                    const toWrap   = Math.max(0, ethToAdd - parseFloat(ethers.utils.formatEther(wethBal)));
                    const ethInWei = ethers.utils.parseEther(ethToAdd.toFixed(8));
                    if (toWrap > 0) await (await weth.deposit({ value: ethers.utils.parseEther(toWrap.toFixed(8)) })).wait();
                    await (await weth.approve(position_manager, ethers.constants.MaxUint256)).wait();
                    await (await killToken.approve(position_manager, ethers.constants.MaxUint256)).wait();
                    const [a0, a1] = token0IsKill ? [killBal, ethInWei] : [ethInWei, killBal];
                    const tx = await posManager.increaseLiquidity({ tokenId: positionTokenId, amount0Desired: a0, amount1Desired: a1, amount0Min: 0, amount1Min: 0, deadline: Math.floor(Date.now() / 1000) + 600 }, { gasLimit: 400000 });
                    await tx.wait();
                    const fullUrl   = `${config.network.block_explorer}/${tx.hash}`;
                    const shortUrl  = `${config.network.block_explorer.replace(/^https?:\/\//, '')}/${tx.hash.slice(0, 10)}...${tx.hash.slice(-6)}`;
                    const txLinkStr = config.network.block_explorer ? `\x1b]8;;${fullUrl}\x1b\\\x1b[4m↗ ${shortUrl}\x1b[24m\x1b]8;;\x1b\\` : '';
                    actionRows.push({ Action: 'TOP-UP', Detail: `Added ${ethToAdd.toFixed(6)} ETH`, Result: `${GRN}OK${RES}`, Tx: txLinkStr });
                }
            }
        }

        // ── Mint new position if none ─────────────────────────────────────────
        if (positionTokenId === null) {
            const { tickLower, tickUpper } = buildTickRange(killTokenAddr, weth_addr, MCAP_MIN_USD, MCAP_MAX_USD, TOTAL_SUPPLY, ETH_PRICE_USD, 200);
            const ethAmtWei  = ethers.utils.parseEther(ETH_TARGET.toString());
            const killAmtWei = ethers.utils.parseEther(KILL_TARGET.toString());
            await (await killToken.approve(position_manager, ethers.constants.MaxUint256)).wait();
            await (await weth.deposit({ value: ethAmtWei })).wait();
            await (await weth.approve(position_manager, ethers.constants.MaxUint256)).wait();
            const [a0, a1] = token0IsKill ? [killAmtWei, ethAmtWei] : [ethAmtWei, killAmtWei];
            const mintTx   = await posManager.mint({ token0, token1, fee: fee_tier, tickLower, tickUpper, amount0Desired: a0, amount1Desired: a1, amount0Min: 0, amount1Min: 0, recipient: wallet.address, deadline: Math.floor(Date.now() / 1000) + 600 });
            const receipt  = await mintTx.wait();
            const mintFullUrl = `${config.network.block_explorer}/${mintTx.hash}`;
            const mintShortUrl = `${config.network.block_explorer.replace(/^https?:\/\//, '')}/${mintTx.hash.slice(0, 10)}...${mintTx.hash.slice(-6)}`;
            const mintLink = config.network.block_explorer ? `\x1b]8;;${mintFullUrl}\x1b\\\x1b[4m↗ ${mintShortUrl}\x1b[24m\x1b]8;;\x1b\\` : '';
            const event    = receipt.events?.find(e => e.event === "Transfer" && e.args?.from === ethers.constants.AddressZero);
            if (event) {
                positionTokenId = event.args.tokenId.toNumber();
                actionRows.push({ Action: 'MINT', Detail: `Pos ID: ${positionTokenId} | [${tickLower} → ${tickUpper}]`, Result: `${GRN}OK${RES}`, Tx: mintLink });
            }
        }

        // ── Recent swaps ──────────────────────────────────────────────────────
        const swapRows = [];
        try {
            const feeRate = fee_tier / 1_000_000;
            const events  = await pool.queryFilter(pool.filters.Swap(), -10000);
            events.slice(-10).reverse().forEach(e => {
                const token0In   = e.args.amount0.gt(0);
                const buyKill    = token0IsKill ? !token0In : token0In;
                const ethAmt     = parseFloat(ethers.utils.formatEther(e.args.amount0.abs()));
                const killAmt    = parseFloat(ethers.utils.formatEther(e.args.amount1.abs()));
                const priceAfter = token0IsKill ? 1 / Math.pow(1.0001, e.args.tick) : Math.pow(1.0001, e.args.tick);
                const killUsd    = (1 / priceAfter) * ETH_PRICE_USD;
                const feeUsd     = buyKill ? ethAmt * feeRate * ETH_PRICE_USD : killAmt * feeRate * killUsd;
                swapRows.push({
                    'Block':   e.blockNumber.toString(),
                    'Action':  `${buyKill ? GRN : PNK}${buyKill ? 'BUY' : 'SELL'}${RES}`,
                    'ETH':     (token0IsKill ? killAmt : ethAmt).toFixed(6),
                    'KILL':    Math.round(token0IsKill ? ethAmt : killAmt).toLocaleString(),
                    'Fee USD': `$${feeUsd < 0.0001 ? feeUsd.toExponential(2) : feeUsd.toFixed(6)}`
                });
            });
        } catch (_) { /* swap history is display-only; ignore errors */ }

        actionRows.forEach(r => { if (r.Tx === undefined) r.Tx = ''; });
        const sections = [{ title: 'POSITION', rows: posRows, color: CYA }];
        if (actionRows.length > 0) sections.push({ title: 'MARKET-MAKER ACTIONS', rows: actionRows, color: GRN });
        if (swapRows.length > 0)   sections.push({ title: 'RECENT POOL SWAPS', rows: swapRows, color: CYA });
        return sections;
    }
};
