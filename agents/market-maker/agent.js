const { ethers } = require("hardhat");
const fs = require("fs");
const path = require("path");
require("dotenv").config();

// hardhat run agents/market-maker/agent.js --network basesepolia

const CYA = "\x1b[36m"; const PNK = "\x1b[35m"; const YEL = "\x1b[33m";
const GRN = "\x1b[32m"; const RED = "\x1b[31m"; const RES = "\x1b[0m";

// ── Minimal ABIs ──────────────────────────────────────────────────────────────

const ERC20_ABI = [
    "function balanceOf(address) view returns (uint256)",
    "function allowance(address, address) view returns (uint256)",
    "function approve(address, uint256) returns (bool)"
];

const WETH_ABI = [
    "function deposit() payable",
    "function approve(address, uint256) returns (bool)",
    "function allowance(address, address) view returns (uint256)",
    "function balanceOf(address) view returns (uint256)"
];

const POOL_ABI = [
    "function slot0() view returns (uint160 sqrtPriceX96, int24 tick, uint16, uint16, uint16, uint8, bool)",
    "event Swap(address indexed sender, address indexed recipient, int256 amount0, int256 amount1, uint160 sqrtPriceX96, uint128 liquidity, int24 tick)"
];

const POSITION_MANAGER_ABI = [
    "function balanceOf(address owner) view returns (uint256)",
    "function tokenOfOwnerByIndex(address owner, uint256 index) view returns (uint256)",
    "function positions(uint256 tokenId) view returns (uint96 nonce, address operator, address token0, address token1, uint24 fee, int24 tickLower, int24 tickUpper, uint128 liquidity, uint256 feeGrowthInside0LastX128, uint256 feeGrowthInside1LastX128, uint128 tokensOwed0, uint128 tokensOwed1)",
    "function mint((address token0, address token1, uint24 fee, int24 tickLower, int24 tickUpper, uint256 amount0Desired, uint256 amount1Desired, uint256 amount0Min, uint256 amount1Min, address recipient, uint256 deadline)) returns (uint256 tokenId, uint128 liquidity, uint256 amount0, uint256 amount1)",
    "function increaseLiquidity((uint256 tokenId, uint256 amount0Desired, uint256 amount1Desired, uint256 amount0Min, uint256 amount1Min, uint256 deadline)) returns (uint128 liquidity, uint256 amount0, uint256 amount1)",
    "function decreaseLiquidity((uint256 tokenId, uint128 liquidity, uint256 amount0Min, uint256 amount1Min, uint256 deadline)) returns (uint256 amount0, uint256 amount1)",
    "function collect((uint256 tokenId, address recipient, uint128 amount0Max, uint128 amount1Max)) returns (uint256 amount0, uint256 amount1)"
];

// ── Math helpers ──────────────────────────────────────────────────────────────

function priceToTick(price, spacing) {
    const raw = Math.floor(Math.log(price) / Math.log(1.0001));
    return Math.round(raw / spacing) * spacing;
}

function tickToPrice(tick) {
    return Math.pow(1.0001, tick);
}

function buildTickRange(killAddr, wethAddr, mcapMin, mcapMax, totalSupply, ethPriceUsd, feeSpacing) {
    const token0IsKill = killAddr.toLowerCase() < wethAddr.toLowerCase();
    const priceEthMin = mcapMin / (totalSupply * ethPriceUsd);
    const priceEthMax = mcapMax / (totalSupply * ethPriceUsd);
    let tickLower, tickUpper;
    if (token0IsKill) {
        tickLower = priceToTick(priceEthMin, feeSpacing);
        tickUpper = priceToTick(priceEthMax, feeSpacing);
    } else {
        tickLower = priceToTick(1 / priceEthMax, feeSpacing);
        tickUpper = priceToTick(1 / priceEthMin, feeSpacing);
    }
    tickLower = Math.max(tickLower, -887200);
    tickUpper = Math.min(tickUpper, 887200);
    return { tickLower, tickUpper };
}

