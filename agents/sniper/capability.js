"use strict";
const { ethers } = require("hardhat");
const { CYA, YEL, GRN, RED, PNK, RES, claimFaucet, subgraphQuery } = require('../common');

const SPAWN_COST_PER_UNIT = 20;
const REAPER_BOUNTY       = 3330;
const ORG                 = "\x1b[38;5;214m"; // orange (256-color)

module.exports = {
    async init({ wallet, killFaucet }) {
        await claimFaucet(killFaucet, wallet.address);
    },

    async run({ wallet, killGame, killToken, config }) {
        const { KILL_MULTIPLIER, SPAWN_PROFITABILITY_THRESHOLD, MIN_SPAWN, SUBGRAPH_URL } = config.settings;
        const { kill_game_addr } = config.network;

        const ethBal    = await wallet.provider.getBalance(wallet.address);
        const killBal   = await killToken.balanceOf(wallet.address);
        const killAllow = await killToken.allowance(wallet.address, kill_game_addr);

        const data = await subgraphQuery(SUBGRAPH_URL, `{
            stacks(orderBy: totalStandardUnits, orderDirection: desc, first: 20) {
                id totalStandardUnits totalBoostedUnits
            }
        }`);
        const topStacks  = data.stacks;
        const stackCalls = topStacks.map(s => killGame.interface.encodeFunctionData("getFullStack", [parseInt(s.id)]));
        const results    = await killGame.callStatic.multicall(stackCalls);

        const targets = [];

        for (let i = 0; i < topStacks.length; i++) {
            const stackId = parseInt(topStacks[i].id);
            const items   = killGame.interface.decodeFunctionResult("getFullStack", results[i])[0];
            const enemies = items.filter(it => it.occupant.toLowerCase() !== wallet.address.toLowerCase() && (it.units.gt(0) || it.reapers.gt(0)));

            for (const e of enemies) {
                const enemyPower = e.units.add(e.reapers.mul(666));
                const bountyVal  = e.units.mul(SPAWN_COST_PER_UNIT).add(e.reapers.mul(REAPER_BOUNTY));
                let spawnAmt     = enemyPower.mul(KILL_MULTIPLIER);
                if (spawnAmt.lt(MIN_SPAWN)) spawnAmt = ethers.BigNumber.from(MIN_SPAWN);
                const spawnReaper = spawnAmt.div(666);
                const totalPower  = spawnAmt.add(spawnReaper.mul(666));
                const attackCost  = totalPower.mul(SPAWN_COST_PER_UNIT);
                const ratio       = parseFloat(bountyVal.mul(1000).div(attackCost.gt(0) ? attackCost : 1).toString()) / 1000;
                targets.push({ id: stackId, enemy: e, ratio, spawnAmt, spawnReaper, bountyVal, attackCost });
            }
        }

        const threshold = parseFloat(SPAWN_PROFITABILITY_THRESHOLD);
        const targetRows = targets.sort((a, b) => b.ratio - a.ratio).slice(0, 10).map(t => {
            const bountyStr = (parseFloat(t.bountyVal.toString()) / 1000).toFixed(1) + 'K';
            let ratioColor;
            if      (t.ratio >= threshold)       ratioColor = GRN;
            else if (t.ratio >= threshold * 0.5) ratioColor = YEL;
            else                                 ratioColor = ORG;
            const statusStr = t.ratio < threshold ? 'LOW_ROI' : killBal.lt(t.attackCost) ? 'NO_KILL' : 'READY';
            const statusColor = t.ratio < threshold ? ORG : killBal.lt(t.attackCost) ? YEL : GRN;
            return {
                'ID':     String(t.id),
                'Enemy':  t.enemy.occupant.slice(0, 10),
                'Units':  t.enemy.units.toString(),
                'Bounty': bountyStr,
                'Ratio':  `${ratioColor}${t.ratio.toFixed(2)}x${RES}`,
                'Status': `${statusColor}${statusStr}${RES}`,
            };
        });

        const calls      = [];
        const actionRows = [];

        const best = targets.sort((a, b) => b.ratio - a.ratio)[0];
        if (best && best.ratio >= threshold && killBal.gte(best.attackCost)) {
            if (killAllow.lt(best.attackCost)) {
                await (await killToken.connect(wallet).approve(kill_game_addr, ethers.constants.MaxUint256)).wait();
                actionRows.push({ Action: 'APPROVE', Detail: 'MaxUint256', Result: `${CYA}OK${RES}` });
            }
            if (ethBal.gt(ethers.utils.parseEther("0.002"))) {
                calls.push(killGame.interface.encodeFunctionData("spawn", [best.id, best.spawnAmt]));
                calls.push(killGame.interface.encodeFunctionData("kill", [best.enemy.occupant, best.id, best.spawnAmt, best.spawnReaper]));
                actionRows.push({ Action: 'SNIPE', Detail: `Stack ${best.id} | ${best.enemy.occupant.slice(0, 10)} | ${best.ratio.toFixed(2)}x`, Result: `${PNK}PENDING${RES}` });
            }
        }

        if (calls.length > 0) {
            try {
                const tx = await killGame.connect(wallet).multicall(calls, { gasLimit: 2500000 });
                await tx.wait();
                const txLinkStr = config.network.block_explorer ? `\x1b[4m↗ ${config.network.block_explorer}/${tx.hash}\x1b[24m` : '';
                actionRows.forEach(r => { if (r.Result.includes('PENDING')) r.Result = `${GRN}OK${RES}`; r.Tx = txLinkStr; });
            } catch (e) {
                actionRows.push({ Action: 'TX', Detail: e.reason || e.message, Result: `${RED}FAIL${RES}`, Tx: '' });
            }
        }

        actionRows.forEach(r => { if (r.Tx === undefined) r.Tx = ''; });
        const sections = [{ title: 'SNIPER TARGETS', rows: targetRows, color: YEL }];
        if (actionRows.length > 0) sections.push({ title: 'SNIPER ACTION', rows: actionRows, color: CYA });
        return sections;
    }
};
