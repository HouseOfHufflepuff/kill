const { ethers } = require("hardhat");

async function main() {
    const [deployer] = await ethers.getSigners();
    const nonce = 3371; // The specific stuck nonce
    
    const feeData = await ethers.provider.getFeeData();
    
    // Set a high priority fee (the tip)
    const priorityFee = ethers.utils.parseUnits("5", "gwei");
    // Ensure maxFee is significantly higher than priorityFee + current base fee
    const maxFee = feeData.maxFeePerGas.add(priorityFee).mul(2);

    console.log(`Attempting to clear nonce ${nonce} with Priority: 5 gwei, Max: ${ethers.utils.formatUnits(maxFee, "gwei")} gwei`);

    const tx = await deployer.sendTransaction({
        to: deployer.address,
        value: 0,
        nonce: nonce,
        maxPriorityFeePerGas: priorityFee,
        maxFeePerGas: maxFee,
        gasLimit: 21000 // Minimum gas for a transfer
    });

    console.log("Nuke sent. Hash:", tx.hash);
    await tx.wait();
    console.log("SUCCESS: Nonce 3371 cleared.");
}

main().catch((error) => { console.error(error); process.exit(1); });