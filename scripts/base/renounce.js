// env=$(cat .env.basemainnet) npx hardhat run scripts/base/renounce.js --network base
async function main() {
    const [deployer] = await ethers.getSigners();
    console.log("Renouncing ownership with account:", deployer.address);

    const token = await ethers.getContractAt("KILLToken", "0x52f117Ac869dC72edaF9B03eF3aa888A0339B8fD", deployer);

    const currentOwner = await token.owner();
    console.log("Current owner:", currentOwner);

    const tx = await token.renounceOwnership();
    console.log("Tx hash:", tx.hash);
    await tx.wait();

    const newOwner = await token.owner();
    console.log("New owner:", newOwner);
    console.log("Done. View tx at: https://basescan.org/tx/" + tx.hash);
}

main()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error(error);
        process.exit(1);
    });
