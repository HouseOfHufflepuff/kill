const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("KILLGame: Full Suite", function () {
  let killToken, killGame, owner, userA, userB;

  beforeEach(async function () {
    [owner, userA, userB] = await ethers.getSigners();
    
    const KillToken = await ethers.getContractFactory("KILLToken"); 
    killToken = await KillToken.deploy();
    await killToken.deployed(); // v5 syntax

    const KILLGame = await ethers.getContractFactory("KILLGame");
    killGame = await KILLGame.deploy(killToken.address);
    await killGame.deployed(); // v5 syntax

    const amount = ethers.utils.parseEther("100000"); 
    await killToken.mint(userA.address, amount);
    await killToken.mint(userB.address, amount);
    await killToken.connect(userA).approve(killGame.address, amount);
    await killToken.connect(userB).approve(killGame.address, amount);
  });

  describe("Owner Functions & Access Control", function () {
    it("16. should allow owner to change treasuryBps and emit event", async function () {
      await expect(killGame.connect(owner).setTreasuryBps(5000))
        .to.emit(killGame, "TreasuryBpsUpdated")
        .withArgs(2500, 5000);
      
      expect(await killGame.treasuryBps()).to.equal(5000);
    });

    it("17. should revert if a non-owner tries to change treasuryBps", async function () {
      // Custom Error handling works in v5 if using recent @nomicfoundation/hardhat-chai-matchers
      await expect(killGame.connect(userA).setTreasuryBps(5000))
        .to.be.revertedWithCustomError(killGame, "OwnableUnauthorizedAccount")
        .withArgs(userA.address);
    });

    it("18. should correctly scale pending rewards when treasuryBps is updated", async function () {
      await killGame.connect(userA).spawn(1, 10);
      for(let i=0; i<10; i++) await ethers.provider.send("evm_mine");

      const pendingOld = await killGame.getPendingBounty(userA.address, 1);
      
      await killGame.connect(owner).setTreasuryBps(5000); 
      const pendingNew = await killGame.getPendingBounty(userA.address, 1);
      
      expect(pendingNew).to.be.gt(pendingOld.mul(2));
    });

    it("19. should allow owner to withdraw tokens from treasury", async function () {
      await killGame.connect(userA).spawn(1, 100);
      const amount = ethers.utils.parseEther("500");
      
      const ownerBalanceBefore = await killToken.balanceOf(owner.address);
      await killGame.connect(owner).adminWithdraw(amount);
      const ownerBalanceAfter = await killToken.balanceOf(owner.address);
      
      expect(ownerBalanceAfter.sub(ownerBalanceBefore)).to.equal(amount);
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
      await killGame.connect(userB).spawn(cube, 10);
      
      const defenderBalBefore = await killToken.balanceOf(userA.address);
      await killGame.connect(userB).kill(userA.address, cube, 10, 0);
      const defenderBalAfter = await killToken.balanceOf(userA.address);
      
      const expectedReward = ethers.utils.parseEther("75"); 
      expect(defenderBalAfter.sub(defenderBalBefore)).to.equal(expectedReward);
    });

    it("2. should reward the attacker for partial damage dealt", async function () {
      await killGame.connect(userA).spawn(cube, 10);
      for(let i=0; i<10; i++) await ethers.provider.send("evm_mine");
      
      const pendingBefore = await killGame.getPendingBounty(userA.address, cube);
      await killGame.connect(userB).spawn(cube, 100);

      const userBBalBefore = await killToken.balanceOf(userB.address);
      await killGame.connect(userB).kill(userA.address, cube, 100, 0);
      const userBBalAfter = await killToken.balanceOf(userB.address);

      const expectedPayout = pendingBefore.mul(7500).div(10000);
      expect(userBBalAfter.sub(userBBalBefore)).to.be.closeTo(expectedPayout, ethers.utils.parseEther("0.1"));
    });

    it("3. should emit DefenderRewarded event with correct amount", async function () {
      await killGame.connect(userA).spawn(cube, 50);
      await killGame.connect(userB).spawn(cube, 10);
      await expect(killGame.connect(userB).kill(userA.address, cube, 10, 0))
        .to.emit(killGame, "DefenderRewarded")
        .withArgs(userA.address, ethers.utils.parseEther("75"));
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

  describe("Spawn Mechanics", function () {
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

    it("9. should award a Reaper when incremental spawns cross the 666 mark", async function () {
      await killGame.connect(userA).spawn(1, 665);
      await killGame.connect(userA).spawn(1, 1);
      expect(await killGame.balanceOf(userA.address, 217)).to.equal(1);
    });
  });

  describe("Move Mechanics", function () {
    beforeEach(async function () {
      await killGame.connect(userA).spawn(1, 10);
    });

    it("10. should reset the birth block on the origin stack when moving out completely", async function () {
      await killGame.connect(userA).move(1, 2, 10, 0);
      expect(await killGame.getBirthBlock(userA.address, 1)).to.equal(0);
    });

    it("11. should NOT reset birth block if moving into a stack already occupied", async function () {
      await killGame.connect(userA).move(1, 2, 5, 0);
      const firstBirth = await killGame.getBirthBlock(userA.address, 2);
      await ethers.provider.send("evm_mine");
      await killGame.connect(userA).move(1, 2, 5, 0);
      expect(await killGame.getBirthBlock(userA.address, 2)).to.equal(firstBirth);
    });

    it("12. should move units and set birth block at destination", async function () {
      await killGame.connect(userA).move(1, 2, 4, 0);
      expect(await killGame.balanceOf(userA.address, 1)).to.equal(6);
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
  });

  describe("Global Statistics", function () {
    it("15. should track total units killed globally", async function () {
      await killGame.connect(userA).spawn(1, 10);
      await killGame.connect(userB).spawn(1, 20);
      await killGame.connect(userB).kill(userA.address, 1, 20, 0);
      expect(await killGame.totalUnitsKilled()).to.equal(10);
    });
  });
});