"use strict";
const { ethers } = require("hardhat");
const { GRN, YEL, RED, RES, claimFaucet } = require('../common');

module.exports = {
    async init({ wallet, killFaucet }) {
        await claimFaucet(killFaucet, wallet.address);
    },

    async run({ wallet, killGame, killToken, config }) {
        const { SEED_AMOUNT, BATCH_SEED } = config.settings;
        const { kill_game_addr } = config.network;

        const ethBalance   = await wallet.getBalance();
        const killBalRaw   = await killToken.balanceOf(wallet.address);
        const allowanceRaw = await killToken.allowance(wallet.address, kill_game_addr);
        const stack119     = await killGame.balanceOf(wallet.address, 119);

        const rows = [];

        const totalKillNeeded   = ethers.BigNumber.from(BATCH_SEED).mul(SEED_AMOUNT).mul(20);
        const requiredAllowance = ethers.utils.parseUnits(totalKillNeeded.toString(), 18);
        if (allowanceRaw.lt(requiredAllowance)) {
            await (await killToken.connect(wallet).approve(kill_game_addr, ethers.constants.MaxUint256)).wait();
            rows.push({ Action: 'APPROVE', Detail: 'MaxUint256', Result: `${GRN}OK${RES}` });
        }

        if (ethBalance.lt(ethers.utils.parseEther("0.005"))) {
            return [{ title: 'SEED', rows: [{ Action: 'SEED', Detail: 'ETH critically low', Result: `${RED}SKIP${RES}` }] }];
        }

        const encodedCalls = [];
        const selected     = [];
        for (let i = 0; i < BATCH_SEED; i++) {
            let s;
            do { s = Math.floor(Math.random() * 216) + 1; } while (selected.includes(s));
            selected.push(s);
            encodedCalls.push(killGame.interface.encodeFunctionData("spawn", [s, SEED_AMOUNT]));
        }

        try {
            const gasEst  = await killGame.connect(wallet).estimateGas.multicall(encodedCalls);
            const feeData = await ethers.provider.getFeeData();
            const estCost = gasEst.mul(feeData.maxFeePerGas || feeData.gasPrice);
            if (estCost.gt(ethBalance)) {
                rows.push({ Action: 'SEED', Detail: 'Gas exceeds balance', Result: `${RED}SKIP${RES}` });
            } else {
                const tx = await killGame.connect(wallet).multicall(encodedCalls, { gasLimit: gasEst.mul(150).div(100) });
                await tx.wait();
                const txLinkStr = config.network.block_explorer ? `\x1b[4m↗ ${config.network.block_explorer}/${tx.hash}\x1b[24m` : '';
                rows.push({ Action: 'SEED', Detail: `${BATCH_SEED} stacks × ${SEED_AMOUNT} units`, Result: `${GRN}OK${RES}`, Tx: txLinkStr });
            }
        } catch (e) {
            rows.push({ Action: 'SEED', Detail: e.reason || e.message, Result: `${RED}FAIL${RES}` });
        }

        rows.push({
            Action: 'STATUS',
            Detail: `Stack119: ${stack119} | KILL: ${Math.round(parseFloat(ethers.utils.formatEther(killBalRaw))).toLocaleString()}`,
            Result: ethBalance.gt(ethers.utils.parseEther("0.01")) ? `${GRN}READY${RES}` : `${YEL}LOW ETH${RES}`
        });

        rows.forEach(r => { if (r.Tx === undefined) r.Tx = ''; });
        return [{ title: 'SEED', rows, color: GRN }];
    }
};
