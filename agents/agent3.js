const { ethers } = require("hardhat");

const ERC20_ABI = [
    "function balanceOf(address account) view returns (uint256)", 
    "function approve(address spender, uint256 amount) returns (bool)", 
    "function allowance(address owner, address spender) view returns (uint256)"
];

async function main() {
    const KILL_GAME_ADDR = process.env.KILL_GAME;
    const agent3Wallet = new ethers.Wallet(process.env.AGENT3_PRIVATE_KEY, ethers.provider);
    const address = agent3Wallet.address;

    const killGame = await ethers.getContractAt("KILLGame", KILL_GAME_ADDR);
    const killToken = new ethers.Contract(await killGame.killToken(), ERC20_ABI, agent3Wallet);

    const STACK_A = 179;
    const STACK_B = 178;
    const SPAWN_AMOUNT = 300;
    const wait = () => new Promise(r => setTimeout(r, 12000));

    console.log(`\n--- AGENT3: DYNAMIC UNIT CALCULATOR ---`);

    // 1. Allowance Check
    const allowance = await killToken.allowance(address, KILL_GAME_ADDR);
    const spawnCost = await killGame.SPAWN_COST();
    const totalRequired = spawnCost.mul(SPAWN_AMOUNT);

    if (allowance.lt(totalRequired)) {
        await (await killToken.approve(KILL_GAME_ADDR, ethers.constants.MaxUint256)).wait();
    }

    try {
        // STEP 1: SPAWN
        console.log(`[1/3] Spawning ${SPAWN_AMOUNT} on Stack ${STACK_A}...`);
        const spawnTx = await killGame.connect(agent3Wallet).spawn(STACK_A, SPAWN_AMOUNT, { gasLimit: 1000000 });
        await spawnTx.wait();

        // DYNAMIC CHECK: How many units vs reapers did we actually get?
        // This prevents the "Insufficient units" error if a Reaper was minted
        const actualUnits = await killGame.balanceOf(address, STACK_A);
        const actualReapers = await killGame.balanceOf(address, STACK_A + 216);
        
        console.log(`Inventory: ${actualUnits.toString()} Units, ${actualReapers.toString()} Reapers`);
        console.log("Waiting 12s...");
        await wait();

        // STEP 2: MOVE TO 115
        console.log(`[2/3] Moving to Stack ${STACK_B}...`);
        const move1Tx = await killGame.connect(agent3Wallet).move(
            STACK_A, 
            STACK_B, 
            actualUnits, 
            actualReapers, 
            { gasLimit: 1000000 }
        );
        await move1Tx.wait();

        console.log("Waiting 12s...");
        await wait();

        // STEP 3: MOVE BACK TO 121
        console.log(`[3/3] Moving back to Stack ${STACK_A}...`);
        const move2Tx = await killGame.connect(agent3Wallet).move(
            STACK_B, 
            STACK_A, 
            actualUnits, 
            actualReapers, 
            { gasLimit: 1000000 }
        );
        await move2Tx.wait();

        console.log(`\n[SUCCESS] Sequence Complete.`);
    } catch (error) {
        console.error("\n[EXECUTION ERROR]:", error.message);
        if (error.transactionHash) console.log("Hash:", error.transactionHash);
    }
}

main().catch(console.error);