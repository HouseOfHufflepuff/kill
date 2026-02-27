const API_KEY = process.env.API_KEY;
const PRIVATE_KEY = process.env.PRIVATE_KEY;
const PUBLIC_KEY = process.env.PUBLIC_KEY;
const KILL_TOKEN = process.env.KILL_TOKEN;
const KILL_GAME = process.env.KILL_GAME;
const KILL_FAUCET = process.env.KILL_FAUCET;

const AGENT1_PUBLIC_KEY=process.env.AGENT1_PUBLIC_KEY;
const AGENT2_PUBLIC_KEY=process.env.AGENT2_PUBLIC_KEY;
const AGENT3_PUBLIC_KEY=process.env.AGENT3_PUBLIC_KEY;
const AGENT4_PUBLIC_KEY=process.env.AGENT4_PUBLIC_KEY;
const AGENT5_PUBLIC_KEY=process.env.AGENT5_PUBLIC_KEY;
const MAX_PUB=process.env.MAX_PUB;

//hardhat run scripts/mint.js --network base
//hardhat run scripts/mint.js --network basesepolia
async function main() {
    const KillToken = await ethers.getContractFactory("KILLToken");
    const killToken = await KillToken.attach(KILL_TOKEN);

    const [owner] = await ethers.getSigners();
    //666M game contract
    //await killToken.mint(KILL_GAME, "666000000000000000000000000");

    //10M agent0
    //await killToken.mint(PUBLIC_KEY, "10000000000000000000000000");

    // faucet 666,000,000
    //await killToken.mint(KILL_FAUCET, "666000000000000000000000000");

    // // //100M agent1
    //await killToken.mint(AGENT1_PUBLIC_KEY, "10000000000000000000000000");

    // // //10M agent2
    //await killToken.mint(AGENT2_PUBLIC_KEY, "10000000000000000000000000");

    // //10M agent3
    //await killToken.mint(AGENT3_PUBLIC_KEY, "10000000000000000000000000");

    // // //100k agent4
    await killToken.mint("0xC3806CDFEC33f294aA30060a7cd456a125246B1c", "10000000000000000000000000");

    // //10M max
    //await killToken.mint(MAX_PUB, "10000000000000000000000000");
    
    
    console.log("done funding contracts and agents");

}

main();