const { ethers } = require("hardhat");
const fs = require("fs");
const path = require("path");
require("dotenv").config();

// ANSI Colors
const YEL = "\x1b[33m";
const CYA = "\x1b[36m";
const PNK = "\x1b[35m";
const RES = "\x1b[0m";
const BRIGHT = "\x1b[1m";

async function main() {
    if (!process.env.SNIPER_PK) throw new Error("Missing SNIPER_PK");
    const wallet = new ethers.Wallet(process.env.SNIPER_PK, ethers.provider);
    const config = JSON.parse(fs.readFileSync(path.join(__dirname, "config.json"), "utf8"));
    const { kill_game_addr } = config.network;
    const { HUB_STACK, LOOP_DELAY_SECONDS, KILL_MULTIPLIER, SPAWN_PROFITABILITY_THRESHOLD } = config.settings;

    const killGame = await ethers.getContractAt("KILLGame", kill_game_addr);
    const SPAWN_COST = await killGame.SPAWN_COST();

    while (true) {
        try {
            const scanIds = Array.from({ length: 216 }, (_, i) => i + 1);
            const scanCalls = scanIds.map(id => killGame.interface.encodeFunctionData("getFullStack", [id]));
            const scanResults = await killGame.callStatic.multicall(scanCalls);
            
            let targets = [];
            for (let i = 0; i < scanResults.length; i++) {
                const items = killGame.interface.decodeFunctionResult("getFullStack", scanResults[i])[0];
                const enemies = items.filter(it => it.occupant.toLowerCase() !== wallet.address.toLowerCase() && it.units.gt(0));

                for (const e of enemies) {
                    // --- SYNCED LOGIC: Bounty = Unit Count (1:1 Parity) ---
                    const killValueWei = e.units.mul(ethers.BigNumber.from(10).pow(18)); 
                    
                    const spawnAmt = e.units.mul(KILL_MULTIPLIER);
                    const costWei = spawnAmt.mul(SPAWN_COST);
                    
                    // Ratio: (KILL Reward) / (Spawn Cost)
                    const ratio = parseFloat(ethers.utils.formatUnits(killValueWei.mul(1000).div(costWei), 3));

                    targets.push({ 
                        id: scanIds[i], 
                        enemy: e, 
                        killValue: killValueWei, 
                        ratio, 
                        spawnAmt, 
                        cost: costWei 
                    });
                }
            }

            console.clear();
            console.log(`${BRIGHT}ID   | ENEMY      | UNITS | KILL VAL   | RATIO | PROFIT | ACTION${RES}`);
            console.log(`-----|------------|-------|------------|-------|--------|-------`);
            
            targets.sort((a,b) => b.ratio - a.ratio).slice(0, 10).forEach(t => {
                const killValStr = (parseFloat(ethers.utils.formatUnits(t.killValue, 18)) / 1000).toFixed(1) + 'K';
                const isProfitable = t.ratio >= SPAWN_PROFITABILITY_THRESHOLD;
                const action = isProfitable ? `${PNK}LOCK${RES}` : "WAIT";
                const profitStatus = isProfitable ? `${CYA}PASS${RES}` : "FAIL";

                console.log(
                    `${YEL}${t.id.toString().padEnd(4)}${RES}| ` +
                    `${t.enemy.occupant.slice(0,10)} | ` +
                    `${t.enemy.units.toString().padEnd(5)} | ` +
                    `${killValStr.padEnd(10)} | ` +
                    `${t.ratio.toFixed(2)}x`.padEnd(5) + ` | ` +
                    `${profitStatus.padEnd(15)} | ` +
                    `${action}`
                );
            });

            const best = targets.sort((a, b) => b.ratio - a.ratio)[0];
            if (best && best.ratio >= SPAWN_PROFITABILITY_THRESHOLD) {
                console.log(`\n${PNK}[EXECUTE] Targeting Stack ${best.id} (Ratio: ${best.ratio.toFixed(2)}x)${RES}`);
                
                const calls = [
                    killGame.interface.encodeFunctionData("spawn", [best.id, best.spawnAmt]),
                    killGame.interface.encodeFunctionData("kill", [best.enemy.occupant, best.id, best.spawnAmt, 0])
                ];

                const tx = await killGame.connect(wallet).multicall(calls, { gasLimit: 1200000 });
                await tx.wait();
                console.log(`${CYA}[SUCCESS] Snipe Confirmed.${RES}`);

                const survivors = await killGame.balanceOf(wallet.address, best.id);
                if (survivors.gt(0) && best.id !== HUB_STACK) {
                    console.log(`[MOVE] Moving survivors to HUB_${HUB_STACK}...`);
                    await (await killGame.connect(wallet).move(best.id, HUB_STACK, survivors, 0, { gasLimit: 600000 })).wait();
                }
            } else {
                console.log(`\n[IDLE] No targets meet threshold (${SPAWN_PROFITABILITY_THRESHOLD}).`);
            }
        } catch (err) { console.error("\n[ERROR]", err.message); }
        await new Promise(r => setTimeout(r, LOOP_DELAY_SECONDS * 1000));
    }
}
main();