const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("KILLFaucet", function () {
  let killToken, faucet, owner, fresh, fresh2;

  beforeEach(async function () {
    [owner, fresh, fresh2] = await ethers.getSigners();

    const KillToken = await ethers.getContractFactory("KILLToken");
    killToken = await KillToken.deploy();
    await killToken.deployed();

    const Faucet = await ethers.getContractFactory("KILLFaucet");
    faucet = await Faucet.deploy(killToken.address);
    await faucet.deployed();

    // Fund faucet with 1000 KILL
    await killToken.transfer(faucet.address, ethers.utils.parseEther("1000"));
  });

  it("fresh wallet with 0 KILL can claim faucet", async function () {
    // Verify wallet starts with 0 KILL
    expect(await killToken.balanceOf(fresh.address)).to.equal(0);

    // Claim faucet
    await faucet.connect(fresh).pullKill();

    // Should have received 10% of faucet balance (100 KILL)
    const bal = await killToken.balanceOf(fresh.address);
    expect(bal).to.equal(ethers.utils.parseEther("100"));
  });

  it("cannot claim twice", async function () {
    await faucet.connect(fresh).pullKill();
    await expect(faucet.connect(fresh).pullKill()).to.be.revertedWith("Already pulled");
  });

  it("multiple wallets can each claim", async function () {
    await faucet.connect(fresh).pullKill();
    await faucet.connect(fresh2).pullKill();

    // fresh gets 10% of 1000 = 100
    expect(await killToken.balanceOf(fresh.address)).to.equal(ethers.utils.parseEther("100"));
    // fresh2 gets 10% of remaining 900 = 90
    expect(await killToken.balanceOf(fresh2.address)).to.equal(ethers.utils.parseEther("90"));
  });

  it("reverts when faucet is empty", async function () {
    // Deploy a new faucet with no funds
    const Faucet = await ethers.getContractFactory("KILLFaucet");
    const emptyFaucet = await Faucet.deploy(killToken.address);
    await emptyFaucet.deployed();

    await expect(emptyFaucet.connect(fresh).pullKill()).to.be.revertedWith("Faucet empty");
  });

  it("emits TokensPulled event", async function () {
    await expect(faucet.connect(fresh).pullKill())
      .to.emit(faucet, "TokensPulled")
      .withArgs(fresh.address, ethers.utils.parseEther("100"));
  });
});
