const API_KEY = process.env.API_KEY;
const PRIVATE_KEY = process.env.PRIVATE_KEY;
const PUBLIC_KEY = process.env.PUBLIC_KEY;
const USDC_TOKEN = process.env.USDC_TOKEN;
const KILL_TOKEN = process.env.KILL_TOKEN;
const KILL_GAME = process.env.KILL_GAME;





//npx hardhat run scripts/store/extract.js --network basesepolia
//npx hardhat run scripts/store/extract.js --network base
async function main() {
    const [deployer] = await ethers.getSigners();
    const weiAmount = (await deployer.getBalance()).toString();
    console.log("account balance:", await ethers.utils.formatEther(weiAmount));

    const gasPrice = await deployer.getGasPrice();
    console.log(`current gas price: ${gasPrice}`);


    const KillToken = await ethers.getContractFactory("KILLToken");
    const killToken = await KillToken.deploy();
    console.log(killToken.address + " deployed to KILLToken");


    const KillGame = await ethers.getContractFactory("KILLGame");
    const killGame = await KillGame.deploy(killToken.address);
    console.log(killGame.address + " deployed to KillGame");



    console.log("done")

}

main()
    .then(() => process.exit(0))
    .catch((error) => {
      console.error(error);
      process.exit(1);
    });