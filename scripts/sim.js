const { ethers } = require("hardhat");

const KILL_TOKEN = process.env.KILL_TOKEN;
const KILL_GAME = process.env.KILL_GAME;
const AGENT1_PUBLIC_KEY = process.env.AGENT1_PUBLIC_KEY; // whale, mint 1000 kill per turn
const AGENT2_PUBLIC_KEY = process.env.AGENT2_PUBLIC_KEY; // shrimp, mint 100 kill per turn
const AGENT3_PUBLIC_KEY = process.env.AGENT3_PUBLIC_KEY; // shrimp, mint 100 kill per turn
const AGENT4_PUBLIC_KEY = process.env.AGENT4_PUBLIC_KEY;
const AGENT5_PUBLIC_KEY = process.env.AGENT5_PUBLIC_KEY;


//hardhat run scripts/spawn.js --network base
//hardhat run scripts/spawn.js --network basesepolia
async function main() {
    
    const KillToken = await ethers.getContractFactory("KILLToken");
    const killToken = await KillToken.attach(KILL_TOKEN);

    const KillGame = await ethers.getContractFactory("KILLGame");
    const killGame = await KillGame.attach(KILL_GAME);
    // create infinite loop resting for 10 seconds at the end of each iteration

    // TODO loop through all 5 wallets and perform actions based on their architype and current state.
    // MINT their value from above. And perform actions only if they can spawn enough units to be profitable
    const [owner] = await ethers.getSigners(); // TODO add all 5 wallets
    console.log("Using Wallet:", owner.address);

    // TODO call getRipeStacks and if there are overwhelming troops, issue kill. if not, spawn enough to kill next block
    const unitsToSpawn = 666; // TODO adjust this dynamically based on call to getRipeStacks that do not have units.
    // TODO spawn the optimal amount of units to 

    // if haveUnits
        // kill
    // else
        // spawn


}

main()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error(error);
        process.exit(1);
    });