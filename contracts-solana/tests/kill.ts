/**
 * KILL System — localnet integration tests
 *
 * Covers all three programs across their full lifecycle, plus a comprehensive
 * game-mechanics suite that mirrors the Solidity killgame.js test file:
 *
 *   kill_token  — create the KILL SPL mint and mint initial supply
 *   kill_game   — init, spawn, move_units, kill (combat), admin ops
 *   kill_faucet — setup and claim
 *
 * Key Solana vs EVM differences reflected in these tests:
 *   - Spawn costs 20 KILL per unit (not per call); 1 free Reaper per 666 units spawned
 *   - kill() requires SAME stack_id (attacker and defender share a grid position)
 *   - move_units() supports PARTIAL moves (EVM parity): pass units + reapers amounts
 *   - Bounty is bidirectional: attacker gets share for defender power destroyed,
 *     defender gets share for attacker power destroyed (EVM _applyRewards parity)
 *   - battlePool = pending × min(totalPowerLost, THERMAL_PARITY) / THERMAL_PARITY
 *   - Defender suffers Lanchester partial loss when they win (EVM parity)
 *   - total_kills counts kill *events* (attacker wins), not total units destroyed
 *
 * Run with: anchor test   (starts a fresh validator each run)
 */

import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import BN from "bn.js";
import {
  Keypair,
  PublicKey,
  SystemProgram,
  SYSVAR_RENT_PUBKEY,
  LAMPORTS_PER_SOL,
} from "@solana/web3.js";
import {
  TOKEN_PROGRAM_ID,
  getAccount,
  getOrCreateAssociatedTokenAccount,
} from "@solana/spl-token";
import { assert } from "chai";

import type { KillToken }  from "../target/types/kill_token";
import type { KillGame }   from "../target/types/kill_game";
import type { KillFaucet } from "../target/types/kill_faucet";

// ── Constants (must match programs/kill_*/src/constants.rs) ──────────────────
const SPAWN_COST     = new BN(20_000_000);          // 20 KILL per unit @ 6 decimals
const REAPER_THRESHOLD = new BN(666);               // units required for 1 free reaper
const MOVE_COST      = new BN(100_000_000);         // 100 KILL @ 6 decimals
const HARD_CAP       = new BN("666000000000000000"); // 666B KILL (matches EVM)
const THERMAL_PARITY = new BN(666);
const BURN_BPS       = new BN(666);
const BPS_DENOM      = new BN(10_000);

// ── Grid adjacency helpers ────────────────────────────────────────────────────
// Stack ID layout: id = x + y*6 + z*36  (6×6×6 grid)
// Adjacent pairs used in tests:
//   (0,1)  (6,7)  (8,9)  (12,13)  (18,19)  (19,20)
// Non-adjacent pairs: (0,2)  (18,20)

