// hardhat run scripts/base/fund-faucet.js --network base
// hardhat run scripts/base/fund-faucet.js --network basesepolia
//
// Transfers 666M KILL from deployer to faucet contract.

const TRANSFER_ABI = [
    "function transfer(address to, uint256 amount) external returns (bool)"
];

async function main() {
    const [deployer] = await ethers.getSigners();
    const killToken = new ethers.Contract(process.env.KILL_TOKEN, TRANSFER_ABI, deployer);

    const amount = ethers.utils.parseEther("6660000000"); // 6.66B KILL
    console.log(`Transferring 666M KILL to faucet ${process.env.KILL_FAUCET}...`);

    const tx = await killToken.transfer(process.env.KILL_FAUCET, amount);
    await tx.wait();

    console.log(`Done. tx: ${tx.hash}`);
}

main();
