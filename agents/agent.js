"use strict";
const { ethers } = require("hardhat");
require("dotenv").config();
const fs   = require("fs");
const path = require("path");

// hardhat run agents/agent.js --network basesepolia

const { CYA, YEL, GRN, RED, RES, ERC20_ABI, FAUCET_ABI, onBlock, displayHeader, displayActivity, loadABI } = require('./common');

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

const SWAP_ROUTER_ABI = [
    "function exactInputSingle((address tokenIn, address tokenOut, uint24 fee, address recipient, uint256 amountIn, uint256 amountOutMinimum, uint160 sqrtPriceLimitX96)) payable returns (uint256 amountOut)",
    "function multicall(bytes[] calldata data) payable returns (bytes[] memory results)"
];

async function main() {
    if (!process.env.AGENT_PK) throw new Error("Missing AGENT_PK in .env");

    const config   = JSON.parse(fs.readFileSync(path.join(__dirname, "common-config.json"), "utf8"));
    const agentStrategy = JSON.parse(fs.readFileSync(path.join(__dirname, "agent-strategy.json"), "utf8"));

    const { BLOCK_DELTA, ETH_PRICE_USD, TOTAL_SUPPLY } = config.settings;
    const { kill_game_addr, kill_faucet_addr, weth_addr, pool_addr, position_manager, swap_router } = config.network;

    const wallet     = new ethers.Wallet(process.env.AGENT_PK, ethers.provider);
    const killGame   = new ethers.Contract(kill_game_addr, loadABI('./data/abi/KILLGame.json'), wallet);
    const killToken  = new ethers.Contract(await killGame.killToken(), ERC20_ABI, wallet);
    const killFaucet = new ethers.Contract(kill_faucet_addr, FAUCET_ABI, wallet);
    const weth       = new ethers.Contract(weth_addr, WETH_ABI, wallet);
    const pool       = new ethers.Contract(pool_addr, POOL_ABI, wallet);
    const posManager = new ethers.Contract(position_manager, POSITION_MANAGER_ABI, wallet);
    const swapRouter = new ethers.Contract(swap_router, SWAP_ROUTER_ABI, wallet);

    const ctx = { wallet, killGame, killToken, killFaucet, weth, pool, posManager, swapRouter, config };

    // Flatten strategy → runs → blocks into an ordered slot list
    const slots = agentStrategy.strategy.flatMap(runName =>
        Object.entries(agentStrategy.runs[runName]).map(([blockName, cap]) => [`${runName}/${blockName}`, cap])
    );

    // Load each unique capability and call init() once if defined
    const capNames = [...new Set(slots.map(([, cap]) => cap))];
    const capabilities = {};
    for (const name of capNames) {
        const mod = require(`./${name}/capability`);
        if (typeof mod.init === 'function') await mod.init(ctx);
        capabilities[name] = mod;
    }

    const capInfos = capNames.map(name => {
        const cfg = JSON.parse(fs.readFileSync(path.join(__dirname, name, 'config.json'), 'utf8'));
        return `${cfg.role}@${cfg.build || 'dev'}`;
    });

    const runSummary = agentStrategy.strategy.map(r => `${r}(${Object.keys(agentStrategy.runs[r]).length})`).join(' → ');

    let slotIndex = 0;
    console.log(`${CYA}[AGENT] Wallet: ${wallet.address}${RES}`);
    console.log(`${CYA}[AGENT] Loaded: ${capInfos.join(' | ')}${RES}`);
    console.log(`${CYA}[AGENT] Strategy: ${runSummary} = ${slots.length} total slots${RES}`);
    console.log(`${CYA}[AGENT] BLOCK_DELTA: ${BLOCK_DELTA}${RES}`);

    onBlock(ethers.provider, BLOCK_DELTA, async (bn) => {
        const [slotName, capName] = slots[slotIndex % slots.length];
        slotIndex++;

        // Each slot can have its own key derived from run/block (e.g. RUN1_BLOCK1_PK); falls back to AGENT_PK
        const slotPkEnv  = `${slotName.replace('/', '_').toUpperCase()}_PK`;
        const slotWallet = new ethers.Wallet(process.env[slotPkEnv] || process.env.AGENT_PK, ethers.provider);
        const slotCtx    = {
            ...ctx,
            wallet:     slotWallet,
            killGame:   killGame.connect(slotWallet),
            killToken:  killToken.connect(slotWallet),
            killFaucet: killFaucet.connect(slotWallet),
            weth:       weth.connect(slotWallet),
            pool:       pool.connect(slotWallet),
            posManager: posManager.connect(slotWallet),
            swapRouter: swapRouter.connect(slotWallet),
            config: {
                ...config,
                settings: { ...config.settings, ...(config.settings[capName] || {}) }
            },
        };

        console.clear();
        await displayHeader({
            title: `AGENT — ${capName}`, bn, wallet: slotWallet, killToken: slotCtx.killToken,
            poolAddr: pool_addr, wethAddr: weth_addr, ETH_PRICE_USD, TOTAL_SUPPLY,
            extra: { Slot: slotName, Next: slots[slotIndex % slots.length][1] }
        });

        try {
            const sections = await capabilities[capName].run({ ...slotCtx, bn });
            if (Array.isArray(sections)) {
                for (const section of sections) displayActivity(section);
            }
        } catch (e) {
            console.error(`${RED}[${capName.toUpperCase()}] ${e.reason || e.message}${RES}`);
        }
    });

    process.on("SIGINT", () => process.exit(0));
}

main().catch(console.error);
