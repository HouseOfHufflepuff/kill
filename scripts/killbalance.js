const { ethers } = require("hardhat");

async function main() {
    const KILL_TOKEN_ADDR = process.env.KILL_TOKEN;
    const KILL_GAME_ADDR = process.env.KILL_GAME;
    
    const KillToken = await ethers.getContractAt("KILLToken", KILL_TOKEN_ADDR);

    const accounts = [
        { name: "Game Contract", addr: KILL_GAME_ADDR },
        { name: "Agent 0 (You)", addr: process.env.PUBLIC_KEY },
        { name: "Agent 1", addr: process.env.AGENT1_PUBLIC_KEY },
        { name: "Agent 2", addr: process.env.AGENT2_PUBLIC_KEY },
        { name: "Agent 3", addr: process.env.AGENT3_PUBLIC_KEY },
        { name: "Agent 4", addr: process.env.AGENT4_PUBLIC_KEY },
        { name: "Agent 5", addr: process.env.AGENT5_PUBLIC_KEY },
    ];

    console.log(`--- KILL TOKEN BALANCE CHECK ---`);
    console.log(`Token Address: ${KILL_TOKEN_ADDR}\n`);

    const results = [];

    for (const acc of accounts) {
        if (!acc.addr || acc.addr === "0x...") {
            results.push({ Account: acc.name, Address: "MISSING", Balance: "N/A" });
            continue;
        }

        try {
            const balance = await KillToken.balanceOf(acc.addr);
            results.push({
                Account: acc.name,
                Address: acc.addr.slice(0, 10) + "...",
                Balance: ethers.utils.formatEther(balance) + " KILL"
            });
        } catch (err) {
            results.push({ Account: acc.name, Address: acc.addr.slice(0, 6), Balance: "ERROR" });
        }
    }
    console.log("done checking balances\n");

    console.table(results);
}

main()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error(error);
        process.exit(1);
    });