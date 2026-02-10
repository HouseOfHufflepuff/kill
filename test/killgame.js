const { expect } = require("chai");

describe("KILLGame: Spawn & Move", function () {
  let killToken, killGame, owner, user;

  beforeEach(async function () {
    [owner, user] = await ethers.getSigners();
    
    const KillToken = await ethers.getContractFactory("KILLToken");
    killToken = await KillToken.deploy();
    await killToken.deployed();

    const KILLGame = await ethers.getContractFactory("KILLGame");
    killGame = await KILLGame.deploy(killToken.address, owner.address);
    await killGame.deployed();

    const amount = ethers.utils.parseEther("10000");
    await killToken.mint(user.address, amount);
    await killToken.connect(user).approve(killGame.address, amount);
  });

  describe("Move Mechanics", function () {
    beforeEach(async function () {
      // Spawn 10 units in Cube 1 (ID 1)
      await killGame.connect(user).spawn(1, 10);
    });

    it("should move units and reset birth block", async function () {
        const [owner, user] = await ethers.getSigners();
        const fromCube = 1; 
        const toCube = 2;
        const moveAmount = 4;

        await ethers.provider.send("evm_mine");

        await killGame.connect(user).move(fromCube, toCube, moveAmount, 0);

        expect(await killGame.balanceOf(user.address, fromCube)).to.equal(6);
        expect(await killGame.balanceOf(user.address, toCube)).to.equal(4);

        const stack = await killGame.agentStacks(user.address, toCube);
        const currentBlock = await ethers.provider.getBlockNumber();
        
        // This handles both the array-return and the direct-value-return
        const birthBlock = stack[0] !== undefined ? stack[0] : stack;
        expect(birthBlock).to.equal(currentBlock);
    });

    it("should allow sequential moves to adjacent cubes", async function () {
      // Step 1: Move 1 -> 2 (Valid)
      await killGame.connect(user).move(1, 2, 2, 0);
      // Step 2: Move 2 -> 3 (Valid)
      await killGame.connect(user).move(2, 3, 2, 0);

      expect(await killGame.balanceOf(user.address, 3)).to.equal(2);
      expect(await killGame.balanceOf(user.address, 1)).to.equal(8);
    });

    it("should revert with 'Bad move' for non-adjacent cubes", async function () {
      // Distance 1 -> 3 is 2. 
      await expect(
        killGame.connect(user).move(1, 3, 1, 0)
      ).to.be.revertedWith("Bad move");
    });
  });

  describe("Spawn Mechanics", function () {
    it("should mint a boosted unit on exactly 666 units", async function () {
      await killGame.connect(user).spawn(1, 666);
      // ID 1 (Standard)
      expect(await killGame.balanceOf(user.address, 1)).to.equal(665);
      // ID 1 + 216 = 217 (Boosted)
      expect(await killGame.balanceOf(user.address, 217)).to.equal(1);
    });
  });
});