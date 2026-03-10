"use strict";
const anchor = require("@coral-xyz/anchor");
const web3   = anchor.web3;
const { getOrCreateAssociatedTokenAccount, getAssociatedTokenAddressSync } = require("@solana/spl-token");
const { GRN, YEL, RED, RES, getManhattanDist, calcPower, calcEffectivePower,
        powerDecayPct, agentStackPDA, gameConfigPDA, txLink } = require('../common');

function fmtPow(n) {
    const v = Number(n);
    if (v >= 1e9) return (v / 1e9).toFixed(1) + 'B';
    if (v >= 1e6) return (v / 1e6).toFixed(1) + 'M';
    if (v >= 1e3) return Math.round(v / 1e3) + 'K';
    return String(Math.round(v));
}

// BFS: single next step from start toward goal
function bfsNextStep(start, goal) {
    if (start === goal) return null;
    const queue = [[start, start]];
    const visited = new Set([start]);
    while (queue.length > 0) {
        const [cur, firstStep] = queue.shift();
        for (let next = 0; next < 216; next++) {
            if (getManhattanDist(cur, next) !== 1) continue;
            if (next === goal) return firstStep === start ? next : firstStep;
            if (!visited.has(next)) {
                visited.add(next);
                queue.push([next, firstStep === start ? next : firstStep]);
            }
        }
    }
    return null;
}

// BFS: full path from start to goal as array of stack IDs
function bfsPath(start, goal) {
    if (start === goal) return [start];
    const queue = [[start, [start]]];
    const visited = new Set([start]);
    while (queue.length > 0) {
        const [cur, path] = queue.shift();
        for (let next = 0; next < 216; next++) {
            if (getManhattanDist(cur, next) !== 1) continue;
            const newPath = [...path, next];
            if (next === goal) return newPath;
            if (!visited.has(next)) {
                visited.add(next);
                queue.push([next, newPath]);
            }
        }
    }
    return [start];
}

function topEnemy(enemies) {
    return [...enemies].sort((a, b) =>
        calcPower(b.units, b.reapers) > calcPower(a.units, a.reapers) ? 1 : -1
    )[0];
}

