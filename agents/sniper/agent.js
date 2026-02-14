const { ethers } = require("hardhat");
const fs = require("fs");
const path = require("path");

const MULTICALL_ABI = ["function aggregate(tuple(address target, bytes callData)[] calls) public view returns (uint256 blockNumber, bytes[] returnData)"];

async function main() {
    // Load Config (assumes config.json exists in sniper directory)
    const configPath = path.join(__dirname, "config.json");
    const config = JSON.parse(fs.readFileSync(configPath, "utf8"));
    
    const { kill_game_addr, multicall_addr } = config.network;
    const { SNIPER_TARGETS, HUB_STACK, MIN_SNIPE_THRESHOLD } = config.settings;

    const killGame = await ethers.getContractAt("KILLGame", kill_game_addr);
    const [owner] = await ethers.getSigners();
    const address = owner.address;
    const multicall = new ethers.Contract(multicall_addr, MULTICALL_ABI, ethers.provider);

    console.log(`\n--- SNIPER AGENT ONLINE: ${address} ---`);

    while (true) {
        try {
            const calls = SNIPER_TARGETS.map(id => ({
                target: kill_game_addr,
                callData: killGame.interface.encodeFunctionData("getFullStack", [id])
            }));

            const [, returnData] = await multicall.aggregate(calls);
            let targetFound = null;
            let stragglers = [];

            for (let i = 0; i < returnData.length; i++) {
                const stackId = SNIPER_TARGETS[i];
                const items = killGame.interface.decodeFunctionResult("getFullStack", returnData[i])[0];
                const self = items.find(it => it.occupant.toLowerCase() === address.toLowerCase());
                const enemies = items.filter(it => it.occupant.toLowerCase() !== address.toLowerCase() && it.units.gt(MIN_SNIPE_THRESHOLD));

                if (enemies.length > 0 && !targetFound) {
                    targetFound = { id: stackId, enemy: enemies[0], self };
                } else if (self && self.units.gt(0)) {
                    stragglers.push({ id: stackId, units: self.units, reapers: self.reapers });
                }
            }

            // 1. Target Engagement
            if (targetFound) {
                if (!targetFound.self || targetFound.self.units.eq(0)) {
                    const spawnAmt = targetFound.enemy.units.add(200);
                    console.log(`[SNIPE] Spawning ${spawnAmt.toString()} on Stack ${targetFound.id}`);
                    await (await killGame.connect(owner).spawn(targetFound.id, spawnAmt, { gasLimit: 800000 })).wait();
                } else {
                    console.log(`[SNIPE] Executing kill on Stack ${targetFound.id}`);
                    await (await killGame.connect(owner).kill(targetFound.enemy.occupant, targetFound.id, targetFound.self.units.sub(1), targetFound.self.reapers, { gasLimit: 800000 })).wait();
                }
            } 
            // 2. Cleanup / Retreat
            else if (stragglers.length > 0) {
                const s = stragglers[0];
                console.log(`[RETREAT] Returning ${s.units.toString()} units to Hub ${HUB_STACK}`);
                await (await killGame.connect(owner).move(s.id, HUB_STACK, s.units, s.reapers, { gasLimit: 500000 })).wait();
            }

        } catch (error) {
            console.error("[SNIPER ERROR]:", error.message);
        }
        await new Promise(r => setTimeout(r, 12000));
    }
}

main().catch(console.error);