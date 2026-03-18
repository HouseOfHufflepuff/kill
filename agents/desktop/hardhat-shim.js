"use strict";
// hardhat-shim.js — Provides `{ ethers }` so Base agent capabilities that
// do `const { ethers } = require("hardhat")` work inside the Electron app
// without pulling in the full Hardhat runtime.
module.exports = { ethers: require("ethers") };