module.exports = {
    async run({ wallet, killGame, connection, KILL_MINT, GAME_ID, gameVault, gameConfigAddr, config }) {
        const { HUB_STACK, TARGET_UNITS, REPLENISH_AMT, HUB_PERIMETER, KILL_MULTIPLIER, MOVE_ON_DECAY_PERCENT } = config.settings;
        const myKey = wallet.publicKey.toBase58();

        const agentAta = await getOrCreateAssociatedTokenAccount(
            connection, wallet, KILL_MINT, wallet.publicKey
        );
        const currentSlot = BigInt(await connection.getSlot());

        // Fetch all on-chain stacks
        const allStacks = await killGame.account.agentStack.all([]);

        // Group by stack_id
        const byStack = {};
        for (const { account: s } of allStacks) {
            const id = s.stackId;
            if (!byStack[id]) byStack[id] = { mine: null, enemies: [] };
            const units   = BigInt(s.units.toString());
            const reapers = BigInt(s.reapers.toString());
            const spawnSlot = BigInt(s.spawnSlot.toString());
            if (s.agent.toBase58() === myKey) {
                byStack[id].mine = { agent: s.agent, stackId: id, units, reapers, spawnSlot, power: calcPower(units, reapers) };
            } else if (units > 0n || reapers > 0n) {
                byStack[id].enemies.push({ agent: s.agent, stackId: id, units, reapers, power: calcEffectivePower(units, reapers, spawnSlot, currentSlot) });
            }
        }

        // Aggregate my stacks
        let totalPower = 0n;
        let myStacks   = [];
        for (const [idStr, { mine }] of Object.entries(byStack)) {
            if (mine && (mine.units > 0n || mine.reapers > 0n)) {
                totalPower += mine.power;
                const id = parseInt(idStr);
                myStacks.push({ ...mine, id, dist: getManhattanDist(HUB_STACK, id) });
            }
        }

        const SAFE_ZONE = Array.from({ length: 216 }, (_, i) => i)
            .filter(id => getManhattanDist(HUB_STACK, id) <= HUB_PERIMETER);

        // Build tactical view and collect perimeter targets
        const validTargets = [];
        const tacticalRows = [];
        for (const id of SAFE_ZONE) {
            const { mine, enemies } = byStack[id] || { mine: null, enemies: [] };
            const ep     = enemies.reduce((acc, e) => acc + e.power, 0n);
            const mp     = mine ? mine.power : 0n;
            const dist   = getManhattanDist(HUB_STACK, id);
            const canOwn = ep > 0n && mp >= ep * BigInt(KILL_MULTIPLIER);
            tacticalRows.push({
                'ID':     String(id),
                'Dist':   String(dist),
                'Enemy':  fmtPow(ep),
                'Mine':   fmtPow(mp),
                'Status': enemies.length === 0 ? `${GRN}SECURE${RES}` : canOwn ? `${YEL}READY${RES}` : `${RED}HOSTILE${RES}`
            });
            if (enemies.length > 0) {
                const top = topEnemy(enemies);
                validTargets.push({ id, target: top, dist, enemyPower: top.power });
            }
        }
        tacticalRows.sort((a, b) => parseInt(a.Dist) - parseInt(b.Dist) || parseInt(a.ID) - parseInt(b.ID));

        const actionIxs  = [];
        const actionRows = [];
        let actionTaken  = false;

        // ── Priority 1: KILL — enemy on same stack, overwhelming force ─────────
        //    Batch ALL killable stacks into one tx
        if (!actionTaken) {
            const killable = myStacks
                .filter(s => {
                    const { enemies } = byStack[s.id] || { enemies: [] };
                    if (enemies.length === 0) return false;
                    const top = topEnemy(enemies);
                    return s.power >= top.power * BigInt(KILL_MULTIPLIER);
                })
                .sort((a, b) => Number(b.power - a.power));

            for (const myStack of killable) {
                const top         = topEnemy(byStack[myStack.id].enemies);
                const defenderAta = getAssociatedTokenAddressSync(KILL_MINT, top.agent);
                actionIxs.push(await killGame.methods
                    .kill(myStack.id, myStack.id,
                          new anchor.BN(myStack.units.toString()),
                          new anchor.BN(myStack.reapers.toString()))
                    .accounts({
                        gameConfig:           gameConfigAddr,
                        attackerStack:        agentStackPDA(wallet.publicKey, myStack.id, GAME_ID),
                        defenderStack:        agentStackPDA(top.agent, myStack.id, GAME_ID),
                        attackerTokenAccount: agentAta.address,
                        defenderTokenAccount: defenderAta,
                        gameVault,
                        killMint:             KILL_MINT,
                        attacker:             wallet.publicKey,
                        defender:             top.agent,
                    })
                    .instruction()
                );
                actionRows.push({ Action: 'KILL', Detail: `${top.agent.toBase58().slice(0, 10)} @ ${myStack.id} | sent:${fmtPow(myStack.power)} def:${fmtPow(top.power)}`, Result: `${RED}PENDING${RES}`, Tx: '' });
            }
            if (killable.length > 0) actionTaken = true;
        }

        // ── Priority 2: MOVE — enemies in perimeter, multi-hop in one tx ──────
        if (!actionTaken && validTargets.length > 0) {
            const raid = validTargets.sort((a, b) => a.dist - b.dist)[0];
            const army = myStacks.sort((a, b) => Number(b.power - a.power))[0];
            if (army && army.id !== raid.id) {
                const path = bfsPath(army.id, raid.id);
                for (let i = 0; i < path.length - 1; i++) {
                    const from = path[i];
                    const to   = path[i + 1];
                    actionIxs.push(await killGame.methods
                        .moveUnits(from, to,
                                   new anchor.BN(army.units.toString()),
                                   new anchor.BN(army.reapers.toString()))
                        .accounts({
                            gameConfig:        gameConfigAddr,
                            fromStack:         agentStackPDA(wallet.publicKey, from, GAME_ID),
                            toStack:           agentStackPDA(wallet.publicKey, to, GAME_ID),
                            agentTokenAccount: agentAta.address,
                            gameVault,
                            killMint:          KILL_MINT,
                            agent:             wallet.publicKey,
                        })
                        .instruction()
                    );
                    actionRows.push({ Action: 'MOVE', Detail: `Stack ${from} → ${to}`, Result: `${YEL}PENDING${RES}`, Tx: '' });
                }
                actionTaken = true;
            }
        }

        // ── Priority 3: RETREAT — no enemies in perimeter ─────────────────────
        if (!actionTaken) {
            const stranded = myStacks
                .filter(s => s.id !== HUB_STACK)
                .sort((a, b) => a.dist - b.dist || Number(b.units - a.units));
            if (stranded.length > 0) {
                const s    = stranded[0];
                const step = bfsNextStep(s.id, HUB_STACK);
                if (step !== null) {
                    actionIxs.push(await killGame.methods
                        .moveUnits(s.id, step,
                                   new anchor.BN(s.units.toString()),
                                   new anchor.BN(s.reapers.toString()))
                        .accounts({
                            gameConfig:        gameConfigAddr,
                            fromStack:         agentStackPDA(wallet.publicKey, s.id, GAME_ID),
                            toStack:           agentStackPDA(wallet.publicKey, step, GAME_ID),
                            agentTokenAccount: agentAta.address,
                            gameVault,
                            killMint:          KILL_MINT,
                            agent:             wallet.publicKey,
                        })
                        .instruction()
                    );
                    actionRows.push({ Action: 'RETREAT', Detail: `Stack ${s.id} → ${step} (dist ${s.dist}→hub) | ${fmtPow(s.units)} units`, Result: `${YEL}PENDING${RES}`, Tx: '' });
                    actionTaken = true;
                }
            }
        }

        // ── Priority 4: REFRESH — hub decay exceeds threshold, move out and back ─
        if (!actionTaken && MOVE_ON_DECAY_PERCENT != null && MOVE_ON_DECAY_PERCENT > 0) {
            const hubData = byStack[HUB_STACK]?.mine;
            if (hubData && hubData.units > 0n && hubData.spawnSlot > 0n) {
                const remaining = Number(powerDecayPct(hubData.spawnSlot, currentSlot));
                const decayLost = 100 - remaining; // 0 = fresh, 95 = max decay
                if (decayLost >= MOVE_ON_DECAY_PERCENT) {
                    // Find an adjacent stack to bounce through
                    const adj = bfsNextStep(HUB_STACK, HUB_STACK === 0 ? 1 : HUB_STACK - 1) ?? bfsNextStep(HUB_STACK, HUB_STACK + 1);
                    if (adj !== null) {
                        const fromPDA = agentStackPDA(wallet.publicKey, HUB_STACK, GAME_ID);
                        const toPDA   = agentStackPDA(wallet.publicKey, adj, GAME_ID);
                        const moveAccounts = {
                            gameConfig:        gameConfigAddr,
                            fromStack:         fromPDA,
                            toStack:           toPDA,
                            agentTokenAccount: agentAta.address,
                            gameVault,
                            killMint:          KILL_MINT,
                            agent:             wallet.publicKey,
                        };
                        // Move hub → adjacent
                        actionIxs.push(await killGame.methods
                            .moveUnits(HUB_STACK, adj,
                                       new anchor.BN(hubData.units.toString()),
                                       new anchor.BN(hubData.reapers.toString()))
                            .accounts(moveAccounts)
                            .instruction()
                        );
                        // Move adjacent → hub (resets birth_slot)
                        actionIxs.push(await killGame.methods
                            .moveUnits(adj, HUB_STACK,
                                       new anchor.BN(hubData.units.toString()),
                                       new anchor.BN(hubData.reapers.toString()))
                            .accounts({ ...moveAccounts, fromStack: toPDA, toStack: fromPDA })
                            .instruction()
                        );
                        actionRows.push({ Action: 'REFRESH', Detail: `Hub ${HUB_STACK}→${adj}→${HUB_STACK} | decay ${decayLost}% ≥ ${MOVE_ON_DECAY_PERCENT}%`, Result: `${YEL}PENDING${RES}`, Tx: '' });
                        actionTaken = true;
                    }
                }
            }
        }

        // ── Priority 5: SPAWN — below target units ────────────────────────────
        if (!actionTaken && totalPower < BigInt(TARGET_UNITS)) {
            const hubStack = agentStackPDA(wallet.publicKey, HUB_STACK, GAME_ID);
            actionIxs.push(await killGame.methods
                .spawn(HUB_STACK, new anchor.BN(REPLENISH_AMT))
                .accounts({
                    gameConfig:        gameConfigAddr,
                    agentStack:        hubStack,
                    agentTokenAccount: agentAta.address,
                    gameVault,
                    killMint:          KILL_MINT,
                    agent:             wallet.publicKey,
                })
                .instruction()
            );
            actionRows.push({ Action: 'SPAWN', Detail: `${REPLENISH_AMT} → Hub ${HUB_STACK}`, Result: `${YEL}PENDING${RES}`, Tx: '' });
        }

        // ── Send all instructions in one tx ───────────────────────────────────
        if (actionIxs.length > 0) {
            const tx = new web3.Transaction();
            actionIxs.forEach(ix => tx.add(ix));
            try {
                const sig = await web3.sendAndConfirmTransaction(connection, tx, [wallet]);
                actionRows.forEach(r => { r.Result = `${GRN}OK${RES}`; r.Tx = txLink(sig); });
            } catch (e) {
                actionRows.push({ Action: 'TX', Detail: e.message?.slice(0, 60), Result: `${RED}FAIL${RES}`, Tx: '' });
            }
        }

        // ── Display ───────────────────────────────────────────────────────────
        const strandedRows = myStacks
            .filter(s => s.id !== HUB_STACK)
            .sort((a, b) => a.dist - b.dist || Number(b.units - a.units))
            .map(s => ({
                'ID':      String(s.id),
                'Dist':    String(s.dist),
                'Units':   fmtPow(s.units),
                'Reapers': fmtPow(s.reapers),
                'Power':   fmtPow(s.power),
            }));
        if (strandedRows.length === 0) strandedRows.push({ ID: '—', Dist: '—', Units: '0', Reapers: '0', Power: '0' });

        const sections = [
            { title: `TACTICAL VIEW (Perimeter <= ${HUB_PERIMETER})`, rows: tacticalRows, color: YEL },
            { title: `STRANDED STACKS (${strandedRows.length === 1 && strandedRows[0].ID === '—' ? 0 : strandedRows.length} outside hub)`, rows: strandedRows, color: YEL },
            {
                title: `FORTRESS | Power: ${fmtPow(totalPower)} / ${TARGET_UNITS} | ${totalPower >= BigInt(TARGET_UNITS) ? `${GRN}COMBAT READY${RES}` : `${YEL}BUILDING${RES}`}`,
                rows:  actionRows.length > 0 ? actionRows : [{ Action: 'IDLE', Detail: 'No action required', Result: `${GRN}OK${RES}`, Tx: '' }],
                color: GRN
            }
        ];
        return sections;
    }
};