// Returns approximate token amounts in a V3 position as human-readable floats.
// token0 = WETH when token0IsKill=false (our current deployment).
function getPositionAmounts(sqrtPriceX96, tickLower, tickUpper, liquidity) {
    const sqrtP = parseFloat(sqrtPriceX96.toString()) / Math.pow(2, 96);
    const sqrtA = Math.sqrt(Math.pow(1.0001, tickLower));
    const sqrtB = Math.sqrt(Math.pow(1.0001, tickUpper));
    const liq   = parseFloat(liquidity.toString());
    let amount0 = 0, amount1 = 0;
    if (sqrtP <= sqrtA) {
        amount0 = liq * (sqrtB - sqrtA) / (sqrtA * sqrtB) / 1e18;
    } else if (sqrtP < sqrtB) {
        amount0 = liq * (sqrtB - sqrtP) / (sqrtP * sqrtB) / 1e18;
        amount1 = liq * (sqrtP - sqrtA) / 1e18;
    } else {
        amount1 = liq * (sqrtB - sqrtA) / 1e18;
    }
    return { amount0, amount1 };
}

// Display last N swaps against the full pool (not just this NFT)
async function displayRecentSwaps(pool, token0IsKill, killPerEth, ethPriceUsd, count = 5) {
    try {
        const events = await pool.queryFilter(pool.filters.Swap(), -10000);
        const recent = events.slice(-count).reverse();
        if (recent.length === 0) {
            console.log("[POOL] No recent swaps in last 10,000 blocks.");
            return;
        }
        const rows = recent.map(e => {
            // amount0: WETH delta (+ = in, - = out), amount1: KILL delta
            const token0In  = e.args.amount0.gt(0);
            // If WETH=token0: token0In means WETH came in → someone bought KILL
            const buyKill   = token0IsKill ? !token0In : token0In;
            const ethAmt    = parseFloat(ethers.utils.formatEther(e.args.amount0.abs()));
            const killAmt   = parseFloat(ethers.utils.formatEther(e.args.amount1.abs()));
            const tickAfter = e.args.tick;
            const priceAfterKillPerEth = token0IsKill
                ? 1 / Math.pow(1.0001, tickAfter)
                : Math.pow(1.0001, tickAfter);
            const killUsd   = (1 / priceAfterKillPerEth) * ethPriceUsd;
            return {
                "Block":     e.blockNumber,
                "Action":    buyKill ? "BUY  KILL" : "SELL KILL",
                "ETH":       (token0IsKill ? killAmt : ethAmt).toFixed(6),
                "KILL":      Math.round(token0IsKill ? ethAmt : killAmt).toLocaleString(),
                "KILL Price": `$${killUsd.toExponential(3)}`
            };
        });
        console.log(`${CYA}── RECENT POOL SWAPS (last ${rows.length}) ──────────────────────────${RES}`);
        console.table(rows);
    } catch (e) {
        console.log(`[POOL] Could not fetch swap history: ${e.message}`);
    }
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
    if (!process.env.MM_PK) throw new Error("Missing MM_PK in .env");

    const wallet = new ethers.Wallet(process.env.MM_PK, ethers.provider);
    console.log(`${CYA}[MARKET-MAKER] Wallet: ${wallet.address}${RES}`);

    const config = JSON.parse(fs.readFileSync(path.join(__dirname, "config.json"), "utf8"));
    const { kill_game_addr, weth_addr, pool_addr, position_manager, fee_tier } = config.network;
    const { ETH_TARGET, KILL_TARGET, TOTAL_SUPPLY, MCAP_MIN_USD, MCAP_MAX_USD, ETH_PRICE_USD, LOOP_DELAY_SECONDS } = config.settings;

    // Resolve kill token from game contract
    const killGame = new ethers.Contract(kill_game_addr, ["function killToken() view returns (address)"], wallet);
    const kill_token_addr = await killGame.killToken();
    console.log(`${CYA}[INFO] KILL Token: ${kill_token_addr}${RES}`);

    const killToken  = new ethers.Contract(kill_token_addr, ERC20_ABI, wallet);
    const weth       = new ethers.Contract(weth_addr, WETH_ABI, wallet);
    const posManager = new ethers.Contract(position_manager, POSITION_MANAGER_ABI, wallet);
    const pool       = new ethers.Contract(pool_addr, POOL_ABI, wallet);

    const token0IsKill = kill_token_addr.toLowerCase() < weth_addr.toLowerCase();
    const [token0, token1] = token0IsKill
        ? [kill_token_addr, weth_addr]
        : [weth_addr, kill_token_addr];

    console.log(`[INFO] Token ordering: token0=${token0IsKill ? "KILL" : "WETH"}, token1=${token0IsKill ? "WETH" : "KILL"}`);
    console.log(`${GRN}[INFO] Pool: ${pool_addr}${RES}`);

    let positionTokenId = null;

    while (true) {
        try {
            const ethBalance  = await wallet.getBalance();
            const killBalance = await killToken.balanceOf(wallet.address);
            const slot0       = await pool.slot0();
            const sqrtPriceX96 = slot0[0];
            const currentTick  = slot0[1];
            const rawPrice = tickToPrice(currentTick);

            // rawPrice = token1/token0. With WETH=token0: rawPrice = KILL/WETH (KILL per 1 ETH).
            // killPerEth: how many KILL per 1 ETH at current price.
            const killPerEth   = token0IsKill ? (1 / rawPrice) : rawPrice;
            const priceEthPerKill = 1 / killPerEth;
            const impliedMcap  = priceEthPerKill * ETH_PRICE_USD * TOTAL_SUPPLY;

            const killPriceUsd = priceEthPerKill * ETH_PRICE_USD;
            console.log(`\n${CYA}── MARKET-MAKER STATUS ─────────────────────────────${RES}`);
            console.table([{
                "ETH Balance":  parseFloat(ethers.utils.formatEther(ethBalance)).toFixed(6),
                "KILL Balance": parseFloat(ethers.utils.formatEther(killBalance)).toLocaleString(),
                "KILL Price":   `$${killPriceUsd.toExponential(3)}`,
                "Implied MCap": `$${impliedMcap.toFixed(0)}`,
                "Position ID":  positionTokenId ?? "none"
            }]);
            await displayRecentSwaps(pool, token0IsKill, killPerEth, ETH_PRICE_USD);


            // ── Recover existing position NFT ──
            if (positionTokenId === null) {
                const nftCount = await posManager.balanceOf(wallet.address);
                if (nftCount.gt(0)) {
                    positionTokenId = (await posManager.tokenOfOwnerByIndex(wallet.address, 0)).toNumber();
                    console.log(`[INFO] Recovered existing position NFT: ${positionTokenId}`);
                }
            }

            let needsOpen = positionTokenId === null;

            // ── Position status, threshold swaps, rebalance check ──
            if (positionTokenId !== null) {
                const pos = await posManager.positions(positionTokenId);
                const { amount0, amount1 } = getPositionAmounts(sqrtPriceX96, pos.tickLower, pos.tickUpper, pos.liquidity);

                // Map amount0/amount1 → posEth/posKill based on token ordering
                const posEth  = token0IsKill ? amount1 : amount0;
                const posKill = token0IsKill ? amount0 : amount1;

                console.log(`${CYA}── POSITION #${positionTokenId} ────────────────────────────${RES}`);
                console.table([{
                    "Pos ETH":    posEth.toFixed(6),
                    "Pos KILL":   Math.round(posKill).toLocaleString(),
                    "ETH Target": ETH_TARGET,
                    "KILL Target": parseFloat(KILL_TARGET).toLocaleString(),
                    "Ticks":      `[${pos.tickLower}, ${pos.tickUpper}]`,
                    "Liquidity":  pos.liquidity.toString().slice(0, 12) + "..."
                }]);

                const inRange = currentTick >= pos.tickLower && currentTick <= pos.tickUpper;
                console.log(`[RANGE] Ticks: [${pos.tickLower}, ${pos.tickUpper}] | Current: ${currentTick} | ${inRange ? `${GRN}IN RANGE${RES}` : `${YEL}OUT OF RANGE${RES}`}`);

                // ── Top up ETH if below target and position is in range ──
                if (posEth < parseFloat(ETH_TARGET)) {
                    if (!inRange) {
                        console.log(`${YEL}[TOP-UP] ETH low (${posEth.toFixed(6)}) but position is out of range — V3 cannot accept ETH here. Waiting.${RES}`);
                    } else {
                        const killBal   = await killToken.balanceOf(wallet.address);
                        const wethBal   = await weth.balanceOf(wallet.address);
                        const walletEth = parseFloat(ethers.utils.formatEther(await wallet.getBalance()));
                        const GAS_RESERVE = 0.005;
                        const ethToAdd  = parseFloat(ETH_TARGET) - posEth;
                        const MIN_KILL  = ethers.utils.parseUnits("1000", 18);

                        console.log(`[TOP-UP] killBal=${ethers.utils.formatEther(killBal)} KILL  wethBal=${ethers.utils.formatEther(wethBal)} WETH`);

                        if (killBal.lt(MIN_KILL)) {
                            console.log(`${RED}[TOP-UP] Wallet KILL too low (${ethers.utils.formatEther(killBal)}) — need ≥1000 KILL.${RES}`);
                        } else if (walletEth + parseFloat(ethers.utils.formatEther(wethBal)) < ethToAdd + GAS_RESERVE) {
                            console.log(`${RED}[TOP-UP] Insufficient ETH (have ${walletEth.toFixed(6)}, need ${(ethToAdd + GAS_RESERVE).toFixed(6)}).${RES}`);
                        } else {
                            const wethBalFloat = parseFloat(ethers.utils.formatEther(wethBal));
                            const toWrap = Math.max(0, ethToAdd - wethBalFloat);
                            const ethInWei = ethers.utils.parseEther(ethToAdd.toFixed(8));
                            console.log(`${YEL}[TOP-UP] Adding ${ethToAdd.toFixed(6)} ETH + KILL to position (wrapping ${toWrap.toFixed(6)} ETH)...${RES}`);
                            if (toWrap > 0) {
                                await (await weth.deposit({ value: ethers.utils.parseEther(toWrap.toFixed(8)) })).wait();
                            }
                            const wethAllow = await weth.allowance(wallet.address, position_manager);
                            if (wethAllow.lt(ethInWei)) {
                                await (await weth.approve(position_manager, ethers.constants.MaxUint256)).wait();
                            }
                            const killAllow = await killToken.allowance(wallet.address, position_manager);
                            if (killAllow.lt(killBal)) {
                                await (await killToken.approve(position_manager, ethers.constants.MaxUint256)).wait();
                            }
                            const [a0Desired, a1Desired] = token0IsKill
                                ? [killBal, ethInWei]
                                : [ethInWei, killBal];
                            const tx = await posManager.increaseLiquidity({
                                tokenId:        positionTokenId,
                                amount0Desired: a0Desired,
                                amount1Desired: a1Desired,
                                amount0Min:     0,
                                amount1Min:     0,
                                deadline:       Math.floor(Date.now() / 1000) + 600
                            }, { gasLimit: 400000 });
                            await tx.wait();
                            console.log(`${GRN}[TOP-UP] Liquidity increased.${RES}`);
                        }
                    }
                } else {
                    console.log(`${GRN}[OK] ETH in position (${posEth.toFixed(6)}) meets target (${ETH_TARGET}).${RES}`);
                }
            }

            // ── Open new position ──
            if (needsOpen) {
                const { tickLower, tickUpper } = buildTickRange(
                    kill_token_addr, weth_addr,
                    MCAP_MIN_USD, MCAP_MAX_USD, TOTAL_SUPPLY, ETH_PRICE_USD, 200
                );
                const ethAmount  = ethers.utils.parseEther(ETH_TARGET.toString());
                const killAmount = ethers.utils.parseEther(KILL_TARGET.toString());

                const killAllow = await killToken.allowance(wallet.address, position_manager);
                if (killAllow.lt(killAmount)) {
                    await (await killToken.approve(position_manager, ethers.constants.MaxUint256)).wait();
                    console.log(`[INFO] KILL approved to position manager.`);
                }
                const wethAllow = await weth.allowance(wallet.address, position_manager);
                if (wethAllow.lt(ethAmount)) {
                    console.log(`[INFO] Wrapping ${ETH_TARGET} ETH → WETH...`);
                    await (await weth.deposit({ value: ethAmount })).wait();
                    await (await weth.approve(position_manager, ethers.constants.MaxUint256)).wait();
                    console.log(`[INFO] WETH approved to position manager.`);
                }

                const [amount0Desired, amount1Desired] = token0IsKill
                    ? [killAmount, ethAmount]
                    : [ethAmount, killAmount];

                console.log(`${PNK}[ACTION] Minting V3 position [${tickLower} → ${tickUpper}]...${RES}`);
                const mintTx = await posManager.mint({
                    token0, token1, fee: fee_tier,
                    tickLower, tickUpper,
                    amount0Desired, amount1Desired,
                    amount0Min: 0, amount1Min: 0,
                    recipient: wallet.address,
                    deadline:  Math.floor(Date.now() / 1000) + 600
                });
                const receipt = await mintTx.wait();
                const transferEvent = receipt.events?.find(e => e.event === "Transfer" && e.args?.from === ethers.constants.AddressZero);
                if (transferEvent) {
                    positionTokenId = transferEvent.args.tokenId.toNumber();
                    console.log(`${GRN}[SUCCESS] Position minted. NFT ID: ${positionTokenId}${RES}`);
                } else {
                    console.log(`${GRN}[SUCCESS] Position minted (tx: ${mintTx.hash}).${RES}`);
                }
            }

        } catch (e) {
            console.error(`${RED}[ERROR] ${e.reason || e.message}${RES}`);
        }

        await countdown(LOOP_DELAY_SECONDS);
    }
}

main().catch(console.error);
