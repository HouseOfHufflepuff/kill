const { expect } = require("chai");
const { ethers } = require("hardhat");
const { MerkleTree } = require("merkletreejs");
const keccak256 = require("keccak256");

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
    await killToken.connect(owner).transfer(userA.address, amount);
    await killToken.connect(owner).transfer(userB.address, amount);

    const seedAmount = ethers.utils.parseEther("1000000");
    await killToken.connect(owner).transfer(killGame.address, seedAmount);
    
    await killToken.connect(userA).approve(killGame.address, amount);
    await killToken.connect(userB).approve(killGame.address, amount);
  });

  // Helper: calls setConfig with defaults, overriding only specified fields
  const defaults = {
    spawnCost: ethers.utils.parseEther("20"),
    treasuryBps: 30,
    maxMultiplier: 20,
    blocksPerMultiplier: 2273,
    globalCapBps: 2500,
  };
  const setConfig = (signer, overrides = {}) => {
    const c = { ...defaults, ...overrides };
    return killGame.connect(signer).setConfig(
      c.spawnCost, c.treasuryBps, c.maxMultiplier, c.blocksPerMultiplier, c.globalCapBps
    );
  };

  describe("Owner Functions & Access Control", function () {
    it("16. should allow owner to change treasuryBps via setConfig", async function () {
      await setConfig(owner, { treasuryBps: 7500 });
      expect(await killGame.treasuryBps()).to.equal(7500);
    });

    it("17. should revert if a non-owner tries setConfig", async function () {
      await expect(setConfig(userA, { treasuryBps: 5000 }))
        .to.be.revertedWithCustomError(killGame, "OwnableUnauthorizedAccount")
        .withArgs(userA.address);
    });

    it("18. should correctly scale pending rewards when age increases", async function () {
      await killGame.connect(userA).spawn(1, 100);
      await fastForward(2300);
      const pendingOld = await killGame.getPendingBounty(userA.address, 1);
      await fastForward(2300);
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

    it("should have correct defaults on deploy", async function () {
      expect(await killGame.spawnCost()).to.equal(ethers.utils.parseEther("20"));
      expect(await killGame.treasuryBps()).to.equal(30);
      expect(await killGame.maxMultiplier()).to.equal(20);
      expect(await killGame.blocksPerMultiplier()).to.equal(2273);
      expect(await killGame.globalCapBps()).to.equal(2500);
    });

    it("should update all config values and emit ConfigUpdated", async function () {
      const newCost = ethers.utils.parseEther("50");
      await expect(setConfig(owner, { spawnCost: newCost, treasuryBps: 500, maxMultiplier: 10, blocksPerMultiplier: 1000, globalCapBps: 1000 }))
        .to.emit(killGame, "ConfigUpdated")
        .withArgs(newCost, 500, 10, 1000, 1000);
      expect(await killGame.spawnCost()).to.equal(newCost);
      expect(await killGame.treasuryBps()).to.equal(500);
      expect(await killGame.maxMultiplier()).to.equal(10);
      expect(await killGame.blocksPerMultiplier()).to.equal(1000);
      expect(await killGame.globalCapBps()).to.equal(1000);
    });

    it("should charge the updated spawnCost on spawn", async function () {
      const newCost = ethers.utils.parseEther("50");
      await setConfig(owner, { spawnCost: newCost });

      const before = await killToken.balanceOf(userA.address);
      await killGame.connect(userA).spawn(1, 10);
      const after = await killToken.balanceOf(userA.address);
      // 10 units * 50 KILL = 500 KILL
      expect(before.sub(after)).to.equal(newCost.mul(10));
    });

    it("should revert setConfig with zero spawnCost", async function () {
      await expect(setConfig(owner, { spawnCost: 0 }))
        .to.be.revertedWith("Zero cost");
    });

    it("should cap multiplier at maxMultiplier", async function () {
      // Set maxMultiplier to 3, blocksPerMultiplier to 10 for fast testing
      await setConfig(owner, { maxMultiplier: 3, blocksPerMultiplier: 10 });
      await killGame.connect(userA).spawn(1, 100);
      // Fast forward well past 3x (30 blocks would be 3x + 1 = 4x uncapped)
      await fastForward(100);
      const pending = await killGame.getPendingBounty(userA.address, 1);
      // Bounty uses headcount: 100 units * 1e18 * 3 = 300e18
      expect(pending).to.equal(ethers.utils.parseEther("300"));
    });

    it("should use headcount not power for bounty (reapers count as 1)", async function () {
      // Spawn 666 units → gets 1 free reaper (667 total headcount)
      await killGame.connect(userA).spawn(1, 666);
      const pending = await killGame.getPendingBounty(userA.address, 1);
      // 666 units + 1 reaper = 667 headcount, multiplier = 1
      expect(pending).to.equal(ethers.utils.parseEther("667"));
    });

    it("should respect globalCapBps limit", async function () {
      // Lower cap to 1% of vault
      await setConfig(owner, { globalCapBps: 100 });
      // Spawn a massive stack so rawBounty exceeds the cap
      await killGame.connect(userA).spawn(1, 100000);
      await fastForward(5000);
      const pending = await killGame.getPendingBounty(userA.address, 1);
      const vaultBalance = await killToken.balanceOf(killGame.address);
      const cap = vaultBalance.mul(100).div(10000);
      expect(pending).to.equal(cap);
    });
  });

  describe("Power Decay", function () {
    it("fresh units should fight at full power (100% decay)", async function () {
      // Use fast blocksPerMultiplier for testing
      await setConfig(owner, { blocksPerMultiplier: 10, maxMultiplier: 20 });
      // userA has 100 units, userB has 90 — attacker should win fresh
      await killGame.connect(userA).spawn(1, 100);
      await killGame.connect(userB).spawn(1, 90);
      await killGame.connect(userA).kill(userB.address, 1, 100, 0);
      expect(await killGame.balanceOf(userB.address, 1)).to.equal(0);
    });

    it("aged attacker should lose to fresh defender due to decay", async function () {
      await setConfig(owner, { blocksPerMultiplier: 10, maxMultiplier: 20 });
      // userA spawns and ages to near-minimum power (1/5)
      await killGame.connect(userA).spawn(1, 100);
      await fastForward(200); // well past max age
      // userB spawns fresh — full power
      await killGame.connect(userB).spawn(1, 30);
      // Aged 100 units at 20% power = effective 20
      // Fresh 30 units at 100% + 10% defender bonus = effective 33
      // Attacker should lose
      await killGame.connect(userA).kill(userB.address, 1, 100, 0);
      expect(await killGame.balanceOf(userA.address, 1)).to.equal(0);
      expect(await killGame.balanceOf(userB.address, 1)).to.be.gt(0);
    });

    it("move should reset decay (fresh power after move)", async function () {
      await setConfig(owner, { blocksPerMultiplier: 10, maxMultiplier: 20 });
      await killGame.connect(userA).spawn(1, 100);
      await fastForward(200); // fully decayed
      // Move resets birth block → full power again
      await killGame.connect(userA).move(1, 2, 100, 0);
      // Now attack a fresh but smaller defender
      await killGame.connect(userB).spawn(2, 30);
      // Fresh 100 vs fresh 30 + 10% bonus = 33 → attacker wins
      await killGame.connect(userA).kill(userB.address, 2, 100, 0);
      expect(await killGame.balanceOf(userB.address, 2)).to.equal(0);
    });
  });

  describe("Bi-directional Looting (Combat Logic)", function () {
    const cube = 1;
    it("1. should reward the defender when they successfully repel an attack", async function () {
      await killGame.connect(userA).spawn(cube, 100);
      await fastForward(2300);
      await killGame.connect(userB).spawn(cube, 10);
      const before = await killToken.balanceOf(userA.address);
      await killGame.connect(userB).kill(userA.address, cube, 10, 0);
      expect((await killToken.balanceOf(userA.address)).sub(before)).to.be.gt(0);
    });

    it("2. should reward the attacker for partial damage dealt", async function () {
      await killGame.connect(userA).spawn(cube, 10);
      await fastForward(2300);
      await killGame.connect(userB).spawn(cube, 100);
      await fastForward(2300);
      
      const before = await killToken.balanceOf(userB.address);
      await killGame.connect(userB).kill(userA.address, cube, 100, 0);
      const after = await killToken.balanceOf(userB.address);
      
      expect(after.sub(before)).to.be.gt(0);
    });

    it("3. should emit DefenderRewarded event with correct amount", async function () {
      await killGame.connect(userA).spawn(cube, 50);
      await fastForward(2300);
      await killGame.connect(userB).spawn(cube, 10);
      const tx = await killGame.connect(userB).kill(userA.address, cube, 10, 0);
      await tx.wait();
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
      // In new logic, age is preserved when moving into an existing stack
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

    it("22. should RESET birth block on destination for empty blocks", async function () {
      await killGame.connect(userA).spawn(1, 100);
      const initial = await killGame.getBirthBlock(userA.address, 1);
      
      // Fast forward to increase age
      await fastForward(5);
      const currentBlock = await ethers.provider.getBlockNumber();

      // Move partial units to an EMPTY block (stack 2)
      await killGame.connect(userA).move(1, 2, 50, 0);
      
      const originBirthAfter = await killGame.getBirthBlock(userA.address, 1);
      const destBirthAfter = await killGame.getBirthBlock(userA.address, 2);

      // Origin age is preserved if not emptied
      expect(originBirthAfter).to.equal(initial);
      
      // Destination birth block must be reset to the block of the move (1x multiplier)
      expect(destBirthAfter).to.equal(currentBlock + 1);
      expect(destBirthAfter).to.be.gt(initial);
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

  // ── Merkle tree helpers shared by airdrop tests ──────────────────────────
  function buildTree(signers) {
    const leaves = signers.map(s =>
      Buffer.from(
        ethers.utils.solidityKeccak256(["address"], [s.address]).slice(2),
        "hex"
      )
    );
    const tree = new MerkleTree(leaves, keccak256, { sortPairs: true });
    return { tree, leaves };
  }

  function getProof(tree, leaves, signer, signers) {
    const idx = signers.findIndex(s => s.address === signer.address);
    return tree.getHexProof(leaves[idx]);
  }

  describe("Airdrop: claim()", function () {
    let tree, leaves, root;

    beforeEach(async function () {
      ({ tree, leaves } = buildTree([owner, userA, userB]));
      root = tree.getHexRoot();
    });

    it("should have correct airdropAmount default (3M KILL)", async function () {
      expect(await killGame.airdropAmount()).to.equal(ethers.utils.parseEther("3000000"));
    });

    it("should revert claim when merkleRoot is cleared to zero", async function () {
      await killGame.connect(owner).setMerkleRoot(ethers.constants.HashZero);
      const proof = getProof(tree, leaves, userA, [owner, userA, userB]);
      await expect(killGame.connect(userA).claim(proof, 1))
        .to.be.revertedWith("No airdrop");
    });

    it("should allow owner to set merkle root", async function () {
      await killGame.connect(owner).setMerkleRoot(root);
      expect(await killGame.merkleRoot()).to.equal(root);
    });

    it("should revert with invalid proof (not in tree)", async function () {
      await killGame.connect(owner).setMerkleRoot(root);
      // userA's proof won't verify for owner
      const wrongProof = getProof(tree, leaves, userA, [owner, userA, userB]);
      // sign as a random signer not in the tree
      const [,,, stranger] = await ethers.getSigners();
      await expect(killGame.connect(stranger).claim(wrongProof, 1))
        .to.be.revertedWith("Not eligible");
    });

    it("should spawn correct units on valid claim", async function () {
      await killGame.connect(owner).setMerkleRoot(root);
      const proof = getProof(tree, leaves, userA, [owner, userA, userB]);

      // airdropAmount = 3M KILL, spawnCost = 20 KILL → 150,000 units
      const expectedUnits = ethers.utils.parseEther("3000000").div(ethers.utils.parseEther("20"));

      await expect(killGame.connect(userA).claim(proof, 1))
        .to.emit(killGame, "Claimed")
        .withArgs(userA.address, 1, expectedUnits);

      expect(await killGame.balanceOf(userA.address, 1)).to.equal(expectedUnits);
    });

    it("should mark hasClaimed and prevent double claim", async function () {
      await killGame.connect(owner).setMerkleRoot(root);
      const proof = getProof(tree, leaves, userA, [owner, userA, userB]);

      await killGame.connect(userA).claim(proof, 1);
      expect(await killGame.hasClaimed(userA.address)).to.be.true;

      await expect(killGame.connect(userA).claim(proof, 1))
        .to.be.revertedWith("Already claimed");
    });

    it("should allow owner to update airdropAmount", async function () {
      const newAmount = ethers.utils.parseEther("6000000");
      await killGame.connect(owner).setAirdropAmount(newAmount);
      expect(await killGame.airdropAmount()).to.equal(newAmount);
    });

    it("should spawn updated unit count when airdropAmount changes", async function () {
      await killGame.connect(owner).setMerkleRoot(root);
      // Double the airdrop: 6M KILL / 20 KILL = 300,000 units
      await killGame.connect(owner).setAirdropAmount(ethers.utils.parseEther("6000000"));
      const proof = getProof(tree, leaves, userA, [owner, userA, userB]);

      await killGame.connect(userA).claim(proof, 1);
      expect(await killGame.balanceOf(userA.address, 1))
        .to.equal(ethers.BigNumber.from(300000));
    });
  });

  describe("Airdrop: auto-kill on claim", function () {
    // Uses the synthetic tree (owner, userA, userB) so we control the merkle root.
    // Tests the spawn+kill multicall behaviour inside claim().
    let tree, leaves, root;
    // claim units = 3M KILL / 20 KILL = 150,000.  threshold = 75,000.
    const CLAIM_UNITS = ethers.BigNumber.from(3_000_000).div(20); // 150,000
    const THRESHOLD   = CLAIM_UNITS.div(2);                       //  75,000

    beforeEach(async function () {
      ({ tree, leaves } = buildTree([owner, userA, userB]));
      root = tree.getHexRoot();
      await killGame.connect(owner).setMerkleRoot(root);
    });

    it("auto-kills a weak occupant (units <= 50% of claim) and emits Killed", async function () {
      // userB spawns 50,000 units on stack 1 — below the 75,000 threshold
      await killGame.connect(userB).spawn(1, 50_000);
      expect(await killGame.balanceOf(userB.address, 1)).to.equal(50_000);

      const proof   = getProof(tree, leaves, userA, [owner, userA, userB]);
      const tx      = await killGame.connect(userA).claim(proof, 1);
      const receipt = await tx.wait();

      // Both Claimed and Killed events emitted in the same tx
      const claimedEvents = receipt.events.filter(e => e.event === "Claimed");
      const killedEvents  = receipt.events.filter(e => e.event === "Killed");
      expect(claimedEvents.length).to.equal(1);
      expect(killedEvents.length).to.equal(1);

      const k = killedEvents[0].args;
      expect(k.attacker).to.equal(userA.address);
      expect(k.target).to.equal(userB.address);
      expect(k.stackId).to.equal(1);
      // Attacker sent full claim units and won — 0 losses
      expect(k.summary.attackerUnitsSent).to.equal(CLAIM_UNITS);
      expect(k.summary.attackerUnitsLost).to.equal(0);
      // Defender lost everything
      expect(k.summary.targetUnitsLost).to.equal(50_000);

      // Weak occupant's units are gone; claimer keeps all
      expect(await killGame.balanceOf(userB.address, 1)).to.equal(0);
      expect(await killGame.balanceOf(userA.address, 1)).to.equal(CLAIM_UNITS);
    });

    it("does NOT auto-kill when occupant has > 50% of claim units", async function () {
      // userB spawns 100,000 units — above the 75,000 threshold
      await killGame.connect(userB).spawn(1, 100_000);

      const proof = getProof(tree, leaves, userA, [owner, userA, userB]);
      const tx    = await killGame.connect(userA).claim(proof, 1);
      const receipt = await tx.wait();

      const killedEvents = receipt.events.filter(e => e.event === "Killed");
      expect(killedEvents.length).to.equal(0);

      // Both wallets keep their units
      expect(await killGame.balanceOf(userB.address, 1)).to.equal(100_000);
      expect(await killGame.balanceOf(userA.address, 1)).to.equal(CLAIM_UNITS);
    });

    it("does NOT auto-kill when stack is empty (claimer is first occupant)", async function () {
      const proof   = getProof(tree, leaves, userA, [owner, userA, userB]);
      const tx      = await killGame.connect(userA).claim(proof, 1);
      const receipt = await tx.wait();

      const killedEvents = receipt.events.filter(e => e.event === "Killed");
      expect(killedEvents.length).to.equal(0);
      expect(await killGame.balanceOf(userA.address, 1)).to.equal(CLAIM_UNITS);
    });

    it("auto-kill is exact at threshold boundary (units == 50%)", async function () {
      // userB spawns exactly 75,000 units — right at the <= threshold
      await killGame.connect(userB).spawn(1, THRESHOLD.toNumber());

      const proof   = getProof(tree, leaves, userA, [owner, userA, userB]);
      const tx      = await killGame.connect(userA).claim(proof, 1);
      const receipt = await tx.wait();

      const killedEvents = receipt.events.filter(e => e.event === "Killed");
      expect(killedEvents.length).to.equal(1);
      expect(await killGame.balanceOf(userB.address, 1)).to.equal(0);
    });

    it("auto-kill: claimer earns bounty when target has mature pending bounty", async function () {
      // Seed target with units and age them to generate a bounty
      await killGame.connect(userB).spawn(1, 50_000);
      // Fast-forward enough blocks to give userB a multiplier > 1
      await setConfig(owner, { blocksPerMultiplier: 1 }); // 1 block per mult for test speed
      await fastForward(5);

      const bountyBefore = await killGame.getPendingBounty(userB.address, 1);
      expect(bountyBefore).to.be.gt(0);

      const claimerBalBefore = await killToken.balanceOf(userA.address);
      const proof = getProof(tree, leaves, userA, [owner, userA, userB]);
      await killGame.connect(userA).claim(proof, 1);

      const claimerBalAfter = await killToken.balanceOf(userA.address);
      expect(claimerBalAfter).to.be.gt(claimerBalBefore);
    });
  });

  describe("Airdrop: pt1 live tree", function () {
    // Uses the hardcoded merkle root and real proofs from pt1-tree.json.
    // Impersonates actual pt1 addresses so no setMerkleRoot() is needed.
    const path = require("path");
    const fs   = require("fs");
    const PT1_TREE = path.join(__dirname, "../../../scripts/base/pt1-tree.json");

    let treeData, pt1Address, pt1Proof;

    before(async function () {
      treeData   = JSON.parse(fs.readFileSync(PT1_TREE, "utf8"));
      pt1Address = Object.keys(treeData.proofs)[0];   // first pt1 wallet
      pt1Proof   = treeData.proofs[pt1Address];
    });

    async function impersonate(addr) {
      await ethers.provider.send("hardhat_impersonateAccount", [addr]);
      await ethers.provider.send("hardhat_setBalance", [addr, "0xDE0B6B3A7640000"]); // 1 ETH for gas
      return ethers.provider.getSigner(addr);
    }

    async function stopImpersonate(addr) {
      await ethers.provider.send("hardhat_stopImpersonatingAccount", [addr]);
    }

    it("pt1 wallet: can claim and receives correct units", async function () {
      const signer = await impersonate(pt1Address);
      const expectedUnits = ethers.BigNumber.from(3_000_000).div(20); // 150,000

      await expect(killGame.connect(signer).claim(pt1Proof, 1))
        .to.emit(killGame, "Claimed")
        .withArgs(ethers.utils.getAddress(pt1Address), 1, expectedUnits);

      expect(await killGame.balanceOf(pt1Address, 1)).to.equal(expectedUnits);
      await stopImpersonate(pt1Address);
    });

    it("pt1 wallet: cannot claim a second time", async function () {
      const signer = await impersonate(pt1Address);

      await killGame.connect(signer).claim(pt1Proof, 1);
      await expect(killGame.connect(signer).claim(pt1Proof, 1))
        .to.be.revertedWith("Already claimed");

      await stopImpersonate(pt1Address);
    });

    it("wallet not on pt1: cannot claim with a stolen proof", async function () {
      // Steal a valid proof but call from a different address
      const [,,, stranger] = await ethers.getSigners();
      await expect(killGame.connect(stranger).claim(pt1Proof, 1))
        .to.be.revertedWith("Not eligible");
    });

    it("wallet not on pt1: cannot claim with an empty proof", async function () {
      const [,,, stranger] = await ethers.getSigners();
      await expect(killGame.connect(stranger).claim([], 1))
        .to.be.revertedWith("Not eligible");
    });

    it("second pt1 wallet: can independently claim", async function () {
      const addr2  = Object.keys(treeData.proofs)[1];
      const proof2 = treeData.proofs[addr2];
      const signer = await impersonate(addr2);
      const expectedUnits = ethers.BigNumber.from(3_000_000).div(20);

      await killGame.connect(signer).claim(proof2, 5);
      expect(await killGame.balanceOf(addr2, 5)).to.equal(expectedUnits);
      expect(await killGame.hasClaimed(addr2)).to.be.true;

      await stopImpersonate(addr2);
    });

    it("pt1 claim: auto-kills a weak occupant placed on the target stack", async function () {
      // userA (test signer) spawns 50,000 units on stack 3 — below 75,000 threshold
      await killGame.connect(userA).spawn(3, 50_000);

      const signer = await impersonate(pt1Address);
      const proof  = treeData.proofs[pt1Address];

      const tx      = await killGame.connect(signer).claim(proof, 3);
      const receipt = await tx.wait();

      const killedEvents = receipt.events.filter(e => e.event === "Killed");
      expect(killedEvents.length).to.equal(1);
      expect(killedEvents[0].args.attacker.toLowerCase()).to.equal(pt1Address.toLowerCase());
      expect(killedEvents[0].args.target).to.equal(userA.address);

      // Weak occupant eliminated
      expect(await killGame.balanceOf(userA.address, 3)).to.equal(0);

      await stopImpersonate(pt1Address);
    });

    it("pt1 claim: no auto-kill when stack has a strong occupant", async function () {
      // userA spawns 100,000 units — above the 75,000 threshold
      await killGame.connect(userA).spawn(3, 100_000);

      const signer = await impersonate(pt1Address);
      const proof  = treeData.proofs[pt1Address];

      const tx      = await killGame.connect(signer).claim(proof, 3);
      const receipt = await tx.wait();

      const killedEvents = receipt.events.filter(e => e.event === "Killed");
      expect(killedEvents.length).to.equal(0);

      // Strong occupant survives
      expect(await killGame.balanceOf(userA.address, 3)).to.equal(100_000);

      await stopImpersonate(pt1Address);
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
      // Setup: userA occupies stack 1
      await killGame.connect(userA).spawn(1, 100);
      // Setup: userB occupies stack 2
      await killGame.connect(userB).spawn(2, 500); 

      // Multicall: Move from 2 to 1, then attack 1. 
      // Amount moved (100) must be enough to destroy userA's 100 units.
      const moveData = killGame.interface.encodeFunctionData("move", [2, 1, 500, 0]);
      const killData = killGame.interface.encodeFunctionData("kill", [userA.address, 1, 500, 0]);
      
      await killGame.connect(userB).multicall([moveData, killData]);

      // Check: userA units should be destroyed
      expect(await killGame.balanceOf(userA.address, 1)).to.equal(0);
    });
  });
});