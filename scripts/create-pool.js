// Uniswap V3 — Create & Initialize KILL/WETH Pool on Base
// Run: hardhat run scripts/create-pool.js --network base
//
// This is a one-time setup script. Once the pool exists the market-maker
// agent handles all liquidity operations.

require("dotenv").config();
const { ethers } = require("hardhat");

const ETH        = "0.02";          // ETH to deposit as initial liquidity
const KILL       = "10000000";      // KILL to deposit as initial liquidity (10M)

const KILL_TOKEN  = process.env.KILL_TOKEN;
const FEE_TIER    = 10000; // 1%

// WETH is the canonical address on both Base mainnet and Base Sepolia
const WETH = "0x4200000000000000000000000000000000000006";

// Uniswap V3 addresses differ by network — resolved at runtime from chainId
const NETWORKS = {
    8453: {  // Base mainnet
        name: "base",
        factory:         "0x33128a8fC17869897dcE68Ed026d694621f6FDfD",
        positionManager: "0x03a520b32C04BF3bEEf7BEb72E919cf822Ed34f1",
    },
    84532: { // Base Sepolia
        name: "basesepolia",
        factory:         "0x4752ba5DBc23f44D87826276BF6Fd6b1C372aD24",
        positionManager: "0x27F971cb582BF9E50F397e4d29a5C7A34f11faA2",
    },
};

// Starting market cap for pool initialization (USD).
// Set to a conservative value — liquidity providers set the real price.
const STARTING_MCAP_USD = 10_000;
const TOTAL_SUPPLY      = 666_000_000_000;
const ETH_PRICE_USD     = parseFloat(process.env.ETH_PRICE_USD || "2500");
const MCAP_MIN_USD      = 1_000;
const MCAP_MAX_USD      = 10_000_000;
const TICK_SPACING      = 200;

const FACTORY_ABI = [
    "function createPool(address tokenA, address tokenB, uint24 fee) returns (address pool)",
    "function getPool(address tokenA, address tokenB, uint24 fee) view returns (address pool)"
];

const POOL_ABI = [
    "function initialize(uint160 sqrtPriceX96)",
    "function slot0() view returns (uint160 sqrtPriceX96, int24 tick, uint16, uint16, uint16, uint8, bool)"
];

const ERC20_ABI = [
    "function approve(address spender, uint256 amount) returns (bool)",
    "function allowance(address owner, address spender) view returns (uint256)"
];

const WETH_ABI = [
    "function deposit() payable",
    "function approve(address spender, uint256 amount) returns (bool)",
    "function allowance(address owner, address spender) view returns (uint256)"
];

const POSITION_MANAGER_ABI = [
    "function mint((address token0, address token1, uint24 fee, int24 tickLower, int24 tickUpper, uint256 amount0Desired, uint256 amount1Desired, uint256 amount0Min, uint256 amount1Min, address recipient, uint256 deadline)) returns (uint256 tokenId, uint128 liquidity, uint256 amount0, uint256 amount1)"
];

// sqrtPriceX96 = sqrt(price) * 2^96
// price = token1 / token0 (raw units; both tokens use 18 decimals so ratio is 1:1)
function toSqrtPriceX96(price) {
    const Q96 = 2n ** 96n;
    const sqrtPrice = Math.sqrt(price);
    return BigInt(Math.floor(sqrtPrice * Number(Q96)));
}

