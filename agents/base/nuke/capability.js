"use strict";
const { ethers } = require("hardhat");
const { GRN, YEL, RED, RES, calcPower, claimFaucet, txLink } = require('../common');
const { fmtPow } = require('../../common/format');

module.exports = {
    async init({ wallet, killFaucet }) {
        await claimFaucet(killFaucet, wallet.address);
    },

    async run({ wallet, killGame, killToken, config, bn }) {
        const { KILL_MULTIPLIER } = config.settings;
        const { kill_game_addr } = config.network;
        const nukeSettings = config.settings.nuke || {};
        const rawStacks = nukeSettings.TARGET_STACKS || [];
        const TARGET_STACKS = Array.isArray(rawStacks)
            ? rawStacks.map(Number)
            : String(rawStacks).split(',').map(s => parseInt(s.trim())).filter(n => !isNaN(n));

        const myAddr = wallet.address.toLowerCase();

        // Ensure approval
        const killAllow = await killToken.allowance(wallet.address, kill_game_addr);
        if (killAllow.lt(ethers.constants.MaxUint256.div(2))) {
            await (await killToken.connect(wallet).approve(kill_game_addr, ethers.constants.MaxUint256)).wait();
        }

        let killBalance = await killToken.balanceOf(wallet.address);
        const SPAWN_COST = ethers.utils.parseEther("20"); // 20 KILL per unit

        // Fetch all target stacks via multicall
        const stackCalls = TARGET_STACKS.map(id =>
            killGame.interface.encodeFunctionData("getFullStack", [id])
        );
        const stackResults = await killGame.callStatic.multicall(stackCalls);

        const byStack = {};
        for (let i = 0; i < TARGET_STACKS.length; i++) {
            const stackId = TARGET_STACKS[i];
            const items = killGame.interface.decodeFunctionResult("getFullStack", stackResults[i])[0];
            byStack[stackId] = { mine: null, enemies: [] };
            for (const item of items) {
                const units   = item.units;
                const reapers = item.reapers;
                if (item.occupant.toLowerCase() === myAddr) {
                    byStack[stackId].mine = { units, reapers, power: calcPower(units, reapers) };
                } else if (units.gt(0) || reapers.gt(0)) {
                    byStack[stackId].enemies.push({
                        occupant: item.occupant,
                        units, reapers,
                        power: calcPower(units, reapers),
                    });
                }
            }
        }

        const scanRows   = [];
        const actionRows = [];

        for (const stackId of TARGET_STACKS) {
            const { mine, enemies } = byStack[stackId] || { mine: null, enemies: [] };

            if (enemies.length === 0) {
                scanRows.push({ Stack: String(stackId), Enemy: '—', EnemyPow: '—', Status: `${GRN}CLEAR${RES}` });
                continue;
            }

            // Sort strongest first
            const sorted = [...enemies].sort((a, b) => (a.power.gt(b.power) ? -1 : 1));
            scanRows.push({
                Stack:    String(stackId),
                Enemy:    `${sorted[0].occupant.slice(0, 10)} +${sorted.length - 1}`,
                EnemyPow: fmtPow(sorted[0].power),
                Status:   `${RED}HOSTILE(${sorted.length})${RES}`,
            });

            // Track attacker's running unit count — attacker keeps all units on win
            let myUnits   = mine ? mine.units   : ethers.BigNumber.from(0);
            let myReapers = mine ? mine.reapers : ethers.BigNumber.from(0);

            for (const target of sorted) {
                const neededPower  = target.power.mul(KILL_MULTIPLIER);
                const currentPower = calcPower(myUnits, myReapers);

                let spawnUnits = ethers.BigNumber.from(0);
                if (currentPower.lt(neededPower)) {
                    const desired    = neededPower.sub(currentPower);
                    const affordable = killBalance.div(SPAWN_COST);
                    spawnUnits = desired.lt(affordable) ? desired : affordable;
                }

                const sendUnits   = myUnits.add(spawnUnits);
                // spawn auto-grants 1 reaper per 666 units spawned
                const sendReapers = myReapers.add(spawnUnits.div(666));

                const calls = [];
                if (spawnUnits.gt(0)) {
                    calls.push(killGame.interface.encodeFunctionData("spawn", [stackId, spawnUnits]));
                }
                calls.push(killGame.interface.encodeFunctionData("kill", [target.occupant, stackId, sendUnits, sendReapers]));

                try {
                    const tx = await killGame.connect(wallet).multicall(calls, { gasLimit: 2500000 });
                    await tx.wait();
                    const link = config.network.block_explorer
                        ? `\x1b]8;;${config.network.block_explorer}/${tx.hash}\x1b\\↗\x1b]8;;\x1b\\`
                        : txLink(tx.hash);
                    actionRows.push({
                        Action: spawnUnits.gt(0) ? 'SPAWN+KILL' : 'KILL',
                        Stack:  String(stackId),
                        Detail: `${target.occupant.slice(0, 10)} | sent:${fmtPow(sendUnits)} def:${fmtPow(target.power)}`,
                        Result: `${GRN}OK${RES}`,
                        Tx:     link,
                    });
                    // Attacker wins → keeps all units; update local tracking
                    myUnits      = sendUnits;
                    myReapers    = sendReapers;
                    killBalance  = killBalance.sub(spawnUnits.mul(SPAWN_COST));
                } catch (e) {
                    actionRows.push({
                        Action: spawnUnits.gt(0) ? 'SPAWN+KILL' : 'KILL',
                        Stack:  String(stackId),
                        Detail: (e.reason || e.message || '').slice(0, 50),
                        Result: `${RED}FAIL${RES}`,
                        Tx:     '',
                    });
                    // Stop this stack on failure — on-chain state uncertain
                    break;
                }
            }
        }

        if (actionRows.length === 0) {
            actionRows.push({ Action: 'NUKE', Stack: '—', Detail: 'All target stacks clear', Result: `${GRN}IDLE${RES}`, Tx: '' });
        }

        return [
            { title: `NUKE SCAN — Targets: [${TARGET_STACKS.join(', ')}]`, rows: scanRows,   color: RED },
            { title: 'NUKE STRIKES',                                         rows: actionRows, color: RED },
        ];
    }
};
