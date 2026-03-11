"use strict";
const anchor = require("@coral-xyz/anchor");
const web3   = anchor.web3;
const { getOrCreateAssociatedTokenAccount, getAccount } = require("@solana/spl-token");
const { GRN, YEL, RED, RES, claimFaucet, agentStackPDA, txLink } = require('../common');

const SPAWN_COST_RAW = 20n * 1_000_000n; // 20 KILL per unit, 6 decimals

module.exports = {
    async init({ wallet, killFaucet, connection, KILL_MINT, FAUCET_ID }) {
        await claimFaucet(killFaucet, wallet, connection, KILL_MINT, FAUCET_ID);
    },

    async run({ wallet, killGame, connection, KILL_MINT, GAME_ID, gameVault, gameConfigAddr, config }) {
        const { SEED_AMOUNT, BATCH_SEED } = config.settings;

        const agentAta = await getOrCreateAssociatedTokenAccount(
            connection, wallet, KILL_MINT, wallet.publicKey
        );
        const killBal      = BigInt(agentAta.amount.toString());
        const totalRawCost = BigInt(SEED_AMOUNT) * BigInt(BATCH_SEED) * SPAWN_COST_RAW;
        const rows         = [];

        if (killBal < totalRawCost) {
            rows.push({
                Action: 'SEED',
                Detail: `Need ${Number(totalRawCost / 1_000_000n).toLocaleString()} KILL, have ${Number(killBal / 1_000_000n).toLocaleString()}`,
                Result: `${RED}NO KILL${RES}`,
                Tx: ''
            });
            return [{ title: 'SEED', rows, color: GRN }];
        }

        // Pick BATCH_SEED unique random stacks (0-based 0–215)
        const selected = [];
        while (selected.length < BATCH_SEED) {
            const s = Math.floor(Math.random() * 216);
            if (!selected.includes(s)) selected.push(s);
        }

        // Build one transaction with all spawn instructions
        const tx = new web3.Transaction();
        for (const stackId of selected) {
            const agentStack = agentStackPDA(wallet.publicKey, stackId, GAME_ID);
            const ix = await killGame.methods
                .spawn(stackId, new anchor.BN(SEED_AMOUNT))
                .accounts({
                    gameConfig:        gameConfigAddr,
                    agentStack,
                    agentTokenAccount: agentAta.address,
                    gameVault,
                    killMint:          KILL_MINT,
                    agent:             wallet.publicKey,
                })
                .instruction();
            tx.add(ix);
        }

        try {
            const sig = await web3.sendAndConfirmTransaction(connection, tx, [wallet]);
            rows.push({
                Action: 'SEED',
                Detail: `${BATCH_SEED} stacks × ${SEED_AMOUNT} units`,
                Result: `${GRN}OK${RES}`,
                Tx:     txLink(sig)
            });
        } catch (e) {
            rows.push({ Action: 'SEED', Detail: e.message?.slice(0, 60), Result: `${RED}FAIL${RES}`, Tx: '' });
        }

        const refreshed = await getAccount(connection, agentAta.address).catch(() => ({ amount: killBal }));
        rows.push({
            Action: 'STATUS',
            Detail: `KILL: ${Math.round(Number(BigInt(refreshed.amount.toString())) / 1e6).toLocaleString()}`,
            Result: BigInt(refreshed.amount.toString()) > totalRawCost * 5n ? `${GRN}READY${RES}` : `${YEL}LOW KILL${RES}`,
            Tx:     ''
        });

        return [{ title: 'SEED', rows, color: GRN }];
    }
};
