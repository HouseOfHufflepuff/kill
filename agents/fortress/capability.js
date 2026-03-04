"use strict";
const { ethers } = require("hardhat");
const { GRN, YEL, RED, RES, getManhattanDist, isAdjacent, calcPower } = require('../common');

module.exports = {
    async run({ wallet, killGame, config }) {
        const { HUB_STACK, TARGET_UNITS, REPLENISH_AMT, HUB_PERIMETER, MAX_GAS_PRICE_GWEI, KILL_MULTIPLIER } = config.settings;
        const address = wallet.address;

        const ALL_IDS   = Array.from({ length: 216 }, (_, i) => i + 1);
        const SAFE_ZONE = ALL_IDS.filter(id => getManhattanDist(HUB_STACK, id) <= HUB_PERIMETER);

        const readCalls  = ALL_IDS.map(id => killGame.interface.encodeFunctionData("getFullStack", [id]));
        const returnData = await killGame.callStatic.multicall(readCalls);

        let hubState         = { self: null, enemies: [] };
        let validTargets     = [];
        let myActiveStacks   = [];
        let totalPowerGlobal = ethers.BigNumber.from(0);
        const tacticalRows   = [];

        for (let i = 0; i < returnData.length; i++) {
            const stackId = ALL_IDS[i];
            const items   = killGame.interface.decodeFunctionResult("getFullStack", returnData[i])[0];
            const self    = items.find(it => it.occupant.toLowerCase() === address.toLowerCase());
            const enemies = items.filter(it => it.occupant.toLowerCase() !== address.toLowerCase() && (it.units.gt(0) || it.reapers.gt(0)));
            const dist    = getManhattanDist(HUB_STACK, stackId);

            if (self && (self.units.gt(0) || self.reapers.gt(0))) {
                const sp = calcPower(self.units, self.reapers);
                totalPowerGlobal = totalPowerGlobal.add(sp);
                myActiveStacks.push({ id: stackId, units: self.units, reapers: self.reapers, power: sp, dist });
                if (stackId === HUB_STACK) hubState.self = self;
            }

            if (SAFE_ZONE.includes(stackId)) {
                const ep     = enemies.reduce((acc, e) => acc.add(calcPower(e.units, e.reapers)), ethers.BigNumber.from(0));
                const mp     = self ? calcPower(self.units, self.reapers) : ethers.BigNumber.from(0);
                const canOwn = ep.gt(0) && mp.gte(ep.mul(KILL_MULTIPLIER));
                tacticalRows.push({
                    'ID':     String(stackId),
                    'Dist':   String(dist),
                    'Enemy':  ep.toString(),
                    'Mine':   mp.toString(),
                    'Status': enemies.length === 0 ? `${GRN}SECURE${RES}` : canOwn ? `${YEL}READY${RES}` : `${RED}HOSTILE${RES}`
                });
                if (enemies.length > 0) validTargets.push({ id: stackId, target: enemies[0], dist, enemyPower: ep });
            }
            if (stackId === HUB_STACK) hubState.enemies = enemies;
        }

        tacticalRows.sort((a, b) => parseInt(a.Dist) - parseInt(b.Dist) || parseInt(a.ID) - parseInt(b.ID));

        const TARGET_BN        = ethers.BigNumber.from(TARGET_UNITS);
        const hasReachedTarget = totalPowerGlobal.gte(TARGET_BN);
        const txOpt            = { gasLimit: 2000000, gasPrice: ethers.utils.parseUnits(MAX_GAS_PRICE_GWEI.toString(), "gwei") };
        const actionBatch      = [];
        const actionRows       = [];

        // Always spawn if below target power
        if (!hasReachedTarget) {
            actionBatch.push(killGame.interface.encodeFunctionData("spawn", [HUB_STACK, REPLENISH_AMT]));
            actionRows.push({ Action: 'SPAWN', Detail: `${REPLENISH_AMT} → Stack ${HUB_STACK}`, Result: `${YEL}PENDING${RES}` });

            // Retreat stranded stacks while building up
            const stranded = myActiveStacks.find(s => s.id !== HUB_STACK);
            if (stranded) {
                const step = ALL_IDS.filter(id => isAdjacent(stranded.id, id)).sort((a, b) => getManhattanDist(a, HUB_STACK) - getManhattanDist(b, HUB_STACK))[0];
                actionBatch.push(killGame.interface.encodeFunctionData("move", [stranded.id, step, stranded.units, stranded.reapers]));
                actionRows.push({ Action: 'RETREAT', Detail: `Stack ${stranded.id} → ${step}`, Result: `${YEL}PENDING${RES}` });
            }
        } else {
            // At target power — only attack with overwhelming force
            if (hubState.enemies.length > 0 && hubState.self) {
                const hubEnemyPower = hubState.enemies.reduce((acc, e) => acc.add(calcPower(e.units, e.reapers)), ethers.BigNumber.from(0));
                const myHubPower    = calcPower(hubState.self.units, hubState.self.reapers);
                if (myHubPower.gte(hubEnemyPower.mul(KILL_MULTIPLIER))) {
                    actionBatch.push(killGame.interface.encodeFunctionData("kill", [hubState.enemies[0].occupant, HUB_STACK, hubState.self.units, hubState.self.reapers]));
                    actionRows.push({ Action: 'KILL', Detail: `${hubState.enemies[0].occupant.slice(0, 10)} @ HUB`, Result: `${RED}PENDING${RES}` });
                } else {
                    actionRows.push({ Action: 'HUB', Detail: `Outgunned ${myHubPower}/${hubEnemyPower} (need ${KILL_MULTIPLIER}x)`, Result: `${YEL}WAIT${RES}` });
                }
            } else if (validTargets.length > 0 && myActiveStacks.length > 0) {
                const raid = validTargets.sort((a, b) => a.dist - b.dist)[0];
                const army = myActiveStacks.sort((a, b) => b.power.sub(a.power))[0];
                if (army.power.gte(raid.enemyPower.mul(KILL_MULTIPLIER))) {
                    if (army.id === raid.id) {
                        actionBatch.push(killGame.interface.encodeFunctionData("kill", [raid.target.occupant, raid.id, army.units, army.reapers]));
                        actionRows.push({ Action: 'KILL', Detail: `${raid.target.occupant.slice(0, 10)} @ ${raid.id}`, Result: `${RED}PENDING${RES}` });
                    } else {
                        const step = ALL_IDS.filter(id => isAdjacent(army.id, id)).sort((a, b) => getManhattanDist(a, raid.id) - getManhattanDist(b, raid.id))[0];
                        actionBatch.push(killGame.interface.encodeFunctionData("move", [army.id, step, army.units, army.reapers]));
                        actionRows.push({ Action: 'MOVE', Detail: `Stack ${army.id} → ${step} (→ ${raid.id})`, Result: `${YEL}PENDING${RES}` });
                    }
                }
            }
        }

        if (actionBatch.length > 0) {
            try {
                const tx = await killGame.multicall(actionBatch, txOpt);
                await tx.wait();
                if (config.network.block_explorer) console.log(`  ↗ ${config.network.block_explorer}/${tx.hash}`);
                actionRows.forEach(r => { r.Result = `${GRN}OK${RES}`; });
            } catch (e) {
                actionRows.push({ Action: 'TX', Detail: e.reason || e.message, Result: `${RED}FAIL${RES}` });
            }
        }

        const sections = [{ title: `TACTICAL VIEW (Perimeter <= ${HUB_PERIMETER})`, rows: tacticalRows, color: YEL }];
        sections.push({ title: `FORTRESS | Power: ${totalPowerGlobal} / ${TARGET_UNITS} | ${hasReachedTarget ? `${GRN}COMBAT READY${RES}` : `${YEL}BUILDING${RES}`}`, rows: actionRows, color: GRN });
        return sections;
    }
};
