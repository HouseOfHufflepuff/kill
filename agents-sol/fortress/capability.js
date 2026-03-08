"use strict";
const anchor = require("@coral-xyz/anchor");
const web3   = anchor.web3;
const { getOrCreateAssociatedTokenAccount, getAssociatedTokenAddressSync } = require("@solana/spl-token");
const { GRN, YEL, RED, RES, getManhattanDist, isAdjacent, calcPower,
        agentStackPDA, gameConfigPDA, txLink } = require('../common');

function fmtPow(n) {
    const v = Number(n);
    if (v >= 1e9) return (v / 1e9).toFixed(1) + 'B';
    if (v >= 1e6) return (v / 1e6).toFixed(1) + 'M';
    if (v >= 1e3) return Math.round(v / 1e3) + 'K';
    return String(Math.round(v));
}

function topEnemy(enemies) {
    return [...enemies].sort((a, b) =>
        calcPower(b.units, b.reapers) > calcPower(a.units, a.reapers) ? 1 : -1
    )[0];
}

module.exports = {
    async run({ wallet, killGame, connection, KILL_MINT, GAME_ID, gameVault, gameConfigAddr, config }) {
        const { HUB_STACK, TARGET_UNITS, REPLENISH_AMT, HUB_PERIMETER, KILL_MULTIPLIER } = config.settings;
        const myKey = wallet.publicKey.toBase58();

        const agentAta = await getOrCreateAssociatedTokenAccount(
            connection, wallet, KILL_MINT, wallet.publicKey
        );

        // Fetch all on-chain stacks for all agents
        const allStacks = await killGame.account.agentStack.all([]);

        // Group by stack_id
        const byStack = {};
        for (const { account: s } of allStacks) {
            const id = s.stackId;
            if (!byStack[id]) byStack[id] = { mine: null, enemies: [] };
            const isMe = s.agent.toBase58() === myKey;
            const units   = BigInt(s.units.toString());
            const reapers = BigInt(s.reapers.toString());
            if (isMe) {
                byStack[id].mine = { agent: s.agent, stackId: id, units, reapers, power: calcPower(units, reapers) };
            } else if (units > 0n || reapers > 0n) {
                byStack[id].enemies.push({ agent: s.agent, stackId: id, units, reapers, power: calcPower(units, reapers) });
            }
        }

        // Aggregate totals
        let totalPower   = 0n;
        let myStacks     = [];
        let hubState     = { mine: null, enemies: [] };
        let validTargets = [];
        const tacticalRows = [];
        const SAFE_ZONE  = Array.from({ length: 216 }, (_, i) => i).filter(id => getManhattanDist(HUB_STACK, id) <= HUB_PERIMETER);

        // Aggregate my stacks and hub state from on-chain data
        for (const [idStr, { mine, enemies }] of Object.entries(byStack)) {
            const id = parseInt(idStr);
            if (mine && (mine.units > 0n || mine.reapers > 0n)) {
                totalPower += mine.power;
                const dist = getManhattanDist(HUB_STACK, id);
                myStacks.push({ ...mine, id, dist });
                if (id === HUB_STACK) hubState.mine = mine;
            }
            if (id === HUB_STACK) hubState.enemies = enemies;
        }

        // Build tactical rows for ALL positions in perimeter (including empty ones)
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

        const hasReachedTarget = totalPower >= BigInt(TARGET_UNITS);
        const actionIxs  = [];
        const actionRows = [];

        if (!hasReachedTarget) {
            // Spawn at hub to build power
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

            // Retreat ALL stranded stacks toward hub (bundled in same tx)
            const ALL_IDS  = Array.from({ length: 216 }, (_, i) => i);
            const stranded = myStacks.filter(s => s.id !== HUB_STACK);
            for (const s of stranded) {
                const step = ALL_IDS.filter(id => isAdjacent(s.id, id))
                    .sort((a, b) => getManhattanDist(a, HUB_STACK) - getManhattanDist(b, HUB_STACK))[0];
                if (step !== undefined) {
                    actionIxs.push(await killGame.methods
                        .moveUnits(s.id, step, new anchor.BN(s.units.toString()), new anchor.BN(s.reapers.toString()))
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
                    actionRows.push({ Action: 'RETREAT', Detail: `Stack ${s.id} → ${step}`, Result: `${YEL}PENDING${RES}`, Tx: '' });
                }
            }
        } else {
            // Combat mode
            if (hubState.enemies.length > 0 && hubState.mine) {
                const top      = topEnemy(hubState.enemies);
                const myPow    = hubState.mine.power;
                const needed   = top.power * BigInt(KILL_MULTIPLIER);
                if (myPow >= needed) {
                    const defenderAta = getAssociatedTokenAddressSync(KILL_MINT, top.agent);
                    actionIxs.push(await killGame.methods
                        .kill(HUB_STACK, HUB_STACK,
                              new anchor.BN(hubState.mine.units.toString()),
                              new anchor.BN(hubState.mine.reapers.toString()))
                        .accounts({
                            gameConfig:           gameConfigAddr,
                            attackerStack:        agentStackPDA(wallet.publicKey, HUB_STACK, GAME_ID),
                            defenderStack:        agentStackPDA(top.agent, HUB_STACK, GAME_ID),
                            attackerTokenAccount: agentAta.address,
                            defenderTokenAccount: defenderAta,
                            gameVault,
                            killMint:             KILL_MINT,
                            attacker:             wallet.publicKey,
                            defender:             top.agent,
                        })
                        .instruction()
                    );
                    actionRows.push({ Action: 'KILL', Detail: `${top.agent.toBase58().slice(0, 10)} @ HUB | sent:${fmtPow(myPow)} def:${fmtPow(top.power)}`, Result: `${RED}PENDING${RES}`, Tx: '' });
                } else {
                    actionRows.push({ Action: 'HUB', Detail: `Outgunned ${fmtPow(myPow)}/${fmtPow(top.power)} (need ${KILL_MULTIPLIER}x)`, Result: `${YEL}WAIT${RES}`, Tx: '' });
                }
            } else if (validTargets.length > 0 && myStacks.length > 0) {
                const raid = validTargets.sort((a, b) => a.dist - b.dist)[0];
                const army = myStacks.sort((a, b) => Number(b.power - a.power))[0];
                if (army.power >= raid.enemyPower * BigInt(KILL_MULTIPLIER)) {
                    if (army.id === raid.id) {
                        const defenderAta = getAssociatedTokenAddressSync(KILL_MINT, raid.target.agent);
                        actionIxs.push(await killGame.methods
                            .kill(raid.id, raid.id,
                                  new anchor.BN(army.units.toString()),
                                  new anchor.BN(army.reapers.toString()))
                            .accounts({
                                gameConfig:           gameConfigAddr,
                                attackerStack:        agentStackPDA(wallet.publicKey, raid.id, GAME_ID),
                                defenderStack:        agentStackPDA(raid.target.agent, raid.id, GAME_ID),
                                attackerTokenAccount: agentAta.address,
                                defenderTokenAccount: defenderAta,
                                gameVault,
                                killMint:             KILL_MINT,
                                attacker:             wallet.publicKey,
                                defender:             raid.target.agent,
                            })
                            .instruction()
                        );
                        actionRows.push({ Action: 'KILL', Detail: `${raid.target.agent.toBase58().slice(0, 10)} @ ${raid.id}`, Result: `${RED}PENDING${RES}`, Tx: '' });
                    } else {
                        const ALL_IDS = Array.from({ length: 216 }, (_, i) => i);
                        const step = ALL_IDS.filter(id => isAdjacent(army.id, id))
                            .sort((a, b) => getManhattanDist(a, raid.id) - getManhattanDist(b, raid.id))[0];
                        if (step !== undefined) {
                            actionIxs.push(await killGame.methods
                                .moveUnits(army.id, step,
                                           new anchor.BN(army.units.toString()),
                                           new anchor.BN(army.reapers.toString()))
                                .accounts({
                                    gameConfig:        gameConfigAddr,
                                    fromStack:         agentStackPDA(wallet.publicKey, army.id, GAME_ID),
                                    toStack:           agentStackPDA(wallet.publicKey, step, GAME_ID),
                                    agentTokenAccount: agentAta.address,
                                    gameVault,
                                    killMint:          KILL_MINT,
                                    agent:             wallet.publicKey,
                                })
                                .instruction()
                            );
                            actionRows.push({ Action: 'MOVE', Detail: `Stack ${army.id} → ${step} (→ ${raid.id})`, Result: `${YEL}PENDING${RES}`, Tx: '' });
                        }
                    }
                }
            }
        }

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

        const sections = [{ title: `TACTICAL VIEW (Perimeter <= ${HUB_PERIMETER})`, rows: tacticalRows, color: YEL }];
        sections.push({
            title: `FORTRESS | Power: ${fmtPow(totalPower)} / ${TARGET_UNITS} | ${hasReachedTarget ? `${GRN}COMBAT READY${RES}` : `${YEL}BUILDING${RES}`}`,
            rows:  actionRows,
            color: GRN
        });
        return sections;
    }
};
