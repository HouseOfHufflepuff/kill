"use strict";
// node scripts-solana/stacks.js [wallet_pubkey]
// Lists all on-chain AgentStack accounts for a wallet (defaults to your keypair).
//
// Example:
//   node scripts-solana/stacks.js
//   node scripts-solana/stacks.js <other_wallet_address>

const { setup } = require("./common");
const anchor = require("@coral-xyz/anchor");

async function main() {
    const { wallet, killGame } = await setup();
    const { web3 } = require("@coral-xyz/anchor");

    const target = process.argv[2]
        ? new web3.PublicKey(process.argv[2])
        : wallet.publicKey;

    console.log(`\nStacks for: ${target.toBase58()}\n`);

    // Fetch all AgentStack accounts owned by this agent
    const stacks = await killGame.account.agentStack.all([
        {
            memcmp: {
                offset: 8,           // skip 8-byte Anchor discriminator
                bytes:  target.toBase58()
            }
        }
    ]);

    if (stacks.length === 0) {
        console.log("  No stacks found — spawn first.\n");
        return;
    }

    // Grid coords from stack_id:  x = id%6, y = (id/6)%6, z = id/36
    const coord = id => `(${id%6},${Math.floor(id/6)%6},${Math.floor(id/36)})`;

    console.log(`${"ID".padEnd(5)} ${"XYZ".padEnd(9)} ${"Units".padStart(12)} ${"Reapers".padStart(10)}`);
    console.log("─".repeat(40));
    stacks
        .sort((a, b) => a.account.stackId - b.account.stackId)
        .forEach(({ account: s }) => {
            console.log(
                `${String(s.stackId).padEnd(5)} ${coord(s.stackId).padEnd(9)} ` +
                `${s.units.toString().padStart(12)} ${s.reapers.toString().padStart(10)}`
            );
        });
    console.log();
}

main().catch(e => { console.error(e.message || e); process.exit(1); });
