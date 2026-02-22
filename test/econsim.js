const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("KILLGame: Economic Simulation", function () {
  let killToken, killGame, owner, userA, userB;

  const fastForward = async (blocks) => {
    for (let i = 0; i < blocks; i++) {
      await ethers.provider.send("evm_mine");
    }
  };

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

  beforeEach(async function () {
    [owner, userA, userB] = await ethers.getSigners();
    const KillToken = await ethers.getContractFactory("KILLToken"); 
    killToken = await KillToken.deploy();
    await killToken.deployed();
    const KILLGame = await ethers.getContractFactory("KILLGame");
    killGame = await KILLGame.deploy(killToken.address);
    await killGame.deployed();

    // Reduced to 1B to avoid ERC20ExceededCap (6.66B cap)
    const amount = ethers.utils.parseEther("1000000000"); 
    await killToken.mint(userA.address, amount);
    await killToken.mint(userB.address, amount);
    await killToken.connect(userA).approve(killGame.address, amount);
    await killToken.connect(userB).approve(killGame.address, amount);
  });

  it("Should handle 4B KILL seed and display full combat summary", async function () {
    const hugeSeed = ethers.utils.parseEther("4000000000"); 
    await killToken.mint(owner.address, hugeSeed);
    await killToken.connect(owner).transfer(killGame.address, hugeSeed);
    
    await killGame.connect(userA).spawn(1, 666);
    await fastForward(1100);
    await killGame.connect(userB).spawn(1, 666);
    await fastForward(1100);

    const tx = await killGame.connect(userB).kill(userA.address, 1, 666, 1);
    const receipt = await tx.wait();
    const event = receipt.events.find(e => e.event === 'Killed');
    logSim("ECONOMIC SIMULATION: 4B SEED RESULTS", event.args.summary);
    expect(event.args.summary.attackerBounty).to.be.gt(0);
  });

  it("SIM: Attacker sends 3x the Defender (Overwhelming Force)", async function () {
    await killGame.connect(userA).spawn(50, 100); 
    await killGame.connect(userB).spawn(50, 300); 
    await fastForward(1100);
    const tx = await killGame.connect(userB).kill(userA.address, 50, 300, 0);
    const receipt = await tx.wait();
    const event = receipt.events.find(e => e.event === 'Killed');
    logSim("SIM: ATTACKER 3X FORCE", event.args.summary);
    expect(event.args.summary.targetUnitsLost).to.equal(100);
  });

  it("SIM: Defender has 3x the Attacker (Superior Defense)", async function () {
    await killGame.connect(userA).spawn(51, 300); 
    await killGame.connect(userB).spawn(51, 100); 
    await fastForward(1100);
    const tx = await killGame.connect(userB).kill(userA.address, 51, 100, 0);
    const receipt = await tx.wait();
    const event = receipt.events.find(e => e.event === 'Killed');
    logSim("SIM: DEFENDER 3X FORCE", event.args.summary);
    expect(event.args.summary.attackerUnitsLost).to.equal(100);
  });
});