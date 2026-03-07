"use strict";
const anchor = require("@coral-xyz/anchor");
const web3   = anchor.web3;
const { getOrCreateAssociatedTokenAccount, getAssociatedTokenAddressSync } = require("@solana/spl-token");
const { CYA, YEL, PNK, RED, RES, calcPower, supabaseQuery, agentStackPDA, txLink } = require('../common');

// Module-level state — persists across slot cycles
let processedKills = new Set();
let pendingAttacks = [];
let isFirstRun     = true;

module.exports = {
    async run({ wallet, killGame, connection, KILL_MINT, GAME_ID, gameVault, gameConfigAddr, config }) {
        const { KILL_MULTIPLIER, MIN_SPAWN, MAX_KILL, SUPABASE_URL, SUPABASE_KEY } = config.settings;
        const myKey = wallet.publicKey.toBase58();

        const agentAta = await getOrCreateAssociatedTokenAccount(
            connection, wallet, KILL_MINT, wallet.publicKey
        );
        const killBal = BigInt(agentAta.amount.toString());
        const rows    = [];

        // ── Phase 1: EXECUTION (pending attack from prior cycle) ──────────────
        if (pendingAttacks.length > 0) {
            const attack = pendingAttacks.shift();

            // Verify target still exists on-chain
            let targetStack = null;
            try {
                const defPDA = agentStackPDA(new web3.PublicKey(attack.target), attack.stackId, GAME_ID);
                targetStack  = await killGame.account.agentStack.fetch(defPDA);
            } catch (_) {}

            if (!targetStack || BigInt(targetStack.units.toString()) === 0n) {
                rows.push({ Phase: 'EXECUTE', Target: attack.target.slice(0, 10), Stack: String(attack.stackId), Detail: 'Target gone', Result: `${YEL}SKIP${RES}`, Tx: '' });
            } else {
                const units   = BigInt(targetStack.units.toString());
                const reapers = BigInt(targetStack.reapers.toString());
                const ep      = calcPower(units, reapers);

                if (ep > BigInt(MAX_KILL)) {
                    rows.push({ Phase: 'EXECUTE', Target: attack.target.slice(0, 10), Stack: String(attack.stackId), Detail: `Power ${ep} > MAX`, Result: `${YEL}SKIP${RES}`, Tx: '' });
                } else {
                    let spawnAmt  = ep * BigInt(KILL_MULTIPLIER);
                    if (spawnAmt < BigInt(MIN_SPAWN)) spawnAmt = BigInt(MIN_SPAWN);
                    const spawnReaper   = spawnAmt / 666n;
                    const attackCostRaw = spawnAmt * 20n * 1_000_000n;

                    if (killBal < attackCostRaw) {
                        rows.push({ Phase: 'EXECUTE', Target: attack.target.slice(0, 10), Stack: String(attack.stackId), Detail: `Need ${Number(attackCostRaw / 1_000_000n).toLocaleString()} KILL`, Result: `${RED}NO KILL${RES}`, Tx: '' });
                    } else {
                        const defenderPubkey  = new web3.PublicKey(attack.target);
                        const attackerStackId = attack.stackId;
                        const defenderStackId = attack.stackId;
                        const attackerStack   = agentStackPDA(wallet.publicKey, attackerStackId, GAME_ID);
                        const defenderStack   = agentStackPDA(defenderPubkey,   defenderStackId, GAME_ID);
                        const defenderAta     = getAssociatedTokenAddressSync(KILL_MINT, defenderPubkey);

                        const tx = new web3.Transaction();
                        tx.add(await killGame.methods
                            .spawn(attackerStackId, new anchor.BN(spawnAmt.toString()))
                            .accounts({
                                gameConfig:        gameConfigAddr,
                                agentStack:        attackerStack,
                                agentTokenAccount: agentAta.address,
                                gameVault,
                                killMint:          KILL_MINT,
                                agent:             wallet.publicKey,
                            })
                            .instruction()
                        );
                        tx.add(await killGame.methods
                            .kill(attackerStackId, defenderStackId,
                                  new anchor.BN(spawnAmt.toString()),
                                  new anchor.BN(spawnReaper.toString()))
                            .accounts({
                                gameConfig:           gameConfigAddr,
                                attackerStack,
                                defenderStack,
                                attackerTokenAccount: agentAta.address,
                                defenderTokenAccount: defenderAta,
                                gameVault,
                                killMint:             KILL_MINT,
                                attacker:             wallet.publicKey,
                                defender:             defenderPubkey,
                            })
                            .instruction()
                        );

                        try {
                            const sig = await web3.sendAndConfirmTransaction(connection, tx, [wallet]);
                            rows.push({ Phase: 'EXECUTE', Target: attack.target.slice(0, 10), Stack: String(attack.stackId), Detail: `Power ${ep} | sent ${spawnAmt}+${spawnReaper}R`, Result: `${CYA}OK${RES}`, Tx: txLink(sig) });
                        } catch (e) {
                            rows.push({ Phase: 'EXECUTE', Target: attack.target.slice(0, 10), Stack: String(attack.stackId), Detail: e.message?.slice(0, 50), Result: `${RED}FAIL${RES}`, Tx: '' });
                        }
                    }
                }
            }
        }

        // ── Phase 2: DETECTION (recent kills from Supabase) ───────────────────
        let recentKills = [];
        try {
            const data = await supabaseQuery(SUPABASE_URL, SUPABASE_KEY, `{
                killedCollection(orderBy: { slot: DescNullsLast }, first: 10) {
                    edges { node { id stack_id defender slot } }
                }
            }`);
            recentKills = (data?.killedCollection?.edges || []).map(e => e.node);
        } catch (_) {}

        if (isFirstRun) {
            recentKills.forEach(k => processedKills.add(k.id));
            rows.push({ Phase: 'BASELINE', Target: '-', Stack: '-', Detail: `${processedKills.size} kills recorded`, Result: `${YEL}WATCHING${RES}`, Tx: '' });
            isFirstRun = false;
        } else {
            for (const k of recentKills) {
                if (processedKills.has(k.id)) continue;
                processedKills.add(k.id);
                if (!k.defender || k.defender === myKey) continue;

                const stackId = parseInt(k.stack_id);
                let targetStack = null;
                try {
                    const defPDA = agentStackPDA(new web3.PublicKey(k.defender), stackId, GAME_ID);
                    targetStack  = await killGame.account.agentStack.fetch(defPDA);
                } catch (_) {}

                if (targetStack) {
                    const units   = BigInt(targetStack.units.toString());
                    const reapers = BigInt(targetStack.reapers.toString());
                    const ep      = calcPower(units, reapers);
                    if (ep > BigInt(MAX_KILL)) {
                        rows.push({ Phase: 'DETECT', Target: k.defender.slice(0, 10), Stack: String(stackId), Detail: `Power ${ep} > MAX`, Result: `${YEL}SKIP${RES}`, Tx: '' });
                    } else if (ep > 0n) {
                        pendingAttacks.push({ stackId, target: k.defender });
                        rows.push({ Phase: 'DETECT', Target: k.defender.slice(0, 10), Stack: String(stackId), Detail: `Power ${ep}`, Result: `${PNK}QUEUED${RES}`, Tx: '' });
                    }
                }
            }
        }

        rows.push({ Phase: 'STATUS', Target: '-', Stack: '-', Detail: `Pending: ${pendingAttacks.length} | KILL: ${Math.round(Number(killBal) / 1e6).toLocaleString()}`, Result: `${CYA}IDLE${RES}`, Tx: '' });
        return [{ title: 'AFTERSHOCK', rows, color: PNK }];
    }
};
