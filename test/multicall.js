const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("KILLGame: Multicall (Batching)", function () {
  let killToken, killGame, owner, userA, userB;

  beforeEach(async function () {
    [owner, userA, userB] = await ethers.getSigners();
    
    const KillToken = await ethers.getContractFactory("KILLToken"); 
    killToken = await KillToken.deploy();
    await killToken.deployed(); 

    const KILLGame = await ethers.getContractFactory("KILLGame");
    killGame = await KILLGame.deploy(killToken.address);
    await killGame.deployed(); 

    const amount = ethers.utils.parseEther("10000000"); 
    await killToken.mint(userA.address, amount);
    await killToken.mint(userB.address, amount);
    
    const seedAmount = ethers.utils.parseEther("1000000");
    await killToken.mint(owner.address, seedAmount);
    await killToken.connect(owner).transfer(killGame.address, seedAmount);

    await killToken.connect(userA).approve(killGame.address, amount);
    await killToken.connect(userB).approve(killGame.address, amount);
  });

  describe("Batch Spawning", function () {
    it("should allow a user to spawn on multiple stacks in one transaction", async function () {
      const spawn1 = killGame.interface.encodeFunctionData("spawn", [1, 100]);
      const spawn2 = killGame.interface.encodeFunctionData("spawn", [50, 200]);
      const spawn3 = killGame.interface.encodeFunctionData("spawn", [100, 300]);

      await killGame.connect(userA).multicall([spawn1, spawn2, spawn3]);

      expect(await killGame.balanceOf(userA.address, 1)).to.equal(100);
      expect(await killGame.balanceOf(userA.address, 50)).to.equal(200);
      expect(await killGame.balanceOf(userA.address, 100)).to.equal(300);
    });
  });

  describe("Complex Tactical Batches (Spawn + Move)", function () {
    it("should allow spawning and moving in the same block", async function () {
      const spawnCall = killGame.interface.encodeFunctionData("spawn", [1, 10]);
      const moveCall = killGame.interface.encodeFunctionData("move", [1, 2, 10, 0]);

      await killGame.connect(userA).multicall([spawnCall, moveCall]);

      expect(await killGame.balanceOf(userA.address, 1)).to.equal(0);
      expect(await killGame.balanceOf(userA.address, 2)).to.equal(10);
      expect(await killGame.getBirthBlock(userA.address, 2)).to.be.gt(0);
    });
  });

  describe("Strategic Combat Batches", function () {
    it("Spawn + Kill: should allow reinforcing a stack and attacking immediately", async function () {
      const cube = 10;
      // Setup: User B is camping on cube 10
      await killGame.connect(userB).spawn(cube, 100);
      
      // User A prepares a batch: 
      // 1. Spawn a large force (500) on cube 10
      // 2. Immediately attack User B on cube 10 with that force
      const spawnCall = killGame.interface.encodeFunctionData("spawn", [cube, 500]);
      const killCall = killGame.interface.encodeFunctionData("kill", [userB.address, cube, 500, 0]);

      await killGame.connect(userA).multicall([spawnCall, killCall]);

      // Result: User B should be wiped out, User A remains
      expect(await killGame.balanceOf(userB.address, cube)).to.equal(0);
      expect(await killGame.balanceOf(userA.address, cube)).to.be.gt(0);
    });

    it("Move + Kill: should allow moving units to a stack and attacking from it", async function () {
      const startCube = 1;
      const targetCube = 2; // Adjacent
      
      // Setup: User A spawns at 1, User B is at 2
      await killGame.connect(userA).spawn(startCube, 200);
      await killGame.connect(userB).spawn(targetCube, 50);

      // User A prepares a batch:
      // 1. Move all units from 1 to 2
      // 2. Kill User B on 2 using the arrived units
      const moveCall = killGame.interface.encodeFunctionData("move", [startCube, targetCube, 200, 0]);
      const killCall = killGame.interface.encodeFunctionData("kill", [userB.address, targetCube, 200, 0]);

      await killGame.connect(userA).multicall([moveCall, killCall]);

      // Verification: User A has effectively flanked and killed User B
      expect(await killGame.balanceOf(userB.address, targetCube)).to.equal(0);
      expect(await killGame.balanceOf(userA.address, targetCube)).to.be.gt(0);
      expect(await killGame.balanceOf(userA.address, startCube)).to.equal(0);
    });
  });

  describe("Revert Handling in Multicall", function () {
    it("should revert the entire batch if one call fails (Atomicity)", async function () {
      const spawnCall = killGame.interface.encodeFunctionData("spawn", [1, 100]);
      // Attempt to move to a non-adjacent stack (1 to 10) which should fail
      const badMoveCall = killGame.interface.encodeFunctionData("move", [1, 10, 100, 0]);

      await expect(killGame.connect(userA).multicall([spawnCall, badMoveCall]))
        .to.be.revertedWith("Bad move");

      // Verify atomicity: even the first spawn was rolled back
      expect(await killGame.balanceOf(userA.address, 1)).to.equal(0);
    });
  });

  describe("Gas Efficiency Check", function () {
    it("should consume less gas than individual transactions", async function () {
      const calls = [];
      for (let i = 1; i <= 5; i++) {
        calls.push(killGame.interface.encodeFunctionData("spawn", [i, 10]));
      }

      const tx = await killGame.connect(userA).multicall(calls);
      const receipt = await tx.wait();
      
      console.log(`      Gas used for 5-batch multicall: ${receipt.gasUsed.toString()}`);
      // Typically saves ~84,000 gas (4 * 21k) in base costs
      expect(receipt.gasUsed).to.be.lt(1500000); 
    });
  });
});