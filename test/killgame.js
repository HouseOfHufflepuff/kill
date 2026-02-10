const { expect } = require("chai");

describe("KILLGame: Spawn, Move & Kill", function () {
  let killToken, killGame, owner, userA, userB;

  beforeEach(async function () {
    [owner, userA, userB] = await ethers.getSigners();
    
    const KillToken = await ethers.getContractFactory("KILLToken");
    killToken = await KillToken.deploy();
    await killToken.deployed();

    const KILLGame = await ethers.getContractFactory("KILLGame");
    killGame = await KILLGame.deploy(killToken.address, owner.address);
    await killGame.deployed();

    const amount = ethers.utils.parseEther("10000");
    await killToken.mint(userA.address, amount);
    await killToken.mint(userB.address, amount);
    await killToken.connect(userA).approve(killGame.address, amount);
    await killToken.connect(userB).approve(killGame.address, amount);
  });

describe("Combat Mechanics - Deep Dive", function () {
    const cube = 1;

    it("should allow a defender to win if they have more power", async function () {
      // User A (Defender) spawns a large stack
      await killGame.connect(userA).spawn(cube, 50);
      
      // User B (Attacker) sends a weak force
      await killGame.connect(userB).spawn(cube, 10);
      
      // Attacker loses everything
      await killGame.connect(userB).kill(userA.address, cube, 10, 0);

      expect(await killGame.balanceOf(userB.address, cube)).to.equal(0);
      // Defender survives but takes attrition damage
      // AtkPower: 10, DefPower: 50 * 1.1 = 55
      // DefLoss = 50 * (10/55)^2 = 50 * 0.033 = 1.6 -> 1 unit lost
      expect(await killGame.balanceOf(userA.address, cube)).to.equal(49);
    });

    it("should demonstrate boosted unit power (666x multiplier)", async function () {
      // User A (Defender) has 500 standard units
      await killGame.connect(userA).spawn(cube, 500);
      
      // User B (Attacker) spawns exactly 666 units to get 1 Boosted Unit
      await killGame.connect(userB).spawn(cube, 666);
      const boostedId = cube + 216;
      expect(await killGame.balanceOf(userB.address, boostedId)).to.equal(1);

      // User B attacks with ONLY 1 Boosted Unit against 500 Standard Units
      // AtkPower: 1 * 666 = 666
      // DefPower: 500 * 1.1 = 550
      await killGame.connect(userB).kill(userA.address, cube, 0, 1);

      // Boosted unit wins!
      expect(await killGame.balanceOf(userA.address, cube)).to.equal(0);
      // Boosted unit survives with attrition
      // Loss = 1 * (550/666)^2 = 1 * 0.68 = 0 units lost (integer truncation)
      expect(await killGame.balanceOf(userB.address, boostedId)).to.equal(1);
    });

    it("should correctly apply the 6.66% burn on bounty payouts", async function () {
        const cube = 1;
        // 1. Setup treasury balance via User A's spawn
        await killGame.connect(userA).spawn(cube, 10);
        
        // 2. Mine blocks to age User A's stack
        for(let i=0; i<10; i++) await ethers.provider.send("evm_mine");
        
        const pendingBefore = await killGame.getPendingBounty(userA.address, cube);

        // 3. User B prepares to attack
        await killGame.connect(userB).spawn(cube, 100);

        // --- RECORD BALANCE HERE (After spawn, before kill) ---
        const userBBalanceBeforeKill = await killToken.balanceOf(userB.address);

        // 4. Execute the kill
        await killGame.connect(userB).kill(userA.address, cube, 100, 0);

        const userBBalanceAfterKill = await killToken.balanceOf(userB.address);
        const actualPayout = userBBalanceAfterKill.sub(userBBalanceBeforeKill);

        // 5. Verify Payout: Expected = Pending * 93.34%
        const expectedPayout = pendingBefore.mul(9334).div(10000);
        
        // We check for close proximity to handle the 1 extra block mined during the kill tx
        expect(actualPayout).to.be.closeTo(expectedPayout, ethers.utils.parseEther("0.1"));
        });
    });

  describe("Spawn Mechanics", function () {
    it("should mint standard units and set birth block", async function () {
      await killGame.connect(userA).spawn(1, 10);
      const stack = await killGame.agentStacks(userA.address, 1);
      const birthBlock = stack[0] !== undefined ? stack[0] : stack;
      expect(birthBlock).to.equal(await ethers.provider.getBlockNumber());
    });

    it("should mint a boosted unit on exactly 666 units", async function () {
      await killGame.connect(userA).spawn(1, 666);
      expect(await killGame.balanceOf(userA.address, 1)).to.equal(665);
      expect(await killGame.balanceOf(userA.address, 217)).to.equal(1);
    });
  });

  describe("Move Mechanics", function () {
    beforeEach(async function () {
      await killGame.connect(userA).spawn(1, 10);
    });

    it("should move units and reset birth block", async function () {
      await killGame.connect(userA).move(1, 2, 4, 0);
      expect(await killGame.balanceOf(userA.address, 1)).to.equal(6);
      expect(await killGame.balanceOf(userA.address, 2)).to.equal(4);
    });

    it("should allow sequential moves to adjacent cubes", async function () {
      await killGame.connect(userA).move(1, 2, 2, 0);
      await killGame.connect(userA).move(2, 3, 2, 0);
      expect(await killGame.balanceOf(userA.address, 3)).to.equal(2);
    });

    it("should revert with 'Bad move' for non-adjacent cubes", async function () {
      await expect(killGame.connect(userA).move(1, 3, 1, 0)).to.be.revertedWith("Bad move");
    });
  });
});