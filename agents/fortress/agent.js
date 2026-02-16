const { ethers } = require("hardhat");
const fs = require("fs");
const path = require("path");
require("dotenv").config();


//hardhat run agents/fortress/agent.js --network basesepolia
async function countdown(seconds) {
    for (let i = seconds; i > 0; i--) {
        process.stdout.write(`\r[WAIT] Next scan in ${i}s... `);
        await new Promise(r => setTimeout(r, 1000));
    }
    process.stdout.write('\r\x1b[K');
}

function getNeighbors(hubId) {
    const neighbors = [];
    const checkAdjacent = (c1, c2) => {
        const v1 = c1 - 1; 
        const v2 = c2 - 1;
        const x1 = v1 % 6; const y1 = Math.floor(v1 / 6) % 6; const z1 = Math.floor(v1 / 36);
        const x2 = v2 % 6; const y2 = Math.floor(v2 / 6) % 6; const z2 = Math.floor(v2 / 36);
        const dist = Math.abs(x1 - x2) + Math.abs(y1 - y2) + Math.abs(z1 - z2);
        return dist === 1;
    };
    for (let i = 1; i <= 216; i++) {
        if (i === hubId) continue;
        if (checkAdjacent(hubId, i)) neighbors.push(i);
    }
    return neighbors;
}

