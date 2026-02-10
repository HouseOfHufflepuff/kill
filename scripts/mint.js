const API_KEY = process.env.API_KEY;
const PRIVATE_KEY = process.env.PRIVATE_KEY;
const PUBLIC_KEY = process.env.PUBLIC_KEY;
const KILL_TOKEN = process.env.KILL_TOKEN;
const KILL_GAME = process.env.KILL_GAME;

//hardhat run scripts/mint.js --network base
//hardhat run scripts/mint.js --network basesepolia
async function main() {
    const KillToken = await ethers.getContractFactory("KILLToken");
    const killToken = await KillToken.attach(KILL_TOKEN);

    const [owner] = await ethers.getSigners();
    //1M game contract
    await killToken.mint("0xd1a9C5653Eac53c6895a3880D18547421E770337", "1000000000000000000000000");

    //1M owner
    await killToken.mint(PUBLIC_KEY, "1000000000000000000000000");
    console.log("done");


}

main();