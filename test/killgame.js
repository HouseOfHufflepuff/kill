const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("KILLGame: Full Suite", function () {
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

  describe("Owner Functions & Access Control", function () {
    it("16. should allow owner to change treasuryBps and emit event", async function () {
      await expect(killGame.connect(owner).setTreasuryBps(5000))
        .to.emit(killGame, "TreasuryBpsUpdated")
        .withArgs(2500, 5000);
      expect(await killGame.treasuryBps()).to.equal(5000);
    });

    it("17. should revert if a non-owner tries to change treasuryBps", async function () {
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
      expect(defenderBalAfter.sub(defenderBalBefore)).to.be.gt(0);
    });

    it("2. should reward the attacker for partial damage dealt", async function () {
      await killGame.connect(userA).spawn(cube, 10);
      for(let i=0; i<10; i++) await ethers.provider.send("evm_mine");
      await killGame.connect(userB).spawn(cube, 100);
      const userBBalBefore = await killToken.balanceOf(userB.address);
      const tx = await killGame.connect(userB).kill(userA.address, cube, 100, 0);
      const receipt = await tx.wait();
      const event = receipt.events.find(e => e.event === 'Killed');
      const actualBounty = event.args.summary.attackerBounty;
      const userBBalAfter = await killToken.balanceOf(userB.address);
      expect(userBBalAfter.sub(userBBalBefore)).to.equal(actualBounty);
      expect(actualBounty).to.be.gt(0);
    });

    it("3. should emit DefenderRewarded event with correct amount", async function () {
      await killGame.connect(userA).spawn(cube, 50);
      await killGame.connect(userB).spawn(cube, 10);
      const tx = await killGame.connect(userB).kill(userA.address, cube, 10, 0);
      const receipt = await tx.wait();
      const event = receipt.events.find(e => e.event === 'DefenderRewarded');
      expect(event.args.amount).to.be.gt(0);
      expect(event.args.defender).to.equal(userA.address);
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

    it("21. should award exactly 500 Reapers when spawning 333333 units", async function () {
      await killGame.connect(userA).spawn(1, 333333);
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

    it("11. should reset birth block even if moving into a stack already occupied", async function () {
      // First move to stack 2
      await killGame.connect(userA).move(1, 2, 5, 0);
      const b1 = await killGame.getBirthBlock(userA.address, 2);
      
      // Advance time
      await ethers.provider.send("evm_mine");
      
      // Second move from stack 1 to stack 2 (adding more units)
      await killGame.connect(userA).move(1, 2, 5, 0);
      const b2 = await killGame.getBirthBlock(userA.address, 2);
      
      // Fixed: Birth block MUST be newer (greater) because any movement resets the age
      expect(b2).to.be.gt(b1);
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
  });

  describe("Global Statistics", function () {
    const cube = 1;
    it("15. should track total units killed globally", async function () {
      await killGame.connect(userA).spawn(cube, 10);
      await killGame.connect(userB).spawn(cube, 20);
      await killGame.connect(userB).kill(userA.address, cube, 20, 0);
      expect(await killGame.totalUnitsKilled()).to.equal(10);
    });
  });

  describe("Economic Simulation: Massive Treasury", function () {
    const logSim = (title, s) => {
      console.log(`\n--- ${title} ---`);
      console.log("Attacker Units Sent:      ", s.attackerUnitsSent.toString());
      console.log("Attacker Reaper Sent:     ", s.attackerReaperSent.toString());
      console.log("Attacker Units Lost:      ", s.attackerUnitsLost.toString());
      console.log("Attacker Reaper Lost:     ", s.attackerReaperLost.toString());
      console.log("Target Units Lost:        ", s.targetUnitsLost.toString());
      console.log("Target Reaper Lost:       ", s.targetReaperLost.toString());
      console.log("Initial Defender Units:   ", s.initialDefenderUnits.toString());
      console.log("Initial Defender Reaper:  ", s.initialDefenderReaper.toString());
      console.log("Attacker Bounty:          ", ethers.utils.formatEther(s.attackerBounty), "KILL");
      console.log("Defender Bounty:          ", ethers.utils.formatEther(s.defenderBounty), "KILL");
      console.log("--------------------------------------------\n");
    };

    it("Should handle 4B KILL seed and display full combat summary", async function () {
      const hugeSeed = ethers.utils.parseEther("4000000000"); 
      await killToken.mint(owner.address, hugeSeed);
      await killToken.connect(owner).transfer(killGame.address, hugeSeed);

      await killGame.connect(userA).spawn(1, 666);
      await killGame.connect(userB).spawn(1, 666);

      for(let i=0; i<5; i++) await ethers.provider.send("evm_mine");

      const tx = await killGame.connect(userB).kill(userA.address, 1, 666, 1);
      const receipt = await tx.wait();
      const event = receipt.events.find(e => e.event === 'Killed');
      logSim("ECONOMIC SIMULATION: 4B SEED RESULTS", event.args.summary);

      expect(event.args.summary.attackerBounty).to.be.gt(0);
    });

    it("SIM: Attacker sends 3x the Defender (Overwhelming Force)", async function () {
      const cube = 50;
      await killGame.connect(userA).spawn(cube, 100); 
      await killGame.connect(userB).spawn(cube, 300); 
      
      const tx = await killGame.connect(userB).kill(userA.address, cube, 300, 0);
      const receipt = await tx.wait();
      const event = receipt.events.find(e => e.event === 'Killed');
      logSim("SIM: ATTACKER 3X FORCE", event.args.summary);
      
      expect(event.args.summary.targetUnitsLost).to.equal(100);
      expect(event.args.summary.attackerUnitsLost).to.equal(0);
    });

    it("SIM: Defender has 3x the Attacker (Superior Defense)", async function () {
      const cube = 51;
      await killGame.connect(userA).spawn(cube, 300); 
      await killGame.connect(userB).spawn(cube, 100); 
      
      const tx = await killGame.connect(userB).kill(userA.address, cube, 100, 0);
      const receipt = await tx.wait();
      const event = receipt.events.find(e => e.event === 'Killed');
      logSim("SIM: DEFENDER 3X FORCE", event.args.summary);
      
      expect(event.args.summary.attackerUnitsLost).to.equal(100);
      expect(event.args.summary.targetUnitsLost).to.be.gt(0);
    });
  });
});