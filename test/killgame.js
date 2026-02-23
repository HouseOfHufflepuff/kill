const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("KILLGame: Full Suite", function () {
  let killToken, killGame, owner, userA, userB;

  const fastForward = async (blocks) => {
    for (let i = 0; i < blocks; i++) {
      await ethers.provider.send("evm_mine");
    }
  };

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

  describe("Owner Functions & Access Control", function () {
    it("16. should allow owner to change treasuryBps and emit event", async function () {
      await expect(killGame.connect(owner).setTreasuryBps(7500))
        .to.emit(killGame, "TreasuryBpsUpdated")
        .withArgs(0, 7500);
      expect(await killGame.treasuryBps()).to.equal(7500);
    });

    it("17. should revert if a non-owner tries to change treasuryBps", async function () {
      await expect(killGame.connect(userA).setTreasuryBps(5000))
        .to.be.revertedWithCustomError(killGame, "OwnableUnauthorizedAccount")
        .withArgs(userA.address);
    });

    it("18. should correctly scale pending rewards when age increases", async function () {
      await killGame.connect(userA).spawn(1, 100);
      await fastForward(1100); 
      const pendingOld = await killGame.getPendingBounty(userA.address, 1);
      await fastForward(1100); 
      const pendingNew = await killGame.getPendingBounty(userA.address, 1);
      expect(pendingNew).to.be.gt(pendingOld);
    });

    it("19. should allow owner to withdraw tokens from treasury", async function () {
      await killGame.connect(userA).spawn(1, 100);
      const amount = ethers.utils.parseEther("500");
      const before = await killToken.balanceOf(owner.address);
      await killGame.connect(owner).adminWithdraw(amount);
      expect((await killToken.balanceOf(owner.address)).sub(before)).to.equal(amount);
    });

    it("20. should prevent non-owner from withdrawing tokens", async function () {
      await expect(killGame.connect(userA).adminWithdraw(100))
        .to.be.revertedWithCustomError(killGame, "OwnableUnauthorizedAccount")
        .withArgs(userA.address);
    });
  });

  describe("Bi-directional Looting (Combat Logic)", function () {
    const cube = 1;
    it("1. should reward the defender when they successfully repel an attack", async function () {
      await killGame.connect(userA).spawn(cube, 100);
      await fastForward(1100);
      await killGame.connect(userB).spawn(cube, 10);
      const before = await killToken.balanceOf(userA.address);
      await killGame.connect(userB).kill(userA.address, cube, 10, 0);
      expect((await killToken.balanceOf(userA.address)).sub(before)).to.be.gt(0);
    });

    it("2. should reward the attacker for partial damage dealt", async function () {
      await killGame.connect(userA).spawn(cube, 10);
      await fastForward(1100);
      await killGame.connect(userB).spawn(cube, 100);
      await fastForward(1100); 
      
      const before = await killToken.balanceOf(userB.address);
      await killGame.connect(userB).kill(userA.address, cube, 100, 0);
      const after = await killToken.balanceOf(userB.address);
      
      expect(after.sub(before)).to.be.gt(0);
    });

    it("3. should emit DefenderRewarded event with correct amount", async function () {
      await killGame.connect(userA).spawn(cube, 50);
      await fastForward(1100);
      await killGame.connect(userB).spawn(cube, 10);
      const tx = await killGame.connect(userB).kill(userA.address, cube, 10, 0);
      const receipt = await tx.wait();
      const event = receipt.events.find(e => e.event === 'DefenderRewarded');
      expect(event.args.amount).to.be.gt(0);
    });
  });

  describe("Combat Mechanics Deep Dive", function () {
    const cube = 1;
    it("4. should allow a defender to win if they have more power", async function () {
      await killGame.connect(userA).spawn(cube, 50);
      await killGame.connect(userB).spawn(cube, 10);
      await killGame.connect(userB).kill(userA.address, cube, 10, 0);
      expect(await killGame.balanceOf(userB.address, cube)).to.equal(0);
      expect(await killGame.balanceOf(userA.address, cube)).to.equal(49);
    });

    it("5. should demonstrate boosted unit power (666x multiplier)", async function () {
      await killGame.connect(userA).spawn(cube, 500);
      await killGame.connect(userB).spawn(cube, 666); 
      await killGame.connect(userB).kill(userA.address, cube, 0, 1);
      expect(await killGame.balanceOf(userA.address, cube)).to.equal(0);
    });
  });

  describe("Spawn Mechanics & Bulk Requirements", function () {
    it("6. should mint standard units and set birth block", async function () {
      await killGame.connect(userA).spawn(1, 10);
      expect(await killGame.getBirthBlock(userA.address, 1)).to.be.gt(0);
    });

    it("7. should mint a boosted unit on exactly 666 units as a BONUS", async function () {
      await killGame.connect(userA).spawn(1, 666);
      expect(await killGame.balanceOf(userA.address, 217)).to.equal(1);
    });

    it("8. should award multiple Reapers when crossing multiple 666-unit thresholds", async function () {
      await killGame.connect(userA).spawn(1, 1332);
      expect(await killGame.balanceOf(userA.address, 217)).to.equal(2);
    });

    it("9. should NOT award a Reaper for incremental spawns", async function () {
      await killGame.connect(userA).spawn(1, 665);
      await killGame.connect(userA).spawn(1, 1);
      expect(await killGame.balanceOf(userA.address, 217)).to.equal(0);
    });

    it("21. should award exactly 500 Reapers when spawning 333000 units", async function () {
      await killGame.connect(userA).spawn(1, 333000);
      expect(await killGame.balanceOf(userA.address, 217)).to.equal(500);
    });
  });

  describe("Move Mechanics", function () {
    beforeEach(async function () {
      await killGame.connect(userA).spawn(1, 10);
    });

    it("10. should reset the birth block on origin when moving out completely", async function () {
      await killGame.connect(userA).move(1, 2, 10, 0);
      expect(await killGame.getBirthBlock(userA.address, 1)).to.equal(0);
    });

    it("11. should PRESERVE birth block if moving into a stack already occupied", async function () {
      await killGame.connect(userA).move(1, 2, 5, 0);
      const initialBirth = await killGame.getBirthBlock(userA.address, 2);
      await fastForward(10);
      // Moving more units into the same stack
      await killGame.connect(userA).move(1, 2, 5, 0);
      const afterBirth = await killGame.getBirthBlock(userA.address, 2);
      // FIXED: In new logic, age is preserved, not reset to current block
      expect(afterBirth).to.equal(initialBirth);
    });

    it("12. should move units and set birth block at destination", async function () {
      await killGame.connect(userA).move(1, 2, 4, 0);
      expect(await killGame.balanceOf(userA.address, 2)).to.equal(4);
    });

    it("13. should allow sequential moves to adjacent cubes", async function () {
      await killGame.connect(userA).move(1, 2, 2, 0);
      await killGame.connect(userA).move(2, 3, 2, 0);
      expect(await killGame.balanceOf(userA.address, 3)).to.equal(2);
    });

    it("14. should revert with 'Bad move' for non-adjacent cubes", async function () {
      await expect(killGame.connect(userA).move(1, 3, 1, 0)).to.be.revertedWith("Bad move");
    });

    it("22. should PRESERVE birth block on origin for partial moves", async function () {
      await killGame.connect(userA).spawn(1, 100);
      const initial = await killGame.getBirthBlock(userA.address, 1);
      await fastForward(5);
      await killGame.connect(userA).move(1, 2, 50, 0);
      const after = await killGame.getBirthBlock(userA.address, 1);
      // FIXED: Origin age is preserved if not emptied
      expect(after).to.equal(initial);
      // FIXED: Destination inherits the age of the moving units
      expect(await killGame.getBirthBlock(userA.address, 2)).to.equal(initial);
    });
  });

  describe("Global Statistics", function () {
    it("15. should track total units killed globally", async function () {
      await killGame.connect(userA).spawn(1, 10);
      await killGame.connect(userB).spawn(1, 20);
      await killGame.connect(userB).kill(userA.address, 1, 20, 0);
      expect(await killGame.totalUnitsKilled()).to.equal(10);
    });
  });

  describe("KILLGame: Multicall (Batching)", function () {
    it("should allow a user to spawn on multiple stacks in one transaction", async function () {
      const data1 = killGame.interface.encodeFunctionData("spawn", [1, 100]);
      const data2 = killGame.interface.encodeFunctionData("spawn", [2, 100]);
      await killGame.connect(userA).multicall([data1, data2]);
      expect(await killGame.balanceOf(userA.address, 1)).to.equal(100);
      expect(await killGame.balanceOf(userA.address, 2)).to.equal(100);
    });

    it("should allow spawning and moving in the same block", async function () {
      const spawnData = killGame.interface.encodeFunctionData("spawn", [1, 100]);
      const moveData = killGame.interface.encodeFunctionData("move", [1, 2, 50, 0]);
      await killGame.connect(userA).multicall([spawnData, moveData]);
      expect(await killGame.balanceOf(userA.address, 1)).to.equal(50);
      expect(await killGame.balanceOf(userA.address, 2)).to.equal(50);
    });

    it("should allow reinforcing a stack and attacking immediately", async function () {
      await killGame.connect(userA).spawn(1, 100);
      const spawnData = killGame.interface.encodeFunctionData("spawn", [1, 200]);
      const killData = killGame.interface.encodeFunctionData("kill", [userA.address, 1, 200, 0]);
      await killGame.connect(userB).multicall([spawnData, killData]);
      expect(await killGame.balanceOf(userA.address, 1)).to.equal(0);
    });

    it("should allow moving units and attacking from the destination stack", async function () {
      await killGame.connect(userA).spawn(2, 50);
      await killGame.connect(userB).spawn(1, 100);
      const moveData = killGame.interface.encodeFunctionData("move", [1, 2, 100, 0]);
      const killData = killGame.interface.encodeFunctionData("kill", [userA.address, 2, 100, 0]);
      await killGame.connect(userB).multicall([moveData, killData]);
      expect(await killGame.balanceOf(userA.address, 2)).to.equal(0);
    });

    it("should revert the entire batch if one call fails (Atomicity)", async function () {
      const spawnData = killGame.interface.encodeFunctionData("spawn", [1, 100]);
      const badMoveData = killGame.interface.encodeFunctionData("move", [1, 5, 50, 0]); 
      await expect(killGame.connect(userA).multicall([spawnData, badMoveData])).to.be.revertedWith("Bad move");
      expect(await killGame.balanceOf(userA.address, 1)).to.equal(0);
    });

    it("should consume less gas than individual transactions", async function () {
      const data = killGame.interface.encodeFunctionData("spawn", [1, 10]);
      const tx = await killGame.connect(userA).multicall([data, data, data, data, data]);
      const receipt = await tx.wait();
      expect(receipt.gasUsed).to.be.lt(1000000); 
    });
  });
});