async function main() {
    if (!KILL_TOKEN) throw new Error("KILL_TOKEN not set in .env");

    const [deployer] = await ethers.getSigners();
    const { chainId } = await ethers.provider.getNetwork();
    const net = NETWORKS[chainId];
    if (!net) throw new Error(`Unsupported chainId ${chainId}. Add it to NETWORKS.`);

    console.log(`[INFO] Network:  ${net.name} (chainId ${chainId})`);
    console.log(`[INFO] Deployer: ${deployer.address}`);
    console.log(`[INFO] KILL:     ${KILL_TOKEN}`);
    console.log(`[INFO] Fee tier: ${FEE_TIER / 10000}%`);

    const factory = new ethers.Contract(net.factory, FACTORY_ABI, deployer);

    // ── 1. Check if pool already exists ──────────────────────────────────────
    let poolAddr = await factory.getPool(KILL_TOKEN, WETH, FEE_TIER);
    if (poolAddr !== ethers.constants.AddressZero) {
        console.log(`[INFO] Pool already exists: ${poolAddr}`);
    } else {
        console.log(`[ACTION] Creating pool...`);
        const tx = await factory.createPool(KILL_TOKEN, WETH, FEE_TIER);
        const receipt = await tx.wait();
        poolAddr = await factory.getPool(KILL_TOKEN, WETH, FEE_TIER);
        console.log(`[SUCCESS] Pool created: ${poolAddr} (tx: ${tx.hash})`);
    }

    // ── 2. Check if pool is already initialized ───────────────────────────────
    const pool = new ethers.Contract(poolAddr, POOL_ABI, deployer);
    const slot0 = await pool.slot0();
    if (!slot0.sqrtPriceX96.isZero()) {
        console.log(`[INFO] Pool already initialized. sqrtPriceX96: ${slot0.sqrtPriceX96.toString()}`);
        console.log(`[INFO] Nothing to do.`);
        return;
    }

    // ── 3. Compute initial sqrtPriceX96 ──────────────────────────────────────
    // price in ETH per KILL at the starting market cap
    const priceEthPerKill = STARTING_MCAP_USD / (TOTAL_SUPPLY * ETH_PRICE_USD);
    console.log(`[INFO] Starting price: ${priceEthPerKill.toExponential(4)} ETH/KILL ($${STARTING_MCAP_USD} mcap @ $${ETH_PRICE_USD} ETH)`);

    // Determine token ordering (Uniswap sorts by address)
    const token0IsKill = KILL_TOKEN.toLowerCase() < WETH.toLowerCase();
    const price = token0IsKill ? priceEthPerKill : 1 / priceEthPerKill;
    const sqrtPriceX96 = toSqrtPriceX96(price);

    console.log(`[INFO] token0 = ${token0IsKill ? "KILL" : "WETH"}`);
    console.log(`[INFO] sqrtPriceX96: ${sqrtPriceX96.toString()}`);

    // ── 4. Initialize the pool ────────────────────────────────────────────────
    console.log(`[ACTION] Initializing pool...`);
    const initTx = await pool.initialize(sqrtPriceX96.toString());
    await initTx.wait();
    console.log(`[SUCCESS] Pool initialized. tx: ${initTx.hash}`);

    // ── 5. Seed initial liquidity ─────────────────────────────────────────────
    const ethAmount  = ethers.utils.parseEther(ETH);
    const killAmount = ethers.utils.parseEther(KILL);

    // Compute tick range from market cap bounds
    const priceEthMin = MCAP_MIN_USD / (TOTAL_SUPPLY * ETH_PRICE_USD);
    const priceEthMax = MCAP_MAX_USD / (TOTAL_SUPPLY * ETH_PRICE_USD);

    let tickLower, tickUpper;
    if (token0IsKill) {
        tickLower = Math.round(Math.floor(Math.log(priceEthMin) / Math.log(1.0001)) / TICK_SPACING) * TICK_SPACING;
        tickUpper = Math.round(Math.floor(Math.log(priceEthMax) / Math.log(1.0001)) / TICK_SPACING) * TICK_SPACING;
    } else {
        tickLower = Math.round(Math.floor(Math.log(1 / priceEthMax) / Math.log(1.0001)) / TICK_SPACING) * TICK_SPACING;
        tickUpper = Math.round(Math.floor(Math.log(1 / priceEthMin) / Math.log(1.0001)) / TICK_SPACING) * TICK_SPACING;
    }
    tickLower = Math.max(tickLower, -887200);
    tickUpper = Math.min(tickUpper,  887200);

    console.log(`[INFO] Liquidity range: ticks [${tickLower}, ${tickUpper}]`);
    console.log(`[INFO] Depositing: ${ETH} ETH + ${Number(KILL).toLocaleString()} KILL`);

    // Wrap ETH → WETH
    const weth = new ethers.Contract(WETH, WETH_ABI, deployer);
    console.log(`[ACTION] Wrapping ${ETH} ETH → WETH...`);
    const wrapTx = await weth.deposit({ value: ethAmount });
    await wrapTx.wait();

    // Approve both tokens to position manager
    const killContract = new ethers.Contract(KILL_TOKEN, ERC20_ABI, deployer);
    const appKillTx = await killContract.approve(net.positionManager, ethers.constants.MaxUint256);
    await appKillTx.wait();
    const appWethTx = await weth.approve(net.positionManager, ethers.constants.MaxUint256);
    await appWethTx.wait();
    console.log(`[INFO] Approvals set.`);

    const [amount0Desired, amount1Desired] = token0IsKill
        ? [killAmount, ethAmount]
        : [ethAmount, killAmount];

    const posManager = new ethers.Contract(net.positionManager, POSITION_MANAGER_ABI, deployer);
    console.log(`[ACTION] Minting initial V3 position...`);
    const mintTx = await posManager.mint({
        token0: token0IsKill ? KILL_TOKEN : WETH,
        token1: token0IsKill ? WETH : KILL_TOKEN,
        fee: FEE_TIER,
        tickLower,
        tickUpper,
        amount0Desired,
        amount1Desired,
        amount0Min: 0,
        amount1Min: 0,
        recipient: deployer.address,
        deadline: Math.floor(Date.now() / 1000) + 600
    });
    await mintTx.wait();
    console.log(`[SUCCESS] Initial liquidity minted. tx: ${mintTx.hash}`);
    console.log(`\nPool address (save this): ${poolAddr}`);
    console.log(`Run the market-maker agent: hardhat run agents/market-maker/agent.js --network base`);
}

main().catch(e => {
    console.error(e);
    process.exit(1);
});
