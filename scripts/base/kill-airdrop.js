// hardhat run scripts/base/kill-airdrop.js --network base
//
// Reads airdrop.csv (address,amount), transfers KILL from deployer to each address.
// Fires BATCH_SIZE transfers concurrently, waits for all to confirm, then next batch.

const fs   = require("fs");
const path = require("path");

const AIRDROP_FILE = path.join(__dirname, "../../airdrop.csv");
const BATCH_SIZE   = 50;

const TRANSFER_ABI = [
    "function transfer(address to, uint256 amount) external returns (bool)"
];

async function main() {
    const [sender] = await ethers.getSigners();
    const killToken = new ethers.Contract(process.env.KILL_TOKEN, TRANSFER_ABI, sender);

    const raw = fs.readFileSync(AIRDROP_FILE, "utf8");
    const lines = raw.trim().split("\n").slice(1); // skip header

    const entries = lines
        .map(line => {
            const [address, amount] = line.split(",");
            if (!address || !amount) return null;
            return { address: address.trim(), amount: amount.trim() };
        })
        .filter(Boolean);

    if (entries.length === 0) {
        console.log("No entries found in", AIRDROP_FILE);
        return;
    }

    // Convert human-readable amounts to 18-decimal wei
    const transfers = entries.map(e => ({
        address: e.address,
        amount: ethers.utils.parseEther(e.amount)
    }));

    const totalKill = transfers.reduce((sum, t) => sum.add(t.amount), ethers.BigNumber.from(0));
    console.log(`Airdropping to ${transfers.length} addresses`);
    console.log(`Total KILL: ${ethers.utils.formatEther(totalKill)}`);
    console.log(`Batch size: ${BATCH_SIZE} | Total batches: ${Math.ceil(transfers.length / BATCH_SIZE)}\n`);

    let sent = 0;
    let failed = 0;
    const nonce = await sender.getTransactionCount();

    for (let i = 0; i < transfers.length; i += BATCH_SIZE) {
        const batch = transfers.slice(i, i + BATCH_SIZE);
        const batchNum = Math.floor(i / BATCH_SIZE) + 1;
        const totalBatches = Math.ceil(transfers.length / BATCH_SIZE);

        console.log(`── Batch ${batchNum}/${totalBatches} (${batch.length} tx) ──`);

        const txPromises = batch.map((entry, j) => {
            const n = nonce + i + j;
            return killToken.transfer(entry.address, entry.amount, { nonce: n })
                .then(tx => tx.wait())
                .then(() => { sent++; return { addr: entry.address, ok: true }; })
                .catch(e => { failed++; return { addr: entry.address, ok: false, err: (e.message || "").slice(0, 80) }; });
        });

        const results = await Promise.all(txPromises);
        const failures = results.filter(r => !r.ok);
        if (failures.length > 0) {
            for (const f of failures) console.log(`  FAIL ${f.addr}: ${f.err}`);
        }
        console.log(`  ${sent} sent, ${failed} failed\n`);
    }

    console.log(`Done. ${sent}/${transfers.length} transfers completed, ${failed} failed.`);
}

main();
