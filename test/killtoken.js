const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("KILLToken", function () {
  it("reverts when mint is called after full supply minted at deploy", async function () {
    const [owner, other] = await ethers.getSigners();

    const KillToken = await ethers.getContractFactory("KILLToken");
    const killToken = await KillToken.deploy();
    await killToken.deployed();

    const cap = await killToken.cap();
    expect(await killToken.totalSupply()).to.equal(cap);
    expect(await killToken.balanceOf(owner.address)).to.equal(cap);

    // No public mint function — low-level call to mint selector must revert
    const mintData = ethers.utils.id("mint(address,uint256)").slice(0, 10);
    const encoded = ethers.utils.defaultAbiCoder.encode(
      ["address", "uint256"],
      [other.address, 1]
    );
    await expect(
      owner.sendTransaction({ to: killToken.address, data: mintData + encoded.slice(2) })
    ).to.be.reverted;
  });
});
