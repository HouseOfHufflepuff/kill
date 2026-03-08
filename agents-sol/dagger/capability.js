"use strict";
const anchor = require("@coral-xyz/anchor");
const web3   = anchor.web3;
const { getOrCreateAssociatedTokenAccount, getAssociatedTokenAddressSync } = require("@solana/spl-token");
const { CYA, YEL, GRN, RED, RES, calcPower, agentStackPDA, txLink } = require('../common');

module.exports = {
    async run({ wallet, killGame, connection, KILL_MINT, GAME_ID, gameVault, gameConfigAddr, config }) {
        const { DAGGER_STACK, KILL_MULTIPLIER } = config.settings;
        const myKey = wallet.publicKey.toBase58();

        const agentAta = await getOrCreateAssociatedTokenAccount(
            connection, wallet, KILL_MINT, wallet.publicKey
        );

        // Fetch all on-chain stacks
        const allStacks = await killGame.account.agentStack.all([]);

        let myStack   = null;
        const enemies = [];

        for (const { account: s } of allStacks) {
            if (s.stackId !== DAGGER_STACK) continue;

            const units   = BigInt(s.units.toString());
            const reapers = BigInt(s.reapers.toString());

            if (s.agent.toBase58() === myKey) {
                myStack = { units, reapers, power: calcPower(units, reapers) };
            } else if (units > 0n || reapers > 0n) {
                enemies.push({ agent: s.agent, units, reapers, power: calcPower(units, reapers) });
            }
        }

        // Scan rows for display
        const scanRows = [...enemies]
            .sort((a, b) => (a.power > b.power ? -1 : 1))
            .map(e => ({
                'Enemy': e.agent.toBase58().slice(0, 10),
                'Units': e.units.toString(),
                'Power': e.power.toString(),
            }));

        if (scanRows.length === 0) scanRows.push({ Enemy: '—', Units: '—', Power: '—' });

        const actionRows = [];

        if (!myStack || myStack.power === 0n) {
            actionRows.push({ Action: 'DAGGER', Detail: `No units at Stack ${DAGGER_STACK} — spawn here first`, Result: `${YEL}IDLE${RES}`, Tx: '' });
        } else {
            // Sort enemies by power descending — pick the strongest viable target
            const sorted = [...enemies].sort((a, b) => (a.power > b.power ? -1 : 1));
            let attacked = false;

            for (const target of sorted) {
                const needed = target.power * BigInt(KILL_MULTIPLIER);
                if (myStack.power >= needed) {
                    const defenderAta = getAssociatedTokenAddressSync(KILL_MINT, target.agent);
                    try {
                        const tx = new web3.Transaction().add(
                            await killGame.methods
                                .kill(
                                    DAGGER_STACK,
                                    DAGGER_STACK,
                                    new anchor.BN(myStack.units.toString()),
                                    new anchor.BN(myStack.reapers.toString())
                                )
                                .accounts({
                                    gameConfig:           gameConfigAddr,
                                    attackerStack:        agentStackPDA(wallet.publicKey, DAGGER_STACK, GAME_ID),
                                    defenderStack:        agentStackPDA(target.agent,     DAGGER_STACK, GAME_ID),
                                    attackerTokenAccount: agentAta.address,
                                    defenderTokenAccount: defenderAta,
                                    gameVault,
                                    killMint:             KILL_MINT,
                                    attacker:             wallet.publicKey,
                                    defender:             target.agent,
                                })
                                .instruction()
                        );
                        const sig = await web3.sendAndConfirmTransaction(connection, tx, [wallet]);
                        actionRows.push({
                            Action: 'DAGGER',
                            Detail: `${target.agent.toBase58().slice(0, 10)} @ Stack ${DAGGER_STACK} | pow:${myStack.power}/${target.power}`,
                            Result: `${GRN}OK${RES}`,
                            Tx:     txLink(sig)
                        });
                    } catch (e) {
                        actionRows.push({ Action: 'DAGGER', Detail: e.message?.slice(0, 60), Result: `${RED}FAIL${RES}`, Tx: '' });
                    }
                    attacked = true;
                    break;
                }
            }

            if (!attacked) {
                actionRows.push({ Action: 'DAGGER', Detail: `No viable target (my pow:${myStack.power}, need ${KILL_MULTIPLIER}x enemy)`, Result: `${YEL}SKIP${RES}`, Tx: '' });
            }
        }

        return [
            { title: `DAGGER SCAN — Stack ${DAGGER_STACK} (${enemies.length} enemies on-chain)`, rows: scanRows,   color: CYA },
            { title: 'DAGGER ACTION',                                                              rows: actionRows, color: RED },
        ];
    }
};