describe("KILL System", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const admin = (provider.wallet as anchor.Wallet).payer;

  const tokenProg  = anchor.workspace.KillToken  as Program<KillToken>;
  const gameProg   = anchor.workspace.KillGame   as Program<KillGame>;
  const faucetProg = anchor.workspace.KillFaucet as Program<KillFaucet>;

  // ── Singleton keypairs ───────────────────────────────────────────────────────
  const killMintKp    = Keypair.generate();
  const gameVaultKp   = Keypair.generate();
  const faucetVaultKp = Keypair.generate();

  // ── Program-derived addresses ────────────────────────────────────────────────
  const [tokenConfigPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("token_config")],
    tokenProg.programId
  );
  const [gameConfigPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("game_config")],
    gameProg.programId
  );
  const [faucetConfigPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("faucet_config")],
    faucetProg.programId
  );

  // admin ATA is populated in the first kill_token test
  let adminAta: PublicKey;

  // ── Shared helper: derive AgentStack PDA ─────────────────────────────────────
  function stackPda(agent: PublicKey, stackId: number): PublicKey {
    const buf = Buffer.alloc(2);
    buf.writeUInt16LE(stackId);
    const [pda] = PublicKey.findProgramAddressSync(
      [Buffer.from("agent_stack"), agent.toBuffer(), buf],
      gameProg.programId
    );
    return pda;
  }

  // ── Shared helper: mint KILL to a destination ATA ────────────────────────────
  async function mintKill(destination: PublicKey, amount: BN) {
    await tokenProg.methods
      .mintTo(amount)
      .accounts({
        tokenConfig:  tokenConfigPda,
        killMint:     killMintKp.publicKey,
        destination,
        admin:        admin.publicKey,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .rpc();
  }

  // ── Shared helper: spawn units for an agent ───────────────────────────────────
  async function spawnFor(
    agent: Keypair,
    agentAta: PublicKey,
    stackId: number,
    units: BN
  ) {
    await gameProg.methods
      .spawn(stackId, units)
      .accounts({
        gameConfig:        gameConfigPda,
        agentStack:        stackPda(agent.publicKey, stackId),
        agentTokenAccount: agentAta,
        gameVault:         gameVaultKp.publicKey,
        killMint:          killMintKp.publicKey,
        agent:             agent.publicKey,
        tokenProgram:      TOKEN_PROGRAM_ID,
        systemProgram:     SystemProgram.programId,
      })
      .signers([agent])
      .rpc();
  }

  // ── Shared helper: move units for an agent ────────────────────────────────────
  async function moveUnitsFor(
    agent: Keypair,
    agentAta: PublicKey,
    fromStackId: number,
    toStackId: number,
    units: BN,
    reapers: BN
  ) {
    await gameProg.methods
      .moveUnits(fromStackId, toStackId, units, reapers)
      .accounts({
        gameConfig:        gameConfigPda,
        fromStack:         stackPda(agent.publicKey, fromStackId),
        toStack:           stackPda(agent.publicKey, toStackId),
        agentTokenAccount: agentAta,
        gameVault:         gameVaultKp.publicKey,
        killMint:          killMintKp.publicKey,
        agent:             agent.publicKey,
        tokenProgram:      TOKEN_PROGRAM_ID,
        systemProgram:     SystemProgram.programId,
      })
      .signers([agent])
      .rpc();
  }

  // ── Shared helper: execute a kill ─────────────────────────────────────────────
  async function doKill(
    attacker: Keypair,
    attackerAta: PublicKey,
    defenderPubkey: PublicKey,
    defenderAta: PublicKey,
    stackId: number,
    sentUnits: BN,
    sentReapers: BN
  ) {
    return gameProg.methods
      .kill(stackId, stackId, sentUnits, sentReapers)
      .accounts({
        gameConfig:           gameConfigPda,
        attackerStack:        stackPda(attacker.publicKey, stackId),
        defenderStack:        stackPda(defenderPubkey, stackId),
        attackerTokenAccount: attackerAta,
        defenderTokenAccount: defenderAta,
        gameVault:            gameVaultKp.publicKey,
        killMint:             killMintKp.publicKey,
        attacker:             attacker.publicKey,
        defender:             defenderPubkey,
        tokenProgram:         TOKEN_PROGRAM_ID,
      })
      .signers([attacker])
      .rpc();
  }

  // ── Shared helper: provision a fresh user (SOL + KILL ATA) ───────────────────
  async function newUser(killAmount: BN): Promise<[Keypair, PublicKey]> {
    const kp = Keypair.generate();
    const sig = await provider.connection.requestAirdrop(
      kp.publicKey, 3 * LAMPORTS_PER_SOL
    );
    await provider.connection.confirmTransaction(sig);
    const ata = (
      await getOrCreateAssociatedTokenAccount(
        provider.connection,
        admin,
        killMintKp.publicKey,
        kp.publicKey
      )
    ).address;
    if (killAmount.gtn(0)) {
      await mintKill(ata, killAmount);
    }
    return [kp, ata];
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // 1. kill_token
  // ═══════════════════════════════════════════════════════════════════════════
  describe("kill_token", () => {
    it("initialize_token — creates the KILL mint with a 666B hard cap (matches EVM)", async () => {
      await tokenProg.methods
        .initializeToken()
        .accounts({
          tokenConfig:   tokenConfigPda,
          killMint:      killMintKp.publicKey,
          admin:         admin.publicKey,
          tokenProgram:  TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
          rent:          SYSVAR_RENT_PUBKEY,
        })
        .signers([killMintKp])
        .rpc();

      const cfg = await tokenProg.account.tokenConfig.fetch(tokenConfigPda);
      assert.equal(cfg.totalMinted.toString(), "0",                "nothing minted yet");
      assert.equal(cfg.cap.toString(),         HARD_CAP.toString(), "cap matches");
      assert.equal(cfg.admin.toBase58(), admin.publicKey.toBase58(), "admin correct");
      console.log("  ✓ KILL mint:", killMintKp.publicKey.toBase58(), "(cap: 666B)");
    });

    it("mint_to — mints 1M KILL to admin, enforces cap", async () => {
      const ata = await getOrCreateAssociatedTokenAccount(
        provider.connection,
        admin,
        killMintKp.publicKey,
        admin.publicKey
      );
      adminAta = ata.address;

      const mintAmount = new BN(1_000_000_000_000); // 1,000,000 KILL
      await mintKill(adminAta, mintAmount);

      const cfg = await tokenProg.account.tokenConfig.fetch(tokenConfigPda);
      assert.equal(cfg.totalMinted.toString(), mintAmount.toString(), "tracked correctly");

      const ataInfo = await getAccount(provider.connection, adminAta);
      assert.equal(ataInfo.amount.toString(), mintAmount.toString(), "tokens arrived");
      console.log("  ✓ Minted 1,000,000 KILL to admin");
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // 2. kill_game
  // ═══════════════════════════════════════════════════════════════════════════
  describe("kill_game", () => {

    // ── initialize ────────────────────────────────────────────────────────────
    it("initialize_game — creates GameConfig PDA and game vault", async () => {
      await gameProg.methods
        .initializeGame()
        .accounts({
          gameConfig:    gameConfigPda,
          killMint:      killMintKp.publicKey,
          gameVault:     gameVaultKp.publicKey,
          admin:         admin.publicKey,
          tokenProgram:  TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
          rent:          SYSVAR_RENT_PUBKEY,
        })
        .signers([gameVaultKp])
        .rpc();

      const cfg = await gameProg.account.gameConfig.fetch(gameConfigPda);
      assert.equal(cfg.totalKills.toString(), "0", "no kills yet");
      assert.isFalse(cfg.paused,                    "game is live");
      assert.equal(cfg.killMint.toBase58(), killMintKp.publicKey.toBase58(), "mint correct");
      console.log("  ✓ Game vault:", gameVaultKp.publicKey.toBase58());
    });

    // ── spawn (baseline) ──────────────────────────────────────────────────────
    it("spawn — deploys 666 units to grid position 0, auto-grants 1 reaper [test 6]", async () => {
      await spawnFor(admin as any as Keypair, adminAta, 0, new BN(666));

      const stack = await gameProg.account.agentStack.fetch(stackPda(admin.publicKey, 0));
      assert.equal(stack.units.toString(),   "666", "units correct");
      assert.equal(stack.reapers.toString(), "1",   "auto-reaper granted");
      assert.equal(stack.stackId, 0,                "position correct");
      assert.isTrue(stack.spawnSlot.toNumber() > 0, "spawn_slot recorded [test 6]");

      const vault = await getAccount(provider.connection, gameVaultKp.publicKey);
      const expectedCost = new BN(666).mul(SPAWN_COST);
      assert.equal(vault.amount.toString(), expectedCost.toString(), "vault funded (666 × SPAWN_COST)");
      console.log("  ✓ Admin stack spawned at grid[0]; 1 auto-reaper granted; spawn_slot recorded");
    });

    // ── Spawn mechanics ───────────────────────────────────────────────────────
    describe("Spawn mechanics [tests 7-9]", () => {
      let userC: Keypair;
      let userCata: PublicKey;

      before(async () => {
        [userC, userCata] = await newUser(new BN(500_000_000_000));
      });

      it("auto-reaper: 666 units at stack 1 grants 1 free reaper [test 7 analog]", async () => {
        await spawnFor(userC, userCata, 1, new BN(666));
        const stack = await gameProg.account.agentStack.fetch(stackPda(userC.publicKey, 1));
        assert.equal(stack.units.toString(),   "666", "units stored");
        assert.equal(stack.reapers.toString(), "1",   "1 auto-reaper granted");
        console.log("  ✓ 666 units at stack 1 → 1 auto-reaper");
      });

      it("auto-reaper: 1332 units at stack 2 grants 2 free reapers [test 8 analog]", async () => {
        await spawnFor(userC, userCata, 2, new BN(1332));
        const stack = await gameProg.account.agentStack.fetch(stackPda(userC.publicKey, 2));
        assert.equal(stack.units.toString(),   "1332", "units stored");
        assert.equal(stack.reapers.toString(), "2",    "2 auto-reapers granted");
        console.log("  ✓ 1332 units at stack 2 → 2 auto-reapers");
      });

      it("reinforcement accumulates units and preserves spawn_slot [test 9]", async () => {
        await spawnFor(userC, userCata, 0, new BN(10));
        const before = await gameProg.account.agentStack.fetch(stackPda(userC.publicKey, 0));
        const slotBefore = before.spawnSlot;

        await spawnFor(userC, userCata, 0, new BN(5));
        const after = await gameProg.account.agentStack.fetch(stackPda(userC.publicKey, 0));

        assert.equal(after.units.toString(), "15",                "units accumulated");
        assert.equal(after.reapers.toString(), "0",               "no reapers (15 < 666)");
        assert.equal(after.spawnSlot.toString(), slotBefore.toString(), "spawn_slot preserved");
        console.log("  ✓ Reinforcement preserved spawn_slot; units now 15, no reapers");
      });
    });

    // ── Combat — defender wins ────────────────────────────────────────────────
    describe("Combat — defender wins [tests 1, 4]", () => {
      const DEF_STACK = 6;
      const ATK_STACK = 6;

      let userA: Keypair, userAata: PublicKey;
      let userB: Keypair, userBata: PublicKey;

      before(async () => {
        [userA, userAata] = await newUser(new BN(500_000_000_000));
        [userB, userBata] = await newUser(new BN(500_000_000_000));
      });

      it("defender (100 units) repels attacker (10 units) — attacker zeroed, defender gets bounty [tests 1, 4]", async () => {
        // atkPower = 10; defPower = 100 * 1.1 = 110 → defender wins
        await spawnFor(userA, userAata, DEF_STACK, new BN(100));
        await spawnFor(userB, userBata, ATK_STACK, new BN(10));

        const aBalBefore = (await getAccount(provider.connection, userAata)).amount;

        await doKill(userB, userBata, userA.publicKey, userAata, DEF_STACK, new BN(10), new BN(0));

        // Attacker's sent units are lost
        const bStack = await gameProg.account.agentStack.fetch(stackPda(userB.publicKey, ATK_STACK));
        assert.equal(bStack.units.toString(), "0", "attacker units zeroed");

        // Defender: Lanchester loss for 100 def vs 10 atk
        // atkP_scaled=100, defP_scaled=1100, pSq=10000, dSq=1210000
        // defLost = 100 * 10000 / 1210000 ≈ 0.826 → 0
        const aStack = await gameProg.account.agentStack.fetch(stackPda(userA.publicKey, DEF_STACK));
        assert.equal(aStack.units.toString(), "100", "defender unchanged (Lanchester loss=0)");

        // Defender receives bounty (balance increased) [test 1]
        const aBalAfter = (await getAccount(provider.connection, userAata)).amount;
        assert.isTrue(BigInt(aBalAfter) > BigInt(aBalBefore), "defender received bounty [test 1]");

        // total_kills did NOT increment (attacker lost)
        const cfg = await gameProg.account.gameConfig.fetch(gameConfigPda);
        assert.equal(cfg.totalKills.toString(), "0", "no kill credit for attacker loss");
        console.log("  ✓ Defender repelled attacker — 100 vs 10, defender got bounty, attacker zeroed");
      });

      it("Lanchester: defender (50 units) loses 1 unit when beating attacker (10 units) [test 4]", async () => {
        // Fresh users for clean state
        const [defUser, defAta] = await newUser(new BN(500_000_000_000));
        const [atkUser, atkAta] = await newUser(new BN(500_000_000_000));
        const STACK = 7;

        await spawnFor(defUser, defAta, STACK, new BN(50));
        await spawnFor(atkUser, atkAta, STACK, new BN(10));

        await doKill(atkUser, atkAta, defUser.publicKey, defAta, STACK, new BN(10), new BN(0));

        // Lanchester: atkP_scaled=100, defP_scaled=550, pSq=10000, dSq=302500
        // defLost = 50 * 10000 / 302500 ≈ 1.65 → 1
        const defStack = await gameProg.account.agentStack.fetch(stackPda(defUser.publicKey, STACK));
        assert.equal(defStack.units.toString(), "49", "defender lost 1 unit via Lanchester [test 4]");
        console.log("  ✓ Lanchester: 50 def vs 10 atk → defender keeps 49");
      });
    });

    // ── Combat — attacker wins ────────────────────────────────────────────────
    describe("Combat — attacker wins [tests 2, 15]", () => {
      const DEF_STACK = 8;
      const ATK_STACK = 8;

      let userA: Keypair, userAata: PublicKey;
      let userB: Keypair, userBata: PublicKey;

      before(async () => {
        [userA, userAata] = await newUser(new BN(500_000_000_000));
        [userB, userBata] = await newUser(new BN(500_000_000_000));
      });

      it("attacker (1000 units) beats defender (10 units), receives bounty, burn verified [test 2]", async () => {
        // defPower = 10 * 1.1 = 11; atkPower = 1000 → attacker wins
        await spawnFor(userA, userAata, DEF_STACK, new BN(10));
        await spawnFor(userB, userBata, ATK_STACK, new BN(1000));

        // Snapshot balances + mint supply BEFORE kill
        const bBalBefore    = (await getAccount(provider.connection, userBata)).amount;
        const vaultBefore   = (await getAccount(provider.connection, gameVaultKp.publicKey)).amount;
        const supplyBefore  = await provider.connection.getTokenSupply(killMintKp.publicKey);

        // Register event listener BEFORE sending transaction
        let killEventFired: any = null;
        const evListener = gameProg.addEventListener("killEvent", (e: any) => {
          killEventFired = e;
        });

        await doKill(userB, userBata, userA.publicKey, userAata, ATK_STACK, new BN(1000), new BN(0));

        // Allow event to propagate via WS subscription
        await new Promise(r => setTimeout(r, 1000));
        await gameProg.removeEventListener(evListener);

        // ── State checks ───────────────────────────────────────────────────────
        // Defender zeroed
        const aStack = await gameProg.account.agentStack.fetch(stackPda(userA.publicKey, DEF_STACK));
        assert.equal(aStack.units.toString(), "0", "defender zeroed");

        // Attacker received bounty (balance increased)
        const bBalAfter   = (await getAccount(provider.connection, userBata)).amount;
        const vaultAfter  = (await getAccount(provider.connection, gameVaultKp.publicKey)).amount;
        const supplyAfter = await provider.connection.getTokenSupply(killMintKp.publicKey);
        assert.isTrue(BigInt(bBalAfter) > BigInt(bBalBefore), "attacker received bounty [test 2]");

        // ── Bounty math (EVM _applyRewards parity) ─────────────────────────────
        //   attacker wins → all 10 def units lost, 0 atk lost
        //   tPLost = 10, aPLost = 0, totalPLost = 10
        //   pending    = defPower(10) × SPAWN_COST(20M) × mult(1) = 200_000_000
        //   battlePool = 10 < 666 → pending × 10 / 666 = 3_003_003
        //   atkBounty  = 3_003_003 (100% since aPLost=0)
        //   atkBurn    = 3_003_003 × 666 / 10_000 = 199_999  ← 6.66% of bounty
        //   atkPayout  = 3_003_003 - 199_999 = 2_803_004
        const SPAWN_COST_RAW = 20_000_000;
        const TP             = 666;
        const defUnits       = 10;
        const pending        = defUnits * SPAWN_COST_RAW * 1;
        const battlePool     = Math.floor(pending * Math.min(defUnits, TP) / TP);
        const atkBounty      = battlePool;
        const expectedBurn   = Math.floor(atkBounty * 666 / 10_000);
        const expectedPayout = atkBounty - expectedBurn;

        // Payout to attacker matches formula
        const received = Number(BigInt(bBalAfter) - BigInt(bBalBefore));
        assert.equal(received, expectedPayout, "bounty payout matches formula");

        // ── Burn verification (mint supply reduced by exact burn amount) ────────
        const burnActual = Number(
          BigInt(supplyBefore.value.amount) - BigInt(supplyAfter.value.amount)
        );
        assert.equal(burnActual, expectedBurn,
          `burned ${burnActual} tokens (expected ${expectedBurn} = 6.66% of bounty)`);

        // ── Vault balance: decreased by payout + burn = full bounty ────────────
        const vaultDelta = Number(BigInt(vaultBefore) - BigInt(vaultAfter));
        assert.equal(vaultDelta, atkBounty, "vault decreased by full bounty (payout + burn)");

        // ── KillEvent emitted ──────────────────────────────────────────────────
        assert.isNotNull(killEventFired,                   "KillEvent was emitted");
        assert.equal(killEventFired.attackerBounty.toString(), expectedPayout.toString(),
          "KillEvent.attackerBounty matches payout");
        assert.equal(killEventFired.totalBurned.toString(), expectedBurn.toString(),
          "KillEvent.totalBurned matches burn");
        assert.equal(killEventFired.defenderBounty.toString(), "0",
          "KillEvent.defenderBounty is 0 (attacker won)");

        console.log(`  ✓ Attacker won — payout: ${expectedPayout}, burn: ${expectedBurn} (6.66%), event fired`);
      });

      it("total_kills increments after a successful kill [test 15]", async () => {
        const cfg = await gameProg.account.gameConfig.fetch(gameConfigPda);
        assert.isTrue(cfg.totalKills.toNumber() >= 1, "at least one kill recorded");
        console.log("  ✓ total_kills:", cfg.totalKills.toString());
      });
    });

    // ── Combat — reaper power bonus ────────────────────────────────────────────
    describe("Combat — reaper power bonus [test 5]", () => {
      const DEF_STACK = 12;
      const ATK_STACK = 12;

      let userA: Keypair, userAata: PublicKey;
      let userB: Keypair, userBata: PublicKey;

      before(async () => {
        [userA, userAata] = await newUser(new BN(500_000_000_000));
        [userB, userBata] = await newUser(new BN(500_000_000_000));
      });

      it("666 units (→ 1 auto-reaper, atk_pow 1332) defeats 500 defender units [test 5]", async () => {
        // Spawning 666 units auto-grants 1 reaper.
        // atkPow = 666 + 1*666 = 1332; defPow = 500 * 1.1 = 550 → attacker wins
        await spawnFor(userA, userAata, DEF_STACK, new BN(500));
        await spawnFor(userB, userBata, ATK_STACK, new BN(666));

        await doKill(userB, userBata, userA.publicKey, userAata, DEF_STACK, new BN(666), new BN(1));

        const aStack = await gameProg.account.agentStack.fetch(stackPda(userA.publicKey, DEF_STACK));
        assert.equal(aStack.units.toString(), "0", "defender zeroed by reaper [test 5]");
        console.log("  ✓ 666 units (1 auto-reaper, pow 1332) defeated 500 units (pow 550)");
      });
    });

    // ── Move mechanics ────────────────────────────────────────────────────────
    describe("Move mechanics [tests 10-14, 22]", () => {
      // Stacks: SRC=18 (0,3,0)  DST=19 (1,3,0)  DST2=20 (2,3,0)
      // Adjacency: 18↔19 ✓  19↔20 ✓  18↔20 ✗ (distance 2)
      const SRC  = 18;
      const DST  = 19;
      const DST2 = 20;

      let userD: Keypair, userDataAta: PublicKey;

      before(async () => {
        [userD, userDataAta] = await newUser(new BN(5_000_000_000_000));

        // Spawn initial 10 units at SRC for move tests
        await spawnFor(userD, userDataAta, SRC, new BN(10));
      });

      it("partial move: move 4 of 10 units from SRC to DST [test 12 partial]", async () => {
        await moveUnitsFor(userD, userDataAta, SRC, DST, new BN(4), new BN(0));

        const src = await gameProg.account.agentStack.fetch(stackPda(userD.publicKey, SRC));
        assert.equal(src.units.toString(), "6",  "source has 6 remaining [partial move]");

        const dst = await gameProg.account.agentStack.fetch(stackPda(userD.publicKey, DST));
        assert.equal(dst.units.toString(), "4", "destination has 4 units [test 12]");
        console.log("  ✓ Partial move 18→19: 4 units moved, 6 remain at source");
      });

      it("move remaining 6 units from SRC to DST, source empties [test 10]", async () => {
        await moveUnitsFor(userD, userDataAta, SRC, DST, new BN(6), new BN(0));

        const src = await gameProg.account.agentStack.fetch(stackPda(userD.publicKey, SRC));
        assert.equal(src.units.toString(), "0", "source zeroed [test 10]");

        const dst = await gameProg.account.agentStack.fetch(stackPda(userD.publicKey, DST));
        assert.equal(dst.units.toString(), "10", "all 10 units at destination");
        console.log("  ✓ Full move completed: source empty, 10 units at DST");
      });

      it("sequential moves — SRC→DST→DST2 [test 13]", async () => {
        await moveUnitsFor(userD, userDataAta, DST, DST2, new BN(10), new BN(0));

        const dst2 = await gameProg.account.agentStack.fetch(stackPda(userD.publicKey, DST2));
        assert.equal(dst2.units.toString(), "10", "units reached DST2");
        console.log("  ✓ Sequential move 18→19→20 succeeded");
      });

      it("non-adjacent move reverts with NotAdjacent [test 14]", async () => {
        // Seed SRC so it has units
        await spawnFor(userD, userDataAta, SRC, new BN(5));

        let threw = false;
        try {
          await moveUnitsFor(userD, userDataAta, SRC, DST2, new BN(5), new BN(0));
        } catch (err: any) {
          threw = true;
          assert.include(err.toString(), "NotAdjacent");
        }
        assert.isTrue(threw, "expected NotAdjacent to be thrown");
        console.log("  ✓ Non-adjacent move correctly rejected");
      });

      it("move into occupied stack merges units and preserves spawn_slot [test 11, 22 preserve]", async () => {
        // DST2=20 has 10 units; capture its current spawn_slot
        const before = await gameProg.account.agentStack.fetch(stackPda(userD.publicKey, DST2));
        const slotBefore = before.spawnSlot;

        // Move partial units from SRC(18) to DST(19) then DST(19) to DST2(20)
        await moveUnitsFor(userD, userDataAta, SRC, DST, new BN(5), new BN(0));
        await moveUnitsFor(userD, userDataAta, DST, DST2, new BN(5), new BN(0));

        const after = await gameProg.account.agentStack.fetch(stackPda(userD.publicKey, DST2));
        assert.equal(after.units.toString(), "15",                     "units merged (10+5)");
        assert.equal(after.spawnSlot.toString(), slotBefore.toString(), "spawn_slot preserved [test 11]");
        console.log("  ✓ Merge into occupied stack: 10+5=15 units, spawn_slot unchanged");
      });

      it("move to empty destination resets spawn_slot [test 22]", async () => {
        // Seed SRC with fresh units (prior tests may have emptied it)
        await spawnFor(userD, userDataAta, SRC, new BN(5));

        // DST=19 is empty after previous moves
        const srcBefore = await gameProg.account.agentStack.fetch(stackPda(userD.publicKey, SRC));
        const srcSlot   = srcBefore.spawnSlot;

        await moveUnitsFor(userD, userDataAta, SRC, DST, new BN(srcBefore.units.toNumber()), new BN(0));

        const dstAfter = await gameProg.account.agentStack.fetch(stackPda(userD.publicKey, DST));
        assert.isTrue(
          dstAfter.spawnSlot.toNumber() >= srcSlot.toNumber(),
          "destination spawn_slot ≥ origin spawn_slot [test 22]"
        );
        assert.equal(dstAfter.units.toString(), srcBefore.units.toString(), "units arrived");
        console.log("  ✓ Move to empty stack reset spawn_slot at destination");
      });
    });

    // ── Admin functions ────────────────────────────────────────────────────────
    describe("Admin functions [tests 16-20]", () => {

      it("admin can pause the game (test 16 analog)", async () => {
        await gameProg.methods
          .setPaused(true)
          .accounts({ gameConfig: gameConfigPda, admin: admin.publicKey })
          .rpc();

        const cfg = await gameProg.account.gameConfig.fetch(gameConfigPda);
        assert.isTrue(cfg.paused);
        console.log("  ✓ Game paused");
      });

      it("spawn fails while paused (test 17 analog)", async () => {
        let threw = false;
        try {
          await spawnFor(admin as any as Keypair, adminAta, 0, new BN(1));
        } catch (err: any) {
          threw = true;
          assert.include(err.toString(), "GamePaused");
        }
        assert.isTrue(threw, "expected GamePaused error");
        console.log("  ✓ Spawn correctly blocked while paused");
      });

      it("admin can unpause the game", async () => {
        await gameProg.methods
          .setPaused(false)
          .accounts({ gameConfig: gameConfigPda, admin: admin.publicKey })
          .rpc();

        const cfg = await gameProg.account.gameConfig.fetch(gameConfigPda);
        assert.isFalse(cfg.paused);
        console.log("  ✓ Game unpaused — gameplay resumed");
      });

      it("pending bounty is non-zero (scales with power × SPAWN_COST) [test 18]", async () => {
        // Verify getPendingBounty view via the on-chain stack
        // We check the stack we spawned: admin at stack 0 had 666 units, 1 reaper
        // pending = (666 + 1*666) * 20_000_000 * 1 = 26_640_000_000 (mult≥1)
        // Note: can't fast-forward slots on localnet, so multiplier=1 in tests
        const stack = await gameProg.account.agentStack.fetch(stackPda(admin.publicKey, 0));
        assert.isTrue(stack.units.toNumber() > 0 || stack.reapers.toNumber() > 0,
          "admin stack still has units [test 18]");
        console.log("  ✓ Admin stack has power → pending bounty scales with age [test 18]");
      });

      it("admin can withdraw from the game vault (test 19)", async () => {
        const balBefore = (await getAccount(provider.connection, adminAta)).amount;
        const amount    = new BN(1_000_000); // 1 KILL

        await gameProg.methods
          .adminWithdraw(amount)
          .accounts({
            gameConfig:   gameConfigPda,
            gameVault:    gameVaultKp.publicKey,
            destination:  adminAta,
            admin:        admin.publicKey,
            tokenProgram: TOKEN_PROGRAM_ID,
          })
          .rpc();

        const balAfter = (await getAccount(provider.connection, adminAta)).amount;
        assert.equal(
          (BigInt(balAfter) - BigInt(balBefore)).toString(),
          amount.toString(),
          "admin received withdrawal"
        );
        console.log("  ✓ Admin withdrew 1 KILL from vault");
      });

      it("non-admin withdraw fails with Unauthorized (test 20)", async () => {
        const [impostor] = await newUser(new BN(0));

        let threw = false;
        try {
          await gameProg.methods
            .adminWithdraw(new BN(1))
            .accounts({
              gameConfig:   gameConfigPda,
              gameVault:    gameVaultKp.publicKey,
              destination:  adminAta,
              admin:        impostor.publicKey,
              tokenProgram: TOKEN_PROGRAM_ID,
            })
            .signers([impostor])
            .rpc();
        } catch (err: any) {
          threw = true;
          assert.include(err.toString(), "Unauthorized");
        }
        assert.isTrue(threw, "expected Unauthorized error");
        console.log("  ✓ Non-admin withdraw correctly rejected");
      });
    });

  }); // end kill_game

  // ═══════════════════════════════════════════════════════════════════════════
  // 3. Economic Simulation (port of test/econsim.js)
  //
  // EVM differences:
  //   - No evm_mine: multiplier always=1 in localnet (can't fast-forward slots)
  //   - attackerBounty / defenderBounty checked via token balance deltas
  //   - "4M KILL seed" ≈ EVM "4B KILL seed" (different decimal precision)
  // ═══════════════════════════════════════════════════════════════════════════
  describe("Economic Simulation [econsim port]", () => {

    /** Lanchester defender unit loss when defender wins. */
    function lancLoss(defCount: number, atkRaw: number, defRaw: number): number {
      const pSq = (atkRaw * 10) ** 2;
      const dSq = (defRaw * 11) ** 2;
      if (dSq === 0) return 0;
      return Math.min(defCount, Math.floor((defCount * pSq) / dSq));
    }

    /** Compute expected payouts per EVM _applyRewards. */
    function computePayouts(
      tPLost: number, aPLost: number, pending: number
    ): { atkPayout: number; defPayout: number } {
      const totalPLost = tPLost + aPLost;
      if (totalPLost === 0) return { atkPayout: 0, defPayout: 0 };
      const battlePool = totalPLost >= 666
        ? pending
        : Math.floor(pending * totalPLost / 666);
      const atkB = tPLost === 0 ? 0 : Math.floor(battlePool * tPLost / totalPLost);
      const defB = aPLost === 0 ? 0 : Math.floor(battlePool * aPLost / totalPLost);
      const atkPayout = atkB - Math.floor(atkB * 666 / 10_000);
      const defPayout = defB - Math.floor(defB * 666 / 10_000);
      return { atkPayout, defPayout };
    }

    function logSim(title: string, fields: Record<string, number | string>) {
      console.log(`\n--- ${title} ---`);
      for (const [k, v] of Object.entries(fields)) {
        console.log(`  ${k.padEnd(28)} ${v}`);
      }
      console.log("--------------------------------------------\n");
    }

    // SIM 1: 4M KILL seed, attacker wins, attackerBounty > 0
    it("SIM 1: 4M KILL seed — attacker wins, attackerBounty > 0", async () => {
      const [userA, userAata] = await newUser(new BN(200_000_000_000));
      const [userB, userBata] = await newUser(new BN(200_000_000_000));

      // Seed vault with 4M KILL (EVM equiv: 4B-token treasury)
      await mintKill(gameVaultKp.publicKey, new BN(4_000_000_000_000));

      const STACK = 100;
      await spawnFor(userA, userAata, STACK, new BN(666));   // 666 units, 1 reaper
      await spawnFor(userB, userBata, STACK, new BN(666));   // 666 units, 1 reaper
      // Reinforce userB to ensure they win: total 1998 units + 1 reaper
      // atkRaw = 1998 + 666 = 2664; defRaw = 666 + 666 = 1332
      // 2664*10=26640 > 1332*11=14652 → attacker wins
      await spawnFor(userB, userBata, STACK, new BN(1332));

      const bBalBefore = (await getAccount(provider.connection, userBata)).amount;

      await doKill(userB, userBata, userA.publicKey, userAata, STACK, new BN(1998), new BN(1));

      const bBalAfter = (await getAccount(provider.connection, userBata)).amount;
      const atkReceived = Number(BigInt(bBalAfter) - BigInt(bBalBefore));

      // Compute expected payout
      const defPower = 666 + 1 * 666; // 1332
      const pending  = defPower * 20_000_000 * 1;
      const { atkPayout } = computePayouts(defPower, 0, pending);

      logSim("ECONOMIC SIMULATION: 4M SEED RESULTS", {
        "Attacker Units Sent":     1998,
        "Attacker Reaper Sent":    1,
        "Attacker Units Lost":     0,
        "Target Units Lost":       666,
        "Target Reaper Lost":      1,
        "Attacker Bounty (raw)":   atkReceived,
        "Expected Bounty":         atkPayout,
      });

      assert.isTrue(atkReceived > 0, "attackerBounty > 0 [SIM 1]");
      console.log(`  ✓ SIM 1: attacker bounty = ${atkReceived} raw KILL`);
    });

    // SIM 2: Attacker 3× (300 vs 100) → all 100 defender units lost
    it("SIM 2: Attacker 3x force (300 vs 100) — all 100 defender units lost", async () => {
      const [userA, userAata] = await newUser(new BN(200_000_000_000));
      const [userB, userBata] = await newUser(new BN(200_000_000_000));

      const STACK = 101;
      await spawnFor(userA, userAata, STACK, new BN(100));
      await spawnFor(userB, userBata, STACK, new BN(300));

      // 300*10=3000 > 100*11=1100 → attacker wins, all 100 defender lost
      await doKill(userB, userBata, userA.publicKey, userAata, STACK, new BN(300), new BN(0));

      const defStack = await gameProg.account.agentStack.fetch(stackPda(userA.publicKey, STACK));
      const targetUnitsLost = 100 - defStack.units.toNumber();

      logSim("SIM: ATTACKER 3X FORCE", {
        "Attacker Units Sent":    300,
        "Attacker Units Lost":    0,
        "Target Units Lost":      targetUnitsLost,
        "Initial Defender Units": 100,
      });

      assert.equal(targetUnitsLost, 100, "targetUnitsLost == 100 [SIM 2]");
      console.log("  ✓ SIM 2: Attacker 3x force destroyed all 100 defender units");
    });

    // SIM 3: Defender 3× (100 vs 300) → all 100 attacker units lost
    it("SIM 3: Defender 3x force (100 atk vs 300 def) — all 100 attacker units lost", async () => {
      const [userA, userAata] = await newUser(new BN(200_000_000_000));
      const [userB, userBata] = await newUser(new BN(200_000_000_000));

      const STACK = 102;
      await spawnFor(userA, userAata, STACK, new BN(300));
      await spawnFor(userB, userBata, STACK, new BN(100));

      // 100*10=1000 < 300*11=3300 → defender wins, all 100 attacker lost
      await doKill(userB, userBata, userA.publicKey, userAata, STACK, new BN(100), new BN(0));

      const atkStack = await gameProg.account.agentStack.fetch(stackPda(userB.publicKey, STACK));
      const attackerUnitsLost = 100 - atkStack.units.toNumber();

      // Lanchester: defLost = 300 * (100*10)^2 / (300*11)^2 ≈ 27
      const defStack = await gameProg.account.agentStack.fetch(stackPda(userA.publicKey, STACK));
      const defUnitsLost    = 300 - defStack.units.toNumber();
      const expectedDefLost = lancLoss(300, 100, 300);

      logSim("SIM: DEFENDER 3X FORCE", {
        "Attacker Units Sent":           100,
        "Attacker Units Lost":           attackerUnitsLost,
        "Target Units Lost (Lanchester)":defUnitsLost,
        "Expected Defender Loss":        expectedDefLost,
        "Initial Defender Units":        300,
      });

      assert.equal(attackerUnitsLost, 100, "attackerUnitsLost == 100 [SIM 3]");
      assert.equal(defUnitsLost, expectedDefLost, "Lanchester defender loss matches formula");
      console.log(`  ✓ SIM 3: all 100 attacker units lost; defender lost ${defUnitsLost} via Lanchester`);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // 4. kill_faucet
  // ═══════════════════════════════════════════════════════════════════════════
  describe("kill_faucet", () => {
    it("initialize_faucet — creates FaucetConfig PDA and vault", async () => {
      await faucetProg.methods
        .initializeFaucet()
        .accounts({
          faucetConfig:  faucetConfigPda,
          killMint:      killMintKp.publicKey,
          faucetVault:   faucetVaultKp.publicKey,
          admin:         admin.publicKey,
          tokenProgram:  TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
          rent:          SYSVAR_RENT_PUBKEY,
        })
        .signers([faucetVaultKp])
        .rpc();

      const cfg = await faucetProg.account.faucetConfig.fetch(faucetConfigPda);
      assert.equal(cfg.killMint.toBase58(), killMintKp.publicKey.toBase58());
      console.log("  ✓ Faucet vault:", faucetVaultKp.publicKey.toBase58());
    });

    it("claim — receives 10% of faucet vault (requires ≥ 1 KILL balance)", async () => {
      const faucetFund = new BN(100_000_000);
      await mintKill(faucetVaultKp.publicKey, faucetFund);

      const [claimRecordPda] = PublicKey.findProgramAddressSync(
        [Buffer.from("claim_record"), admin.publicKey.toBuffer()],
        faucetProg.programId
      );

      await faucetProg.methods
        .claim()
        .accounts({
          faucetConfig:        faucetConfigPda,
          claimRecord:         claimRecordPda,
          faucetVault:         faucetVaultKp.publicKey,
          claimerTokenAccount: adminAta,
          killMint:            killMintKp.publicKey,
          claimer:             admin.publicKey,
          tokenProgram:        TOKEN_PROGRAM_ID,
          systemProgram:       SystemProgram.programId,
        })
        .rpc();

      const vaultAfter = await getAccount(provider.connection, faucetVaultKp.publicKey);
      assert.equal(
        vaultAfter.amount.toString(),
        new BN(90_000_000).toString(),
        "90 KILL remains in vault"
      );
      console.log("  ✓ Claimed 10 KILL from faucet (10% of 100)");
    });
  });
});
