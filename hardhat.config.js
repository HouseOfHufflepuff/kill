require("@nomicfoundation/hardhat-toolbox");
require("@openzeppelin/hardhat-upgrades");
require("hardhat-contract-sizer");
require("dotenv").config();
require("hardhat-gas-reporter");

const { 
  API_URL, 
  PRIVATE_KEY, 
  AGENT1_PRIVATE_KEY,
  AGENT2_PRIVATE_KEY,
  AGENT3_PRIVATE_KEY,
  AGENT4_PRIVATE_KEY,
  AGENT5_PRIVATE_KEY
} = process.env;

const accounts = [
  PRIVATE_KEY, 
  AGENT1_PRIVATE_KEY,
  AGENT2_PRIVATE_KEY,
  AGENT3_PRIVATE_KEY,
  AGENT4_PRIVATE_KEY,
  AGENT5_PRIVATE_KEY
].filter(key => !!key);

module.exports = {
  solidity: {
    version: "0.8.24",
    settings: {
      optimizer: {
        enabled: true, // MUST BE HERE
        runs: 1000, 
      },
      viaIR: true, // MUST BE HERE
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
      gasPrice: 2000000000, 
      pollingInterval: 1000,
      timeout: 360000
    }
  },
  etherscan: {
    apiKey: {
      base: process.env.BASESCAN_API_KEY || "",
      baseSepolia: process.env.BASESCAN_API_KEY || ""
    }
  },
  // MERGED GAS REPORTER CONFIGURATION
  gasReporter: {
    enabled: true,
    currency: "USD",
    token: "ETH",
    outputFile: "gas-report0.txt",
    noColors: true,
  },
};