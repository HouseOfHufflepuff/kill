require("@nomicfoundation/hardhat-toolbox");
require("@openzeppelin/hardhat-upgrades");
require("dotenv").config();

const { API_URL, PRIVATE_KEY } = process.env;

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
      url: API_URL || "",
      accounts: PRIVATE_KEY ? [PRIVATE_KEY] : [],
    },
    basesepolia: {
      url: API_URL || "",
      accounts: PRIVATE_KEY ? [PRIVATE_KEY] : [],
    }
  },
  etherscan: {
    apiKey: {
      base: "YOUR_BASESCAN_API_KEY",
      baseSepolia: "YOUR_BASESCAN_API_KEY"
    }
  }
};