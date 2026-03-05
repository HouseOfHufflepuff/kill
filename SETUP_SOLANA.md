# KILL Game — Solana Setup Guide

Three Anchor programs ported from the EVM contracts, deployed on devnet.

---

## Deployed Addresses (Devnet)

| Program | Address |
|---|---|
| kill_game | `2FbeFxvFH2b4KyAcwNToFr3pHzYK4ybYQWriXjjKEr5D` |
| kill_token | `3bcxaPX7ka8DgtJckaoJHVjaXqncBsa8EfGT2AfYaYSY` |
| kill_faucet | `761RUKWGgStRshdz3HJcS7dPodFSckDAcudLtU1CZ1b6` |

Explorer: https://explorer.solana.com/?cluster=devnet

---

## Prerequisites

Install in this order:

```bash
# 1. Rust
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
source ~/.cargo/env

# 2. Solana CLI
sh -c "$(curl -sSfL https://release.solana.com/stable/install)"

# 3. Anchor CLI (via AVM — Anchor Version Manager)
cargo install --git https://github.com/coral-xyz/anchor avm --locked
avm install latest
avm use latest
```

Verify:

```bash
rustc --version
solana --version
anchor --version
```

---

## Wallet Setup

Solana uses a keypair file (64-byte JSON array) instead of a hex private key.

```bash
# Generate a new keypair (or skip if you already have one)
solana-keygen new --outfile ~/.config/solana/id.json

# Check your public address
solana address

# Set the CLI to use devnet
solana config set --url devnet

# Fund with devnet SOL (airdrop)
solana airdrop 2
# Or use the script: node scripts-solana/airdrop.js 2
```

Your keypair path is stored in `.env`:

```
SOLANA_KEYPAIR_PATH=~/.config/solana/id.json
SOLANA_RPC_URL=https://api.devnet.solana.com
```

To view your private key bytes (e.g. to back up):

```bash
cat ~/.config/solana/id.json
```

---

## Project Structure

```
contracts-solana/
  Anchor.toml                  ← network, wallet, program IDs
  Cargo.toml                   ← Rust workspace
  programs/
    kill_token/src/            ← SPL mint with PDA-controlled authority
    kill_game/src/             ← Game logic (spawn, move, kill)
    kill_faucet/src/           ← Token faucet (claim once per wallet)
  target/
    idl/                       ← Generated ABIs (kill_game.json, etc.)
    deploy/                    ← Compiled .so binaries
  tests/
    kill.ts                    ← Full integration test suite

scripts-solana/                ← Interaction scripts (plain node, no hardhat)
  common.js                    ← Shared connection, wallet, programs, PDAs
  config.json                  ← Program IDs and constants
  balance.js
  airdrop.js
  spawn.js
  move.js
  kill.js
  stacks.js
```

---

## Compile

From inside `contracts-solana/`:

```bash
cd contracts-solana
anchor build
```

This produces:
- `target/deploy/*.so` — compiled BPF binaries
- `target/idl/*.json` — IDL files (equivalent to ABI in EVM)
- `target/types/*.ts` — TypeScript types for the IDL

After changing program IDs (e.g. after a fresh deploy), regenerate the keypair IDs with:

```bash
anchor keys list
# Then update Anchor.toml and the declare_id!() in each programs/*/src/lib.rs
anchor build   # rebuild with the updated IDs
```

---

## Test

Tests run against a local validator (spun up and torn down automatically):

```bash
cd contracts-solana
anchor test
```

The test suite (`tests/kill.ts`) covers:
- `kill_token` — mint initialization, `mint_to`, hard cap enforcement
- `kill_game` — `initialize_game`, `spawn`, `move_units`, `kill` (combat), admin ops
- `kill_faucet` — `initialize_faucet`, `claim`, double-claim rejection

