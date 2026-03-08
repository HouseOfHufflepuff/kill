"use strict";
const anchor = require("@coral-xyz/anchor");
const web3   = anchor.web3;
const { getOrCreateAssociatedTokenAccount, getAssociatedTokenAddressSync, TOKEN_PROGRAM_ID } = require("@solana/spl-token");
const { CYA, YEL, GRN, RED, PNK, RES, claimFaucet, agentStackPDA, calcPower, txLink } = require('../common');

const SPAWN_COST_RAW    = 20n * 1_000_000n; // 20 KILL per unit (6 decimals)
const THERMAL_PARITY    = 666n;             // reaper power multiplier
const SLOTS_PER_MULT    = 13_224n;          // slots per bounty multiplier step
const MAX_MULT          = 50n;              // bounty multiplier cap
const BURN_BPS          = 666n;             // 6.66% burn on payout
const BPS_DENOM         = 10_000n;
const ORG = "\x1b[38;5;214m";

module.exports = {
    async init({ wallet, killFaucet, connection, KILL_MINT, FAUCET_ID }) {
        await claimFaucet(killFaucet, wallet, connection, KILL_MINT, FAUCET_ID);
    },

    async run({ wallet, killGame, connection, KILL_MINT, GAME_ID, gameVault, gameConfigAddr, config }) {
        const { KILL_MULTIPLIER, SPAWN_PROFITABILITY_THRESHOLD, MIN_SPAWN } = config.settings;
        const myKey = wallet.publicKey.toBase58();

        const agentAta = await getOrCreateAssociatedTokenAccount(
            connection, wallet, KILL_MINT, wallet.publicKey
        );
        const killBal = BigInt(agentAta.amount.toString());

        const currentSlot = BigInt(await connection.getSlot());

        // Fetch all on-chain stacks
        const allStacks = await killGame.account.agentStack.all([]);

        // Build candidate targets: enemy stacks with units or reapers
        const targets = [];
        for (const { account: s } of allStacks) {
            if (s.agent.toBase58() === myKey) continue;
            const units   = BigInt(s.units.toString());
            const reapers = BigInt(s.reapers.toString());
            if (units === 0n && reapers === 0n) continue;

            // Age-based bounty multiplier (mirrors get_pending_bounty in kill.rs)
            const spawnSlot = BigInt(s.spawnSlot.toString());
            const age       = currentSlot > spawnSlot ? currentSlot - spawnSlot : 0n;
            const mult      = (1n + age / SLOTS_PER_MULT) < MAX_MULT
                ? (1n + age / SLOTS_PER_MULT) : MAX_MULT;

            // Expected bounty (before vault cap): power × SPAWN_COST × mult, after burn
            const power       = units + reapers * THERMAL_PARITY;
            const rawBounty   = power * SPAWN_COST_RAW * mult;
            const netBounty   = rawBounty - (rawBounty * BURN_BPS / BPS_DENOM); // human after burn
            const bountyHuman = netBounty / 1_000_000n; // convert to human KILL

            const enemyPower = calcPower(units, reapers);
            let   spawnAmt   = enemyPower * BigInt(KILL_MULTIPLIER);
            if (spawnAmt < BigInt(MIN_SPAWN)) spawnAmt = BigInt(MIN_SPAWN);
            const spawnReaper   = spawnAmt / THERMAL_PARITY;
            const totalPower    = spawnAmt + spawnReaper * THERMAL_PARITY;
            const attackCostRaw = totalPower * SPAWN_COST_RAW;
            const ratio = attackCostRaw > 0n
                ? parseFloat((bountyHuman * 1_000_000n / (attackCostRaw / 1_000_000n)).toString()) / 1_000_000
                : 0;

            targets.push({
                stackId:    s.stackId,
                defender:   s.agent,
                units, reapers, mult,
                ratio, spawnAmt, spawnReaper, bountyHuman, attackCostRaw
            });
        }

        const threshold  = parseFloat(SPAWN_PROFITABILITY_THRESHOLD);
        const sorted     = targets.sort((a, b) => b.ratio - a.ratio);
        const targetRows = sorted.slice(0, 10).map(t => {
            let ratioColor = t.ratio >= threshold ? GRN : t.ratio >= threshold * 0.5 ? YEL : ORG;
            const status   = t.ratio < threshold ? 'LOW_ROI' : killBal < t.attackCostRaw ? 'NO_KILL' : 'READY';
            const scolor   = t.ratio < threshold ? ORG : killBal < t.attackCostRaw ? YEL : GRN;
            return {
                'ID':     String(t.stackId),
                'Enemy':  t.defender.toBase58().slice(0, 10),
                'Units':  t.units.toString(),
                'Mult':   `${t.mult}x`,
                'Ratio':  `${ratioColor}${t.ratio.toFixed(2)}x${RES}`,
                'Status': `${scolor}${status}${RES}`,
            };
        });

        const actionRows = [];
        const best = sorted[0];

        if (best && best.ratio >= threshold && killBal >= best.attackCostRaw) {
            const attackerStackId  = best.stackId;
            const defenderStackId  = best.stackId;
            const attackerStack    = agentStackPDA(wallet.publicKey,  attackerStackId, GAME_ID);
            const defenderStack    = agentStackPDA(best.defender,      defenderStackId, GAME_ID);
            const defenderTokenAcc = getAssociatedTokenAddressSync(KILL_MINT, best.defender);

            const tx = new web3.Transaction();

            // Spawn at target's stack
            tx.add(await killGame.methods
                .spawn(attackerStackId, new anchor.BN(best.spawnAmt.toString()))
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

            // Kill the defender
            tx.add(await killGame.methods
                .kill(attackerStackId, defenderStackId, new anchor.BN(best.spawnAmt.toString()), new anchor.BN(best.spawnReaper.toString()))
                .accounts({
                    gameConfig:           gameConfigAddr,
                    attackerStack,
                    defenderStack,
                    attackerTokenAccount: agentAta.address,
                    defenderTokenAccount: defenderTokenAcc,
                    gameVault,
                    killMint:             KILL_MINT,
                    attacker:             wallet.publicKey,
                    defender:             best.defender,
                })
                .instruction()
            );

            try {
                const sig = await web3.sendAndConfirmTransaction(connection, tx, [wallet]);
                actionRows.push({
                    Action: 'SNIPE',
                    Detail: `Stack ${best.stackId} | ${best.defender.toBase58().slice(0, 10)} | ${best.ratio.toFixed(2)}x`,
                    Result: `${GRN}OK${RES}`,
                    Tx:     txLink(sig)
                });
            } catch (e) {
                actionRows.push({ Action: 'SNIPE', Detail: e.message?.slice(0, 60), Result: `${RED}FAIL${RES}`, Tx: '' });
            }
        }

        const sections = [{ title: 'SNIPER TARGETS', rows: targetRows, color: YEL }];
        if (actionRows.length > 0) sections.push({ title: 'SNIPER ACTION', rows: actionRows, color: CYA });
        return sections;
    }
};
