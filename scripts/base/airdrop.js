// hardhat run scripts/base/airdrop.js --network basesepolia
//
// Reads addresses from AIRDROP_FILE, transfers AIRDROP_AMOUNT KILL to each.
// Fires BATCH_SIZE transfers concurrently, waits for all to confirm, then next batch.

const fs   = require("fs");
const path = require("path");

const AIRDROP_FILE   = path.join(__dirname, "pt2.txt");
const AIRDROP_AMOUNT = "666000000000000000000";    // 666 KILL (18 decimals)
const BATCH_SIZE     = 50;

const TRANSFER_ABI = [
    "function transfer(address to, uint256 amount) external returns (bool)"
];

async function main() {
    const [sender] = await ethers.getSigners();
    const killToken = new ethers.Contract(process.env.KILL_TOKEN, TRANSFER_ABI, sender);

    const raw = fs.readFileSync(AIRDROP_FILE, "utf8");
    const addresses = raw.match(/0x[0-9a-fA-F]{40}/g);
    if (!addresses || addresses.length === 0) {
        console.log("No addresses found in", AIRDROP_FILE);
        return;
    }

    console.log(`Airdropping ${ethers.utils.formatEther(AIRDROP_AMOUNT)} KILL to ${addresses.length} addresses`);
    console.log(`Batch size: ${BATCH_SIZE} | Total batches: ${Math.ceil(addresses.length / BATCH_SIZE)}\n`);

    let sent = 0;
    let failed = 0;
    const nonce = await sender.getTransactionCount();

    for (let i = 0; i < addresses.length; i += BATCH_SIZE) {
        const batch = addresses.slice(i, i + BATCH_SIZE);
        const batchNum = Math.floor(i / BATCH_SIZE) + 1;
        const totalBatches = Math.ceil(addresses.length / BATCH_SIZE);

        console.log(`── Batch ${batchNum}/${totalBatches} (${batch.length} tx) ──`);

        // Fire all transfers in this batch concurrently with explicit nonces
        const txPromises = batch.map((addr, j) => {
            const n = nonce + i + j;
            return killToken.transfer(addr, AIRDROP_AMOUNT, { nonce: n })
                .then(tx => tx.wait())
                .then(() => { sent++; return { addr, ok: true }; })
                .catch(e => { failed++; return { addr, ok: false, err: (e.message || "").slice(0, 60) }; });
        });

        const results = await Promise.all(txPromises);
        const failures = results.filter(r => !r.ok);
        if (failures.length > 0) {
            for (const f of failures) console.log(`  FAIL ${f.addr}: ${f.err}`);
        }
        console.log(`  ${sent} sent, ${failed} failed\n`);
    }

    console.log(`Done. ${sent}/${addresses.length} transfers completed, ${failed} failed.`);
}

main();