Key differences from the EVM tests:
- Reapers are explicit spawn params (no auto-bonus threshold)
- `kill()` requires stacks to be Manhattan-adjacent (distance = 1)
- `move_units()` moves ALL units — no partial moves
- Bounty = `units × 666 × clamp(age_in_slots / 32400, 1, 20)`

---

## Deploy to Devnet

```bash
cd contracts-solana

# Make sure your CLI wallet is funded
solana balance

# Deploy all three programs
anchor deploy --provider.cluster devnet

# Note the program IDs printed — update Anchor.toml if they differ
```

Deploy order matters if programs reference each other:

1. `kill_token` first (the mint must exist before `kill_game` can hold it)
2. `kill_faucet`
3. `kill_game`

After deploy, run `initialize_game` (admin only, once):

```bash
node scripts-solana/init.js
```

---

## Scripts

All scripts run from the project root with plain `node`. No hardhat, no framework.

```bash
node scripts-solana/<script>.js [args]
```

| Script | Command | What it does |
|---|---|---|
| `balance.js` | `node scripts-solana/balance.js` | SOL + KILL balance, GameConfig state |
| `airdrop.js` | `node scripts-solana/airdrop.js [sol]` | Devnet SOL airdrop (default: 2 SOL) |
| `spawn.js` | `node scripts-solana/spawn.js <stack_id> <units>` | Spawn/reinforce a stack (costs 20 KILL) |
| `move.js` | `node scripts-solana/move.js <from> <to>` | Move stack to adjacent position (costs 100 KILL) |
| `kill.js` | `node scripts-solana/kill.js <atk_stack> <defender_pubkey> <def_stack>` | Attack an enemy stack |
| `stacks.js` | `node scripts-solana/stacks.js [pubkey]` | List all stacks with grid coordinates |

### Examples

```bash
# Check your balance
node scripts-solana/balance.js

# Get devnet SOL
node scripts-solana/airdrop.js 2

# Spawn 666 units at stack 0
node scripts-solana/spawn.js 0 666

# Spawn 1000 units + 5 reapers at hub stack 22
node scripts-solana/spawn.js 22 1000 5

# Move from stack 0 to adjacent stack 1
node scripts-solana/move.js 0 1

# Attack another player's stack
node scripts-solana/kill.js 1 <defender_wallet_pubkey> 2

# See all your stacks
node scripts-solana/stacks.js
```

---

## Ethereum vs Solana Quick Reference

| Concept | Ethereum (this repo) | Solana (this repo) |
|---|---|---|
| Run scripts | `hardhat run scripts/foo.js --network basesepolia` | `node scripts-solana/foo.js` |
| ABI | `agents/KillGame.json` | `contracts-solana/target/idl/kill_game.json` |
| Provider | `ethers.provider` | `new Connection(rpcUrl)` |
| Wallet | `new ethers.Wallet(PRIVATE_KEY)` | `Keypair.fromSecretKey(bytes)` |
| Contract | `new ethers.Contract(addr, abi, signer)` | `new Program(idl, provider)` |
| Token decimals | 18 | 6 |
| Gas currency | ETH | SOL |
| Private key format | 32-byte hex string in `.env` | 64-byte JSON array at `~/.config/solana/id.json` |
| Testnet | Base Sepolia | Solana Devnet |

---

## Constants (on-chain, `kill_game`)

| Constant | Value | Notes |
|---|---|---|
| SPAWN_COST | 20 KILL | Per spawn call |
| MOVE_COST | 100 KILL | Per move call |
| BURN_BPS | 666 (6.66%) | Burned from bounty on kill |
| THERMAL_PARITY | 666 | Base bounty per unit |
| SLOTS_PER_MULTIPLIER | 32,400 | ~3.6 hours per bounty multiplier step |
| MAX_MULTIPLIER | 20× | Bounty cap |
| Grid | 6 × 6 × 6 | 216 total stacks (IDs 0–215) |
| KILL decimals | 6 | `1 KILL = 1_000_000` raw units |
