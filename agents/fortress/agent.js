const { ethers } = require("hardhat");
const fs = require("fs");
const path = require("path");
require("dotenv").config();

async function countdown(seconds) {
    for (let i = seconds; i > 0; i--) {
        process.stdout.write(`\r[WAIT] Next scan in ${i}s... `);
        await new Promise(r => setTimeout(r, 1000));
    }
    process.stdout.write('\r\x1b[K'); // Clear line after countdown
}

async function main() {
    // 1. IDENTITY SETUP
    if (!process.env.FORTRESS_PK) {
        throw new Error("Missing FORTRESS_PK in .env file");
    }
    
    const wallet = new ethers.Wallet(process.env.FORTRESS_PK, ethers.provider);
    const address = wallet.address;

    // 2. CONFIG & CONTRACTS
    const config = JSON.parse(fs.readFileSync(path.join(__dirname, "config.json"), "utf8"));
    const { kill_game_addr, multicall_addr } = config.network;
    const { HUB_STACK, TARGET_UNITS, REPLENISH_AMT, REAPER_MULTIPLE, NEIGHBORS, LOOP_DELAY_SECONDS } = config.settings;

    const killGame = await ethers.getContractAt("KILLGame", kill_game_addr);
    const multicall = new ethers.Contract(
        multicall_addr, 
        ["function aggregate(tuple(address target, bytes callData)[] calls) public view returns (uint256 blockNumber, bytes[] returnData)"], 
        wallet
    );

    const TOPUP_THRESHOLD = TARGET_UNITS - REPLENISH_AMT;

    while (true) {
        console.clear();
        console.log(`\n--- FORTRESS AGENT ONLINE ---`);
        console.log(`HUB: ${HUB_STACK} | OPERATING AS: ${address}\n`);

        try {
            // 3. SCANNING
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

            // 4. TACTICAL EXECUTION
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
                
                const items = await killGame.getFullStack(raid.id);
                const me = items.find(it => it.occupant.toLowerCase() === address.toLowerCase());
                if (me) {
                    await (await killGame.connect(wallet).kill(raid.target.occupant, raid.id, me.units.sub(1), me.reapers, { gasLimit: 800000 })).wait();
                }
            }

            // 5. UI
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