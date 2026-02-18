const { ethers } = require("hardhat");
require("dotenv").config();

async function main() {
    const wallet = new ethers.Wallet(process.env.SEED_PK, ethers.provider);
    const nonce = 25; // Hardcoded based on your output to ensure we hit the wall
    
    console.log(`\n--- NUCLEAR OVERRIDE ---`);
    console.log(`Force-clearing Nonce: ${nonce}`);

    // We are going to send a legacy transaction with a massive gas price
    // This often forces nodes to prioritize the replacement over EIP-1559 pending txs
    const tx = await wallet.sendTransaction({
        to: wallet.address,
        value: 0,
        nonce: nonce,
        gasLimit: 21000,
        gasPrice: ethers.utils.parseUnits("100", "gwei") // Overkill on purpose
    });

    console.log(`Nuke Broadcasted: ${tx.hash}`);
    console.log("Waiting for confirmation...");
    
    const receipt = await tx.wait();
    console.log(`\n[SUCCESS] Block ${receipt.blockNumber} confirmed. Mempool clear.`);
}

main().catch(console.error);