require("@nomicfoundation/hardhat-toolbox");
require("@openzeppelin/hardhat-upgrades");
require("dotenv").config();

const { 
  API_URL, 
  PRIVATE_KEY, 
  AGENT1_PRIVATE_KEY,
  AGENT2_PRIVATE_KEY,
  AGENT3_PRIVATE_KEY,
  AGENT4_PRIVATE_KEY,
  AGENT5_PRIVATE_KEY
} = process.env;

// Collect all accounts for the simulation signers array
const accounts = [
  PRIVATE_KEY, // Index 0: Owner/Deployer
  AGENT1_PRIVATE_KEY,
  AGENT2_PRIVATE_KEY,
  AGENT3_PRIVATE_KEY,
  AGENT4_PRIVATE_KEY,
  AGENT5_PRIVATE_KEY
].filter(key => !!key); // Remove undefined values

/** @type import('hardhat/config').HardhatUserConfig */
module.exports = {
  solidity: {
    version: "0.8.24",
    settings: {
      optimizer: {
        enabled: true,
        runs: 200,
      },
    },
  },
  defaultNetwork: "localhost",
  networks: {
    hardhat: {
      chainId: 1337
    },
    base: {
      url: API_URL || "https://mainnet.base.org",
      accounts: accounts,
    },
    basesepolia: {
      url: API_URL || "https://sepolia.base.org",
      accounts: accounts,
      gasPrice: 2000000000, // 2 Gwei base
      pollingInterval: 1000,
      timeout: 360000
    }
  },
  etherscan: {
    apiKey: {
      base: process.env.BASESCAN_API_KEY || "",
      baseSepolia: process.env.BASESCAN_API_KEY || ""
    }
  }
};