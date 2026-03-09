"use strict";
const anchor = require("@coral-xyz/anchor");
const web3   = anchor.web3;
const { getOrCreateAssociatedTokenAccount, getAssociatedTokenAddressSync } = require("@solana/spl-token");
const { GRN, YEL, RED, RES, calcPower, calcEffectivePower, agentStackPDA, txLink } = require('../common');

function fmtPow(n) {
    const v = Number(n);
    if (v >= 1e9) return (v / 1e9).toFixed(1) + 'B';
    if (v >= 1e6) return (v / 1e6).toFixed(1) + 'M';
    if (v >= 1e3) return Math.round(v / 1e3) + 'K';
    return String(Math.round(v));
}

module.exports = {
    async run({ wallet, killGame, connection, KILL_MINT, GAME_ID, gameVault, gameConfigAddr, config }) {
        const { KILL_MULTIPLIER } = config.settings;
        const nukeSettings = config.settings.nuke || {};
        const rawStacks = nukeSettings.TARGET_STACKS || [];
        const TARGET_STACKS = Array.isArray(rawStacks)
            ? rawStacks.map(Number)
            : String(rawStacks).split(',').map(s => parseInt(s.trim())).filter(n => !isNaN(n));

        const myKey = wallet.publicKey.toBase58();

        const agentAta = await getOrCreateAssociatedTokenAccount(
            connection, wallet, KILL_MINT, wallet.publicKey
        );

        const SPAWN_COST = 20_000_000n; // microKILL per unit (matches contract)
        let killBalance  = BigInt(agentAta.amount.toString());
        const currentSlot = BigInt(await connection.getSlot());

        // Fetch all on-chain stacks
        const allStacks = await killGame.account.agentStack.all([]);

        // Group by stack_id
        const byStack = {};
        for (const { account: s } of allStacks) {
            const id = s.stackId;
            if (!TARGET_STACKS.includes(id)) continue;
            if (!byStack[id]) byStack[id] = { mine: null, enemies: [] };
            const units   = BigInt(s.units.toString());
            const reapers = BigInt(s.reapers.toString());
            const spawnSlot = BigInt(s.spawnSlot.toString());
            if (s.agent.toBase58() === myKey) {
                byStack[id].mine = { units, reapers, power: calcPower(units, reapers) };
            } else if (units > 0n || reapers > 0n) {
                byStack[id].enemies.push({ agent: s.agent, units, reapers, power: calcEffectivePower(units, reapers, spawnSlot, currentSlot) });
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

            // Sort strongest first — biggest threat first, clear all remaining each run
            const sortedEnemies = [...enemies].sort((a, b) => (a.power > b.power ? -1 : 1));
            scanRows.push({
                Stack:    String(stackId),
                Enemy:    `${sortedEnemies[0].agent.toBase58().slice(0, 10)} +${sortedEnemies.length - 1}`,
                EnemyPow: fmtPow(sortedEnemies[0].power),
                Status:   `${RED}HOSTILE(${sortedEnemies.length})${RES}`,
            });

            // Track attacker's running unit count locally — attacker keeps all units on win
            let myUnits   = mine ? mine.units   : 0n;
            let myReapers = mine ? mine.reapers : 0n;

            for (const target of sortedEnemies) {
                const neededPower  = target.power * BigInt(KILL_MULTIPLIER);
                const currentPower = calcPower(myUnits, myReapers);

                let spawnUnits = 0n;
                if (currentPower < neededPower) {
                    const desired    = neededPower - currentPower;
                    const affordable = killBalance / SPAWN_COST;
                    spawnUnits = desired < affordable ? desired : affordable;
                }

                const sendUnits   = myUnits   + spawnUnits;
                // spawn auto-grants 1 reaper per 666 units spawned (matches contract)
                const sendReapers = myReapers + spawnUnits / 666n;
                const defenderAta = getAssociatedTokenAddressSync(KILL_MINT, target.agent);

                const ixs = [];

                if (spawnUnits > 0n) {
                    ixs.push(await killGame.methods
                        .spawn(stackId, new anchor.BN(spawnUnits.toString()))
                        .accounts({
                            gameConfig:        gameConfigAddr,
                            agentStack:        agentStackPDA(wallet.publicKey, stackId, GAME_ID),
                            agentTokenAccount: agentAta.address,
                            gameVault,
                            killMint:          KILL_MINT,
                            agent:             wallet.publicKey,
                        })
                        .instruction()
                    );
                }

                ixs.push(await killGame.methods
                    .kill(stackId, stackId,
                          new anchor.BN(sendUnits.toString()),
                          new anchor.BN(sendReapers.toString()))
                    .accounts({
                        gameConfig:           gameConfigAddr,
                        attackerStack:        agentStackPDA(wallet.publicKey, stackId, GAME_ID),
                        defenderStack:        agentStackPDA(target.agent, stackId, GAME_ID),
                        attackerTokenAccount: agentAta.address,
                        defenderTokenAccount: defenderAta,
                        gameVault,
                        killMint:             KILL_MINT,
                        attacker:             wallet.publicKey,
                        defender:             target.agent,
                    })
                    .instruction()
                );

                try {
                    const tx = new web3.Transaction();
                    ixs.forEach(ix => tx.add(ix));
                    const sig = await web3.sendAndConfirmTransaction(connection, tx, [wallet]);
                    actionRows.push({
                        Action: spawnUnits > 0n ? 'SPAWN+KILL' : 'KILL',
                        Stack:  String(stackId),
                        Detail: `${target.agent.toBase58().slice(0, 10)} | sent:${fmtPow(sendUnits)} def:${fmtPow(target.power)}`,
                        Result: `${GRN}OK${RES}`,
                        Tx:     txLink(sig),
                    });
                    // Attacker wins → keeps all units sent; update local tracking for next target
                    myUnits      = sendUnits;
                    myReapers    = sendReapers;
                    killBalance -= spawnUnits * SPAWN_COST;
                } catch (e) {
                    actionRows.push({
                        Action: spawnUnits > 0n ? 'SPAWN+KILL' : 'KILL',
                        Stack:  String(stackId),
                        Detail: e.message?.slice(0, 50),
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
