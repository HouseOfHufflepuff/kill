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


//hardhat run scripts/base/mint.js --network base
//hardhat run scripts/base/mint.js --network basesepolia
// Minimal ABI — hardcoded so the script works regardless of compiled artifact.
// The deployed contract still has mint(address,uint256) onlyOwner on-chain.
const MINT_ABI = [
    "function mint(address to, uint256 amount) external"
];

async function main() {
    const [owner] = await ethers.getSigners();
    const killToken = new ethers.Contract(KILL_TOKEN, MINT_ABI, owner);
    //666M game contract
    //await killToken.mint(KILL_GAME, "666000000000000000000000000");
    //await killToken.mint(KILL_FAUCET, "666000000000000000000000000");
    //await killToken.mint(PUBLIC_KEY, "666000000000000000000000000");


    //10M agent0
    //await killToken.mint(PUBLIC_KEY, "10000000000000000000000000");

    // faucet 666M
    //await killToken.mint(KILL_FAUCET, "666000000000000000000000000");

    // // //10M agent1
    //await killToken.mint(AGENT1_PUBLIC_KEY, "10000000000000000000000000");

    // // //10M agent2
    //await killToken.mint(AGENT2_PUBLIC_KEY, "10000000000000000000000000");

    // //10M agent3
    //await killToken.mint(AGENT3_PUBLIC_KEY, "10000000000000000000000000");

    // // //100k agent4
    // await killToken.mint("0x857820c7464B0F0Eb457444FD772A69b3D173536", "10000000000000000000000000");
    // await killToken.mint("0x03fFbd99AA0f2f70Edeb20c991d7B163F186A4C9", "10000000000000000000000000");
    // await killToken.mint("0x3623fbf7bBd3Ac0466e94328fDA5b05602603182", "10000000000000000000000000");
    // await killToken.mint("0x0A1fecA883dA8acECe8Ed14F71979069a51ce6D4", "10000000000000000000000000");
    // await killToken.mint("0x0A1fecA883dA8acECe8Ed14F71979069a51ce6D4", "10000000000000000000000000");

    // await killToken.mint("0x2fb363fBc806EE9E86aB406B8053875A9026BE7D", "10000000000000000000000000");
    // await killToken.mint("0xC6EaBf8EF5faD6586D260741ba7aF2D89350668a", "10000000000000000000000000");
    // await killToken.mint("0x10b41b4a5b28291d8d24ac662fa2bb085c08b5ae", "10000000000000000000000000");
    // await killToken.mint("0xbebd7f31149f798a15b92e6b24f41ab4759edf9c", "10000000000000000000000000");
    // await killToken.mint("0xc6e9d808697284af6a84f5d00f38e0f70ebf3c0a", "10000000000000000000000000");

    // await killToken.mint("0x441a2eeea108a0290a9273ab09ad26ee995b2f81", "10000000000000000000000000");
    // await killToken.mint("0x26dC11359a026bD7F98539B75460E8e4E9BF143d", "10000000000000000000000000");
    // await killToken.mint("0x080042233fBAccD3bE7AB9c7F020A1Da41802f1D", "10000000000000000000000000");
    //await killToken.mint("0xb4b6a10452439B48993E1ec68468e8d91566c82F", "10000000000000000000000000");

    // await killToken.mint(ethers.utils.getAddress("0x9095bB69f9a7D17B3Fd703d8c51606297829DCd6"), "10000000000000000000000000");
    // await killToken.mint(ethers.utils.getAddress("0x0A1fecA883dA8acECe8Ed14F71979069a51ce6D4"), "10000000000000000000000000");
    // await killToken.mint(ethers.utils.getAddress("0x9D45399C666A120462da696ea810a21d6a48A0DD"), "10000000000000000000000000");
    // await killToken.mint(ethers.utils.getAddress("0x2fb363fBc806EE9E86aB406B8053875A9026BE7D"), "10000000000000000000000000");
    // await killToken.mint(ethers.utils.getAddress("0xC25e78cE00E95d0A4Fe185F00afd7511627a3d42"), "10000000000000000000000000");
    //await killToken.mint("0x624ACebb891354AA7890e027b0444418503bAef6", "10000000000000000000000000");
    //await killToken.mint("0x75891725392dd52b0a520267b2045631164bb4f1", "10000000000000000000000000");
    //await killToken.mint("0x4AEff951c726D0b42b611dcC0d59fa04798247f9", "1000000000000000000000000");
    // await killToken.mint("0xAC07322627cd09ffE29015D8ffD4994F015cA8D2", "1000000000000000000000000");
    // await killToken.mint("0x7e77a3277834d063b7ae3ff6302abd996ae62dee", "1000000000000000000000000");
    // await killToken.mint("0x7e77a3277834d063b7ae3ff6302abd996ae62dee", "1000000000000000000000000");

    //await killToken.mint("0xcf8c4b95cd3b11513da32d24bf71326aee34851c", "1000000000000000000000000");
    // await killToken.mint("0x9B4e30c950E652c93354e3d29098c81Ab0265DED", "10000000000000000000000000");

    // await killToken.mint("0x332411fce9a1Dc42e6f389D9f26189dc99E82bCF", "10000000000000000000000000");
    // await killToken.mint("0x1610f8b1eB277Ad8Bc30e4e01EBfd53290C10cE9", "10000000000000000000000000");
    // await killToken.mint("0xC3806CDFEC33f294aA30060a7cd456a125246B1c", "10000000000000000000000000");

    //     await killToken.mint("0x0A6827E4349eB49D91E82A24673Aa7C39F931b07", "10000000000000000000000000");
    // await killToken.mint("0xDb958183Cee0795F2E49fAC68562AA75D1F68562", "10000000000000000000000000");
    // await killToken.mint("0xFec1bF49eA0B39B5a8D13485E5aE1eD6141459D1", "10000000000000000000000000");

    // await killToken.mint("0xe7cfb474dF1E534ed9d7d731d4b129E32775AeE6", "10000000000000000000000000");
    // await killToken.mint("0x6f071746AC088dA921A1ECA222296964EDF0bde0", "10000000000000000000000000");
    // await killToken.mint("0x4A151D4EA59e0E1E18f5Ebb51bBC328452C22e8F", "10000000000000000000000000");
    
    //     await killToken.mint("0x01d2BA275dD079A2764E72AD9527bd1A5F66a013", "10000000000000000000000000");
    // await killToken.mint("0x9B4e30c950E652c93354e3d29098c81Ab0265DED", "10000000000000000000000000");
    // await killToken.mint("0x575d31181992a94562e23930ac66833392ce2498", "10000000000000000000000000");

    //         await killToken.mint("0x01d2BA275dD079A2764E72AD9527bd1A5F66a013", "10000000000000000000000000");
    // await killToken.mint("0x7c3b039704247c8ed795d8f1952a8b3fcca9f35e", "10000000000000000000000000");
    // await killToken.mint("0xd91f0a0ae2fa0ad2a0915905a79af1ba0683233c", "10000000000000000000000000"); // invalid address — 22 bytes
    // await killToken.mint("0xe3b2fa050c72ea2c0a2d1b965c1f1bc551e82ff3", "10000000000000000000000000"); 
    // await killToken.mint("0x68fa594de4420125e928a9be799e53821effac2c", "10000000000000000000000000");
    await killToken.mint("0xc624d86CAb15C9d8da2A6221431B3E34c7e54D76", "10000000000000000000000000"); 
    
    // //10M max
    //await killToken.mint(MAX_PUB, "50000000000000000000000000");

    //aaron
    //await killToken.mint("0x3944793e9EB7C838178c52B66f09B8B24c887AfE", "100000000000000000000000000");
    
    console.log("done funding contracts and agents");

}

main();