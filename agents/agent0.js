const { ethers } = require("hardhat");

const MULTICALL_ADDR = "0xcA11bde05977b3631167028862bE2a173976CA11";
const MULTICALL_ABI = ["function aggregate(tuple(address target, bytes callData)[] calls) public view returns (uint256 blockNumber, bytes[] returnData)"];
const ERC20_ABI = ["function balanceOf(address account) view returns (uint256)", "function approve(address spender, uint256 amount) returns (bool)"];

async function main() {
    const KILL_GAME_ADDR = process.env.KILL_GAME;
    const killGame = await ethers.getContractAt("KILLGame", KILL_GAME_ADDR);
    const [owner] = await ethers.getSigners();
    const address = owner.address;
    const multicall = new ethers.Contract(MULTICALL_ADDR, MULTICALL_ABI, ethers.provider);

    const HUB_STACK = 122;
    const TARGET_UNITS = 333333; 
    const REPLENISH_AMT = 33333;
    const TOPUP_THRESHOLD = TARGET_UNITS - REPLENISH_AMT;
    const REAPER_MULTIPLE = 666;
    
    const NEIGHBORS = [121, 123, 116, 128, 86, 158, 158, 86]; 

    console.log(`\n--- AGENT0 ETERNAL FORTRESS (HUB 122): ${address} ---`);

    while (true) {
        try {
            const scanIds = [HUB_STACK, ...NEIGHBORS];
            const calls = scanIds.map(id => ({
                target: KILL_GAME_ADDR,
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

                    if (enemies.length > 0) {
                        neighborEnemies.push({ id: stackId, target: enemies[0] });
                    }
                    // If we have units here and NO enemies, mark for consolidation
                    if (self && enemies.length === 0 && (self.units.gt(0) || self.reapers.gt(0))) {
                        friendliesToConsolidate.push({ id: stackId, units: self.units, reapers: self.reapers });
                    }
                }
            }

            const currentHubUnits = hubState.self ? hubState.self.units.toNumber() : 0;

            // --- 1. CONSOLIDATION (MOVE BACK TO HUB) ---
            for (const friendly of friendliesToConsolidate) {
                console.log(`[CONSOLIDATE] Bringing ${friendly.units.toString()} units home from Stack ${friendly.id}`);
                await (await killGame.connect(owner).move(friendly.id, HUB_STACK, friendly.units, friendly.reapers, { gasLimit: 500000 })).wait();
            }

            // --- 2. MAINTENANCE ---
            if (currentHubUnits === 0 && friendliesToConsolidate.length === 0) {
                console.log(`[INIT] Spawning ${TARGET_UNITS}...`);
                await (await killGame.connect(owner).spawn(HUB_STACK, TARGET_UNITS, { gasLimit: 1000000 })).wait();
            } else if (currentHubUnits <= TOPUP_THRESHOLD) {
                console.log(`[MAINTENANCE] Replenishing ${REPLENISH_AMT}...`);
                await (await killGame.connect(owner).spawn(HUB_STACK, REPLENISH_AMT, { gasLimit: 500000 })).wait();
            }

            // --- 3. HUB DEFENSE ---
            if (hubState.enemies.length > 0) {
                const target = hubState.enemies[0];
                console.log(`[DEFEND] Purging Hub 122...`);
                await (await killGame.connect(owner).kill(target.occupant, HUB_STACK, hubState.self.units.sub(1), hubState.self.reapers, { gasLimit: 800000 })).wait();
            }

            // --- 4. PERIMETER RAID ---
            else if (neighborEnemies.length > 0 && currentHubUnits > 10000) {
                const raid = neighborEnemies[0];
                const targetPower = raid.target.units.add(raid.target.reapers.mul(REAPER_MULTIPLE));
                const requiredUnits = targetPower.mul(3); 
                let moveUnits = requiredUnits.gt(hubState.self.units.div(2)) ? hubState.self.units.div(2) : requiredUnits;

                console.log(`[RAID] Deploying ${moveUnits.toString()} units to Stack ${raid.id}`);
                await (await killGame.connect(owner).move(HUB_STACK, raid.id, moveUnits, 0, { gasLimit: 600000 })).wait();
                await new Promise(r => setTimeout(r, 6000));

                const raidStack = await killGame.getFullStack(raid.id);
                const me = raidStack.find(it => it.occupant.toLowerCase() === address.toLowerCase());
                if (me) {
                    await (await killGame.connect(owner).kill(raid.target.occupant, raid.id, me.units.sub(1), me.reapers, { gasLimit: 800000 })).wait();
                    // Retreat logic happens in the next loop's consolidation if not triggered here
                }
            }

            // --- TABLES ---
            console.log("\n>> HUB STATUS:");
            console.table([{ Hub: HUB_STACK, Units: currentHubUnits.toLocaleString(), Status: currentHubUnits >= TARGET_UNITS ? "FORTIFIED" : "REPLENISHING" }]);
            console.log(">> PERIMETER RADAR:");
            console.table(neighborData);

        } catch (error) {
            console.error("[AGENT0 ERROR]:", error.message);
        }
        await new Promise(r => setTimeout(r, 12000));
    }
}

main().catch(console.error);