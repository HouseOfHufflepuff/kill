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
 *   - move_units() moves ALL units from a stack (no partial moves)
 *   - Bounty = power × SPAWN_COST × clamp(1 + age_slots/13224, 1, 50),
 *     scaled by min(defPower, THERMAL_PARITY) / THERMAL_PARITY (EVM battlePool parity),
 *     capped at 25% of vault (minimum multiplier of 1 applies in tests)
 *   - total_kills counts kill *events*, not total units destroyed
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
  // Reapers are granted automatically (1 per 666 units) — no explicit reaper param.
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
      // 666 units → 1 free reaper (666 / 666 = 1); cost = 666 × 20 KILL
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
        // 666 / 666 = 1 reaper automatically; no explicit reaper param
        await spawnFor(userC, userCata, 1, new BN(666));
        const stack = await gameProg.account.agentStack.fetch(stackPda(userC.publicKey, 1));
        assert.equal(stack.units.toString(),   "666", "units stored");
        assert.equal(stack.reapers.toString(), "1",   "1 auto-reaper granted");
        console.log("  ✓ 666 units at stack 1 → 1 auto-reaper");
      });

      it("auto-reaper: 1332 units at stack 2 grants 2 free reapers [test 8 analog]", async () => {
        // 1332 / 666 = 2 reapers automatically
        await spawnFor(userC, userCata, 2, new BN(1332));
        const stack = await gameProg.account.agentStack.fetch(stackPda(userC.publicKey, 2));
        assert.equal(stack.units.toString(),   "1332", "units stored");
        assert.equal(stack.reapers.toString(), "2",    "2 auto-reapers granted");
        console.log("  ✓ 1332 units at stack 2 → 2 auto-reapers");
      });

      it("reinforcement accumulates units and preserves spawn_slot [test 9]", async () => {
        // First spawn at stack 0 (10 units < 666 → 0 reapers)
        await spawnFor(userC, userCata, 0, new BN(10));
        const before = await gameProg.account.agentStack.fetch(stackPda(userC.publicKey, 0));
        const slotBefore = before.spawnSlot;

        // Reinforce same stack — spawn_slot must NOT reset
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
      // userA and userB both occupy stack 6 (same grid position)
      const DEF_STACK = 6;
      const ATK_STACK = 6;

      let userA: Keypair, userAata: PublicKey;
      let userB: Keypair, userBata: PublicKey;

      before(async () => {
        [userA, userAata] = await newUser(new BN(500_000_000_000));
        [userB, userBata] = await newUser(new BN(500_000_000_000));
      });

      it("defender (100 units) repels attacker (10 units) — attacker zeroed, defender unchanged [tests 1, 4]", async () => {
        // defender_power = 100 × 11 = 1100; attacker_power = 10 → attacker loses
        await spawnFor(userA, userAata, DEF_STACK, new BN(100));
        await spawnFor(userB, userBata, ATK_STACK, new BN(10));

        await gameProg.methods
          .kill(ATK_STACK, DEF_STACK, new BN(10), new BN(0))
          .accounts({
            gameConfig:           gameConfigPda,
            attackerStack:        stackPda(userB.publicKey, ATK_STACK),
            defenderStack:        stackPda(userA.publicKey, DEF_STACK),
            attackerTokenAccount: userBata,
            gameVault:            gameVaultKp.publicKey,
            killMint:             killMintKp.publicKey,
            attacker:             userB.publicKey,
            defender:             userA.publicKey,
            tokenProgram:         TOKEN_PROGRAM_ID,
          })
          .signers([userB])
          .rpc();

        // Attacker's sent units are lost (defender won)
        const bStack = await gameProg.account.agentStack.fetch(stackPda(userB.publicKey, ATK_STACK));
        assert.equal(bStack.units.toString(),   "0", "attacker units zeroed");
        assert.equal(bStack.reapers.toString(), "0", "attacker reapers zeroed");

        // Defender stack untouched (attacker wipe-out does not reduce defender)
        const aStack = await gameProg.account.agentStack.fetch(stackPda(userA.publicKey, DEF_STACK));
        assert.equal(aStack.units.toString(), "100", "defender unchanged");

        // total_kills did NOT increment (attacker lost)
        const cfg = await gameProg.account.gameConfig.fetch(gameConfigPda);
        assert.equal(cfg.totalKills.toString(), "0", "no kill credit for attacker loss");
        console.log("  ✓ Defender repelled attacker — 100 vs 10, attacker zeroed");
      });
    });

    // ── Combat — attacker wins ────────────────────────────────────────────────
    describe("Combat — attacker wins [tests 2, 15]", () => {
      // userA and userB both occupy stack 8 (same grid position)
      const DEF_STACK = 8;
      const ATK_STACK = 8;

      let userA: Keypair, userAata: PublicKey;
      let userB: Keypair, userBata: PublicKey;

      before(async () => {
        [userA, userAata] = await newUser(new BN(500_000_000_000));
        [userB, userBata] = await newUser(new BN(500_000_000_000));
      });

      it("attacker (1000 units) beats defender (10 units), receives bounty, defender zeroed [test 2]", async () => {
        // defender_power = 10 × 11 = 110; attacker_power = 1000 → attacker wins
        await spawnFor(userA, userAata, DEF_STACK, new BN(10));
        await spawnFor(userB, userBata, ATK_STACK, new BN(1000));

        const bBalBefore = (await getAccount(provider.connection, userBata)).amount;

        await gameProg.methods
          .kill(ATK_STACK, DEF_STACK, new BN(1000), new BN(0))
          .accounts({
            gameConfig:           gameConfigPda,
            attackerStack:        stackPda(userB.publicKey, ATK_STACK),
            defenderStack:        stackPda(userA.publicKey, DEF_STACK),
            attackerTokenAccount: userBata,
            gameVault:            gameVaultKp.publicKey,
            killMint:             killMintKp.publicKey,
            attacker:             userB.publicKey,
            defender:             userA.publicKey,
            tokenProgram:         TOKEN_PROGRAM_ID,
          })
          .signers([userB])
          .rpc();

        // Defender zeroed
        const aStack = await gameProg.account.agentStack.fetch(stackPda(userA.publicKey, DEF_STACK));
        assert.equal(aStack.units.toString(), "0", "defender zeroed");

        // Attacker received bounty (balance increased)
        const bBalAfter = (await getAccount(provider.connection, userBata)).amount;
        assert.isTrue(BigInt(bBalAfter) > BigInt(bBalBefore), "attacker received bounty [test 2]");

        // Verify bounty math (EVM parity):
        //   pending    = defPower × SPAWN_COST × mult = 10 × 20_000_000 × 1 = 200_000_000
        //   battlePool = defPower < THERMAL_PARITY(666) → pending × 10 / 666 = 3_003_003
        //   burn       = 3_003_003 × 666 / 10_000 = 199_999
        //   payout     = 3_003_003 - 199_999 = 2_803_004
        const SPAWN_COST_RAW  = 20_000_000;
        const THERMAL_PARITY  = 666;
        const defUnits        = 10;
        const defPower        = defUnits; // + 0 reapers
        const pending         = defUnits * SPAWN_COST_RAW * 1; // mult=1 (freshly spawned)
        const battlePool      = Math.floor(pending * Math.min(defPower, THERMAL_PARITY) / THERMAL_PARITY);
        const expectedBurn    = Math.floor(battlePool * 666 / 10_000);
        const expectedPayout  = battlePool - expectedBurn;
        const received = Number(BigInt(bBalAfter) - BigInt(bBalBefore));
        assert.equal(received, expectedPayout, "bounty payout matches formula");

        console.log("  ✓ Attacker won — bounty:", expectedPayout, "KILL lamports");
      });

      it("total_kills increments after a successful kill [test 15]", async () => {
        const cfg = await gameProg.account.gameConfig.fetch(gameConfigPda);
        assert.isTrue(cfg.totalKills.toNumber() >= 1, "at least one kill recorded");
        console.log("  ✓ total_kills:", cfg.totalKills.toString());
      });
    });

    // ── Combat — reaper power bonus ────────────────────────────────────────────
    describe("Combat — reaper power bonus [test 5]", () => {
      // userA and userB both occupy stack 12 (same grid position)
      const DEF_STACK = 12;
      const ATK_STACK = 12;

      let userA: Keypair, userAata: PublicKey;
      let userB: Keypair, userBata: PublicKey;

      before(async () => {
        [userA, userAata] = await newUser(new BN(500_000_000_000));
        [userB, userBata] = await newUser(new BN(500_000_000_000));
      });

      it("666 units (→ 1 auto-reaper, atk_pow 1332) defeats 50 defender units (def_pow 550) [test 5]", async () => {
        // Spawning 666 units auto-grants 1 reaper.
        // def_pow = (50 + 0) × 11 = 550; atk_pow = 666 + 1 × 666 = 1332 → attacker wins
        await spawnFor(userA, userAata, DEF_STACK, new BN(50));
        await spawnFor(userB, userBata, ATK_STACK, new BN(666));

        await gameProg.methods
          .kill(ATK_STACK, DEF_STACK, new BN(666), new BN(1))
          .accounts({
            gameConfig:           gameConfigPda,
            attackerStack:        stackPda(userB.publicKey, ATK_STACK),
            defenderStack:        stackPda(userA.publicKey, DEF_STACK),
            attackerTokenAccount: userBata,
            gameVault:            gameVaultKp.publicKey,
            killMint:             killMintKp.publicKey,
            attacker:             userB.publicKey,
            defender:             userA.publicKey,
            tokenProgram:         TOKEN_PROGRAM_ID,
          })
          .signers([userB])
          .rpc();

        const aStack = await gameProg.account.agentStack.fetch(stackPda(userA.publicKey, DEF_STACK));
        assert.equal(aStack.units.toString(), "0", "defender zeroed by reaper");
        console.log("  ✓ 666 units (1 auto-reaper, atk_pow 1332) defeated 50 units (def_pow 550)");
      });
    });

    // ── Move mechanics ────────────────────────────────────────────────────────
    describe("Move mechanics [tests 10-14]", () => {
      // Stacks: SRC=18 (0,3,0)  DST=19 (1,3,0)  DST2=20 (2,3,0)
      // Adjacency: 18↔19 ✓  19↔20 ✓  18↔20 ✗ (distance 2)
      const SRC  = 18;
      const DST  = 19;
      const DST2 = 20;

      let userD: Keypair, userDataAta: PublicKey;

      before(async () => {
        [userD, userDataAta] = await newUser(new BN(5_000_000_000_000));

        // Spawn initial units at SRC for move tests
        await spawnFor(userD, userDataAta, SRC, new BN(10));
      });

      it("move empties source stack and populates destination [test 10, 12]", async () => {
        await gameProg.methods
          .moveUnits(SRC, DST)
          .accounts({
            gameConfig:        gameConfigPda,
            fromStack:         stackPda(userD.publicKey, SRC),
            toStack:           stackPda(userD.publicKey, DST),
            agentTokenAccount: userDataAta,
            gameVault:         gameVaultKp.publicKey,
            killMint:          killMintKp.publicKey,
            agent:             userD.publicKey,
            tokenProgram:      TOKEN_PROGRAM_ID,
            systemProgram:     SystemProgram.programId,
          })
          .signers([userD])
          .rpc();

        const src = await gameProg.account.agentStack.fetch(stackPda(userD.publicKey, SRC));
        assert.equal(src.units.toString(), "0",  "source zeroed [test 10]");

        const dst = await gameProg.account.agentStack.fetch(stackPda(userD.publicKey, DST));
        assert.equal(dst.units.toString(), "10", "units at destination [test 12]");
        console.log("  ✓ Move 18→19: source zeroed, destination has 10 units");
      });

      it("sequential moves — SRC→DST→DST2 [test 13]", async () => {
        await gameProg.methods
          .moveUnits(DST, DST2)
          .accounts({
            gameConfig:        gameConfigPda,
            fromStack:         stackPda(userD.publicKey, DST),
            toStack:           stackPda(userD.publicKey, DST2),
            agentTokenAccount: userDataAta,
            gameVault:         gameVaultKp.publicKey,
            killMint:          killMintKp.publicKey,
            agent:             userD.publicKey,
            tokenProgram:      TOKEN_PROGRAM_ID,
            systemProgram:     SystemProgram.programId,
          })
          .signers([userD])
          .rpc();

        const dst2 = await gameProg.account.agentStack.fetch(stackPda(userD.publicKey, DST2));
        assert.equal(dst2.units.toString(), "10", "units reached DST2");
        console.log("  ✓ Sequential move 18→19→20 succeeded");
      });

      it("non-adjacent move reverts with NotAdjacent [test 14]", async () => {
        // Seed SRC so it has units to move (cannot move from empty)
        await spawnFor(userD, userDataAta, SRC, new BN(5));

        let threw = false;
        try {
          // SRC=18 → DST2=20: distance = 2, must revert
          await gameProg.methods
            .moveUnits(SRC, DST2)
            .accounts({
              gameConfig:        gameConfigPda,
              fromStack:         stackPda(userD.publicKey, SRC),
              toStack:           stackPda(userD.publicKey, DST2),
              agentTokenAccount: userDataAta,
              gameVault:         gameVaultKp.publicKey,
              killMint:          killMintKp.publicKey,
              agent:             userD.publicKey,
              tokenProgram:      TOKEN_PROGRAM_ID,
              systemProgram:     SystemProgram.programId,
            })
            .signers([userD])
            .rpc();
        } catch (err: any) {
          threw = true;
          assert.include(err.toString(), "NotAdjacent");
        }
        assert.isTrue(threw, "expected NotAdjacent to be thrown");
        console.log("  ✓ Non-adjacent move correctly rejected");
      });

      it("move into occupied stack merges units and preserves spawn_slot [test 11, 22]", async () => {
        // DST2=20 has 10 units; capture its current spawn_slot
        const before = await gameProg.account.agentStack.fetch(stackPda(userD.publicKey, DST2));
        const slotBefore = before.spawnSlot;

        // Spawn at DST=19 (currently empty after previous moves)
        await spawnFor(userD, userDataAta, DST, new BN(5));

        // Move DST(19) → DST2(20): destination not empty → spawn_slot preserved
        await gameProg.methods
          .moveUnits(DST, DST2)
          .accounts({
            gameConfig:        gameConfigPda,
            fromStack:         stackPda(userD.publicKey, DST),
            toStack:           stackPda(userD.publicKey, DST2),
            agentTokenAccount: userDataAta,
            gameVault:         gameVaultKp.publicKey,
            killMint:          killMintKp.publicKey,
            agent:             userD.publicKey,
            tokenProgram:      TOKEN_PROGRAM_ID,
            systemProgram:     SystemProgram.programId,
          })
          .signers([userD])
          .rpc();

        const after = await gameProg.account.agentStack.fetch(stackPda(userD.publicKey, DST2));
        assert.equal(after.units.toString(), "15",                    "units merged (10+5)");
        assert.equal(after.spawnSlot.toString(), slotBefore.toString(), "spawn_slot preserved [test 11]");
        console.log("  ✓ Merge into occupied stack: 10+5=15 units, spawn_slot unchanged");
      });

      it("move to empty destination resets spawn_slot [test 22]", async () => {
        // SRC=18 has 5 units (from non-adjacent test); DST=19 is empty
        const srcBefore = await gameProg.account.agentStack.fetch(stackPda(userD.publicKey, SRC));
        const srcSlot = srcBefore.spawnSlot;

        await gameProg.methods
          .moveUnits(SRC, DST)
          .accounts({
            gameConfig:        gameConfigPda,
            fromStack:         stackPda(userD.publicKey, SRC),
            toStack:           stackPda(userD.publicKey, DST),
            agentTokenAccount: userDataAta,
            gameVault:         gameVaultKp.publicKey,
            killMint:          killMintKp.publicKey,
            agent:             userD.publicKey,
            tokenProgram:      TOKEN_PROGRAM_ID,
            systemProgram:     SystemProgram.programId,
          })
          .signers([userD])
          .rpc();

        const dstAfter = await gameProg.account.agentStack.fetch(stackPda(userD.publicKey, DST));
        // Destination was empty → spawn_slot set to current slot (fresh timer)
        assert.isTrue(
          dstAfter.spawnSlot.toNumber() >= srcSlot.toNumber(),
          "destination spawn_slot ≥ origin spawn_slot [test 22]"
        );
        assert.equal(dstAfter.units.toString(), "5", "units arrived");
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
  // 3. kill_faucet
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
      // Seed faucet vault with 100 KILL
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

      // 10% claimed → 90 KILL remains
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
