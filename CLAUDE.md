# CLAUDE.md — KILL Game

## What This Is

KILL is a deflationary on-chain strategy game deployed on **Solana** (primary) and **EVM/Base** (reference). Players spawn units on a 6x6x6 grid (216 stacks), move them between adjacent positions, and attack enemy stacks to earn bounties. The game is designed for **agentic AI** — bots compete for maturity-based yields with asymmetric combat and MEV-style extraction.

## Quick Start

```bash
# Base / EVM (Hardhat)
npm install
npx hardhat compile
npx hardhat test --network hardhat

# Solana (Anchor) — requires Rust 1.89+, Solana CLI v3, Anchor 0.32.1
cd contracts/solana
anchor build
anchor test                    # runs local validator + 29 integration tests

# Agent desktop app
cd agents/sol/desktop
npm install && npm start
```

## Project Layout

```
contracts/
  base/                        # Solidity (EVM reference implementation)
    KillGame.sol               # Core game: spawn, move, kill, bounties
    KillToken.sol              # ERC20Capped (666B supply, 18 decimals)
    KillFaucet.sol             # ERC20 faucet
    tests/                     # Hardhat/Mocha test suite
      killgame.js              # Core game tests (27 tests)
      killtoken.js             # Token tests
      multicall.js             # Batching tests
      econsim.js               # Economic simulation
  solana/                      # Anchor programs (Solana primary)
    programs/kill_game/        # Game logic (spawn, move, kill, admin)
    programs/kill_token/       # SPL mint wrapper (6 decimals)
    programs/kill_faucet/      # One-time devnet claim (1000 KILL)
    tests/kill.ts              # All tests — single file (shared PDAs)
agents/sol/                    # AI agent framework
  agent.js                     # Orchestrator / runner
  common.js                    # Shared: PDA derivation, power calc, RPC
  config.json                  # Network, program IDs, strategy params
  playbook.json                # Multi-run strategy sequencing
  fortress/                    # Territorial defender strategy
  sniper/                      # Opportunistic bounty liquidator
  seed/                        # Passive accumulator
  nuke/                        # Focused assault
  aftershock/                  # AOE consolidator
  desktop/                     # Electron GUI for agent deployment
viewer/                        # Web UIs (Solana, Base, Lightning)
kill-indexer/                  # Helius webhook -> Supabase pipeline
scripts/solana/                # CLI tools: spawn, move, kill, balance
```

## Tokenomics

| Constant | Value | Notes |
|----------|-------|-------|
| Hard cap | 666,000,000,000 KILL | 6 decimals (Solana), 18 decimals (EVM) |
| Spawn cost | 20 KILL/unit | Burns 6.66%, rest to vault |
| Move cost | 100 KILL/call | Manhattan distance = 1 only |
| Reaper grant | 1 per 666 units spawned | Auto-granted on spawn |
| Burn rate (BURN_BPS) | 666 bps (6.66%) | Applied to all bounty payouts |
| Thermal parity | 666 | Reaper power multiplier |

## Combat Rules

**Power**: `raw = units + (reapers * 666)`. Defender gets 10% bonus.

**Win condition**: `atk_raw * 10 > def_raw * 11` (attacker wins)

**Casualties**:
- Attacker wins: defender loses everything, attacker keeps ALL forces (0 losses)
- Defender wins: attacker loses all sent forces; defender takes Lanchester partial loss:
  `defLost = defCount * (atkRaw*10)^2 / (defRaw*11)^2`

**Bounty** (bidirectional — both sides can earn):
```
tPLost = defUnitsLost + defReapersLost * 666
aPLost = atkUnitsLost + atkReapersLost * 666
totalPLost = tPLost + aPLost
battlePool = totalPLost >= 666 ? pending : pending * totalPLost / 666
atkBounty = battlePool * tPLost / totalPLost
defBounty = battlePool * aPLost / totalPLost
payout = bounty - bounty * 666 / 10000   (6.66% burned)
```

**Bounty maturity** (age-based multiplier):
- EVM: `mult = min(1 + blocks/1080, 20)` — max 20x
- Solana: `mult = min(1 + slots/13224, 50)` — max 50x

**Power decay** (Solana only): older stacks fight weaker.
`decay_pct = max(5, 100 - (mult-1) * 95/49)` — fresh=100%, max-aged=5%.
This creates tension: high bounty but low combat effectiveness.

**Global cap**: bounty capped at 25% of vault (GLOBAL_CAP_BPS = 2500).

## EVM vs Solana Differences

| Aspect | EVM | Solana |
|--------|-----|--------|
| Stack IDs | 1-216 (1-indexed) | 0-215 (0-indexed) |
| Decimals | 18 | 6 |
| Max multiplier | 20x | 50x |
| Slots per mult | 1,080 blocks | 13,224 slots |
| Power decay | No | Yes (5%-100%) |
| Treasury fee | 0.3% (treasuryBps) | None |
| Multicall | Contract-level | Client-side tx batching |
| total_kills | All units killed | Kill events (attacker wins) |

## Testing Notes

- All Solana tests live in `contracts/solana/tests/kill.ts` (single file) because all three programs share singleton PDAs (token_config, game_config). Separate files would conflict on initialization.
- Can't fast-forward Solana localnet slots like `evm_mine`, so multiplier=1 in tests.
- `resolve_combat` returns: `(won, rem_atk_u, rem_atk_r, atk_u_lost, atk_r_lost, def_u_lost, def_r_lost)`

## Agent Architecture

Each agent has a `capability.js` with strategy logic. `common.js` provides shared utils (PDA derivation, power calculations, slot polling via `onSlot`). `playbook.json` sequences strategy runs. `config.json` holds network/program IDs and per-strategy params (hub stack, force targets, profitability thresholds).

Key agent strategies:
- **Fortress**: holds a hub with overwhelming force, clears perimeter, replenishes before decay
- **Sniper**: scans for profitable kills, spawns + kills atomically, ROI threshold gated
- **Seed**: batch-spawns on random stacks to age for bounty maturity
- **Nuke**: targeted overwhelming assault on specific stacks
- **Aftershock**: multi-kill AOE sequences

## Common Commands

```bash
# Base / EVM (from project root)
npx hardhat compile                                      # compile contracts/base/*.sol
npx hardhat test --network hardhat                       # run contracts/base/tests/
REPORT_GAS=true npx hardhat test --network hardhat
npx hardhat run scripts/base/deploy.js --network basesepolia

# Solana (from contracts/solana/)
cd contracts/solana
anchor build                                             # compile all 3 programs
anchor test                                              # local validator + tests

# Solana scripts (from project root)
node scripts/solana/balance.js
node scripts/solana/spawn.js <stack> <units>
node scripts/solana/kill.js <atk_stack> <defender_pk> <def_stack>
node scripts/solana/stacks.js [pubkey]
```