async function main() {
    if (!process.env.FORTRESS_PK) throw new Error("Missing FORTRESS_PK in .env file");
    
    const wallet = new ethers.Wallet(process.env.FORTRESS_PK, ethers.provider);
    const address = wallet.address;

    const configPath = path.join(__dirname, "config.json");
    const config = JSON.parse(fs.readFileSync(configPath, "utf8"));
    const { kill_game_addr, multicall_addr } = config.network;
    const { HUB_STACK, TARGET_UNITS, REPLENISH_AMT, REAPER_MULTIPLE, LOOP_DELAY_SECONDS } = config.settings;

    // Initialize Game Contract
    const killGame = await ethers.getContractAt("KILLGame", kill_game_addr);
    
    // Automatically fetch Token Address from Game Contract to prevent "undefined" errors
    console.log("[INITIALIZING] Fetching token address from contract...");
    const killTokenAddr = await killGame.killToken(); 
    const killToken = await ethers.getContractAt("@openzeppelin/contracts/token/ERC20/IERC20.sol:IERC20", killTokenAddr);

    const multicall = new ethers.Contract(
        multicall_addr, 
        ["function aggregate(tuple(address target, bytes callData)[] calls) public view returns (uint256 blockNumber, bytes[] returnData)"], 
        wallet
    );

    // --- AUTO-APPROVAL CHECK ---
    const allowance = await killToken.allowance(address, kill_game_addr);
    if (allowance.lt(ethers.utils.parseEther("1000000"))) {
        console.log("[MAINTENANCE] Allowance low. Approving KILLGame...");
        const tx = await killToken.connect(wallet).approve(kill_game_addr, ethers.constants.MaxUint256);
        await tx.wait();
        console.log("[SUCCESS] Unlimited allowance granted.");
    }

    const TOPUP_THRESHOLD = TARGET_UNITS - REPLENISH_AMT;
    const NEIGHBORS = getNeighbors(HUB_STACK);

    while (true) {
        console.clear();
        console.log(`\n--- FORTRESS AGENT ONLINE ---`);
        console.log(`HUB: ${HUB_STACK} | OPERATING AS: ${address}`);
        console.log(`TOKEN: ${killTokenAddr}`);
        console.log(`PERIMETER: [${NEIGHBORS.join(", ")}]\n`);

        try {
            const scanIds = [HUB_STACK, ...NEIGHBORS];
            const calls = scanIds.map(id => ({
                target: kill_game_addr,
                callData: killGame.interface.encodeFunctionData("getFullStack", [id])
            }));

            const [, returnData] = await multicall.aggregate(calls);
            let hubState = { self: null, enemies: [] };
            let neighborData = [];
            let neighborEnemies = [];
            let friendliesToConsolidate = [];

            for (let i = 0; i < returnData.length; i++) {
                const stackId = scanIds[i];
                const items = killGame.interface.decodeFunctionResult("getFullStack", returnData[i])[0];
                const self = items.find(it => it.occupant.toLowerCase() === address.toLowerCase());
                const enemies = items.filter(it => it.occupant.toLowerCase() !== address.toLowerCase() && (it.units.gt(0) || it.reapers.gt(0)));

                if (stackId === HUB_STACK) {
                    hubState.self = self;
                    hubState.enemies = enemies;
                } else {
                    neighborData.push({
                        Stack: stackId,
                        EnemyUnits: enemies.reduce((a, b) => a.add(b.units), ethers.BigNumber.from(0)).toString(),
                        MyUnits: self ? self.units.toString() : "0",
                        Status: enemies.length > 0 ? "TARGET" : (self ? "STRAGGLER" : "CLEAR")
                    });
                    
                    if (enemies.length > 0) neighborEnemies.push({ id: stackId, target: enemies[0] });
                    if (self && enemies.length === 0 && (self.units.gt(0) || self.reapers.gt(0))) {
                        friendliesToConsolidate.push({ id: stackId, units: self.units, reapers: self.reapers });
                    }
                }
            }

            const currentHubUnits = hubState.self ? hubState.self.units.toNumber() : 0;

            // STRATEGY
            if (friendliesToConsolidate.length > 0) {
                const f = friendliesToConsolidate[0];
                console.log(`[CONSOLIDATE] Returning ${f.units.toString()} from Stack ${f.id}`);
                await (await killGame.connect(wallet).move(f.id, HUB_STACK, f.units, f.reapers, { gasLimit: 500000 })).wait();
            } 
            else if (currentHubUnits <= TOPUP_THRESHOLD) {
                const amt = currentHubUnits === 0 ? TARGET_UNITS : REPLENISH_AMT;
                console.log(`[MAINTENANCE] Spawning ${amt}...`);
                await (await killGame.connect(wallet).spawn(HUB_STACK, amt, { gasLimit: 800000 })).wait();
            } 
            else if (hubState.enemies.length > 0) {
                const target = hubState.enemies[0];
                console.log(`[DEFEND] Purging Hub...`);
                await (await killGame.connect(wallet).kill(target.occupant, HUB_STACK, hubState.self.units.sub(1), hubState.self.reapers, { gasLimit: 800000 })).wait();
            } 
            else if (neighborEnemies.length > 0 && currentHubUnits > (TARGET_UNITS / 2)) {
                const raid = neighborEnemies[0];
                const targetPower = raid.target.units.add(raid.target.reapers.mul(REAPER_MULTIPLE));
                let moveUnits = targetPower.mul(3);
                if (moveUnits.gt(hubState.self.units.sub(1))) moveUnits = hubState.self.units.sub(1);

                console.log(`[RAID] Attacking Stack ${raid.id}`);
                await (await killGame.connect(wallet).move(HUB_STACK, raid.id, moveUnits, 0, { gasLimit: 600000 })).wait();
                
                const itemsAfter = await killGame.getFullStack(raid.id);
                const me = itemsAfter.find(it => it.occupant.toLowerCase() === address.toLowerCase());
                if (me && me.units.gt(1)) {
                    await (await killGame.connect(wallet).kill(raid.target.occupant, raid.id, me.units.sub(1), me.reapers, { gasLimit: 800000 })).wait();
                }
            }

            console.log("\n>> HUB STATUS:");
            console.table([{ Hub: HUB_STACK, Units: currentHubUnits.toLocaleString() }]);
            console.log(">> PERIMETER:");
            console.table(neighborData);

        } catch (error) {
            console.error("[FORTRESS ERROR]:", error.message);
        }

        await countdown(LOOP_DELAY_SECONDS);
    }
}

main().catch(console.error);