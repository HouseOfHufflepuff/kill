"use strict";
const { ethers } = require("hardhat");
const { CYA, YEL, PNK, RED, RES, subgraphQuery } = require('../common');

// Module-level state — persists across block calls for the lifetime of the agent
let processedKills = new Set();
let pendingAttacks = [];
let isFirstRun     = true;

module.exports = {
    async run({ wallet, killGame, killToken, config }) {
        const { KILL_MULTIPLIER, MIN_SPAWN, MAX_KILL, SUBGRAPH_URL } = config.settings;
        const { kill_game_addr } = config.network;

        const ethBal    = await wallet.provider.getBalance(wallet.address);
        const killBal   = await killToken.balanceOf(wallet.address);
        const killAllow = await killToken.allowance(wallet.address, kill_game_addr);

        const rows = [];

        // ── Phase 1: EXECUTION (pending attack from prior block) ──────────────
        if (pendingAttacks.length > 0) {
            const attack       = pendingAttacks.shift();
            const stackCall    = [killGame.interface.encodeFunctionData("getFullStack", [attack.stackId])];
            const stackResults = await killGame.callStatic.multicall(stackCall);
            const freshItems   = killGame.interface.decodeFunctionResult("getFullStack", stackResults[0])[0];
            const targetData   = freshItems.find(it => it.occupant.toLowerCase() === attack.target.toLowerCase());

            if (!targetData || targetData.units.eq(0)) {
                rows.push({ Phase: 'EXECUTE', Target: attack.target.slice(0, 10), Stack: String(attack.stackId), Detail: 'Target gone', Result: `${YEL}SKIP${RES}` });
            } else {
                const ep = targetData.units.add(targetData.reapers.mul(666));
                if (ep.gt(MAX_KILL)) {
                    rows.push({ Phase: 'EXECUTE', Target: attack.target.slice(0, 10), Stack: String(attack.stackId), Detail: `Power ${ep} > MAX`, Result: `${YEL}SKIP${RES}` });
                } else {
                    let spawnAmt     = ep.mul(KILL_MULTIPLIER);
                    if (spawnAmt.lt(MIN_SPAWN)) spawnAmt = ethers.BigNumber.from(MIN_SPAWN);
                    const spawnReaper    = spawnAmt.div(666);
                    const requiredCostWei = ethers.utils.parseEther(spawnAmt.mul(20).toString());

                    if (killAllow.lt(requiredCostWei)) {
                        await (await killToken.approve(kill_game_addr, ethers.constants.MaxUint256)).wait();
                    }

                    if (killBal.lt(requiredCostWei)) {
                        rows.push({ Phase: 'EXECUTE', Target: attack.target.slice(0, 10), Stack: String(attack.stackId), Detail: `Need ${spawnAmt.mul(20)} KILL`, Result: `${RED}NO KILL${RES}` });
                    } else if (ethBal.gt(ethers.utils.parseEther("0.002"))) {
                        const calls = [
                            killGame.interface.encodeFunctionData("spawn", [attack.stackId, spawnAmt]),
                            killGame.interface.encodeFunctionData("kill", [attack.target, attack.stackId, spawnAmt, spawnReaper])
                        ];
                        try {
                            const tx = await killGame.connect(wallet).multicall(calls, { gasLimit: 2500000 });
                            await tx.wait();
                            const txLinkStr = config.network.block_explorer ? `\x1b[4m↗ ${config.network.block_explorer}/${tx.hash}\x1b[24m` : '';
                            rows.push({ Phase: 'EXECUTE', Target: attack.target.slice(0, 10), Stack: String(attack.stackId), Detail: `Power ${ep} | ${spawnAmt}+${spawnReaper}R`, Result: `${CYA}OK${RES}`, Tx: txLinkStr });
                        } catch (e) {
                            rows.push({ Phase: 'EXECUTE', Target: attack.target.slice(0, 10), Stack: String(attack.stackId), Detail: e.reason || e.message, Result: `${RED}FAIL${RES}`, Tx: '' });
                        }
                    }
                }
            }
        }

        // ── Phase 2: DETECTION ────────────────────────────────────────────────
        const data = await subgraphQuery(SUBGRAPH_URL, `{
            killeds(orderBy: block_number, orderDirection: desc, first: 10) {
                id stackId target block_number
            }
        }`);
        const recentKills = data.killeds;

        if (isFirstRun) {
            recentKills.forEach(k => processedKills.add(k.id));
            rows.push({ Phase: 'BASELINE', Target: '-', Stack: '-', Detail: `${processedKills.size} kills recorded`, Result: `${YEL}WATCHING${RES}` });
            isFirstRun = false;
        } else {
            for (const k of recentKills) {
                if (processedKills.has(k.id)) continue;
                const stackId    = parseInt(k.stackId);
                const stackCall  = [killGame.interface.encodeFunctionData("getFullStack", [stackId])];
                const res        = await killGame.callStatic.multicall(stackCall);
                const items      = killGame.interface.decodeFunctionResult("getFullStack", res[0])[0];
                const targetData = items.find(it => it.occupant.toLowerCase() === k.target.toLowerCase());

                if (targetData && targetData.occupant.toLowerCase() !== wallet.address.toLowerCase()) {
                    const ep = targetData.units.add(targetData.reapers.mul(666));
                    if (ep.gt(MAX_KILL)) {
                        rows.push({ Phase: 'DETECT', Target: targetData.occupant.slice(0, 10), Stack: String(stackId), Detail: `Power ${ep} > MAX`, Result: `${YEL}SKIP${RES}` });
                    } else {
                        pendingAttacks.push({ stackId, target: targetData.occupant });
                        rows.push({ Phase: 'DETECT', Target: targetData.occupant.slice(0, 10), Stack: String(stackId), Detail: `Power ${ep}`, Result: `${PNK}QUEUED${RES}` });
                    }
                }
                processedKills.add(k.id);
            }
        }

        rows.push({ Phase: 'STATUS', Target: '-', Stack: '-', Detail: `Pending: ${pendingAttacks.length}`, Result: `${CYA}IDLE${RES}` });
        rows.forEach(r => { if (r.Tx === undefined) r.Tx = ''; });
        return [{ title: 'AFTERSHOCK', rows, color: PNK }];
    }
};
