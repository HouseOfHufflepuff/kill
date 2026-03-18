// node scripts/base/merkle.js
//
// Builds a Merkle tree from pt1.txt and outputs the root.
// Saves tree data to pt1-tree.json for proof lookups.
// Use setMerkleRoot() in KILLGame with the printed root.

const fs          = require("fs");
const path        = require("path");
const { ethers }  = require("ethers");
const { MerkleTree } = require("merkletreejs");
const keccak256   = require("keccak256");

const PT1_FILE    = path.join(__dirname, "pt1.txt");
const OUTPUT_FILE = path.join(__dirname, "pt1-tree.json");

// Parse addresses from pt1.txt (one per line, with quotes/commas)
const raw = fs.readFileSync(PT1_FILE, "utf8");
const addresses = raw.match(/0x[0-9a-fA-F]{40}/gi);

if (!addresses || addresses.length === 0) {
    console.error("No addresses found in pt1.txt");
    process.exit(1);
}

const normalized = addresses.map(a => ethers.utils.getAddress(a));
console.log(`Loaded ${normalized.length} addresses`);

// Leaf: keccak256(abi.encodePacked(address)) — matches contract's claim()
const leaves = normalized.map(addr =>
    Buffer.from(
        ethers.utils.solidityKeccak256(["address"], [addr]).slice(2),
        "hex"
    )
);

const tree = new MerkleTree(leaves, keccak256, { sortPairs: true });
const root = tree.getHexRoot();

console.log("\nMerkle Root:", root);

// Build proof map: address -> proof[]
const proofMap = {};
normalized.forEach((addr, i) => {
    proofMap[addr.toLowerCase()] = tree.getHexProof(leaves[i]);
});

const output = {
    root,
    count: normalized.length,
    proofs: proofMap,
};

fs.writeFileSync(OUTPUT_FILE, JSON.stringify(output, null, 2));
console.log(`\nTree saved to ${OUTPUT_FILE}`);
console.log('\nSet in contract:');
console.log(`  killGame.setMerkleRoot("${root}")`);
