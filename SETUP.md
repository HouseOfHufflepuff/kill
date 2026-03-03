# kill
A DeFi Strategy Game for Agentic AI

## EVM (Hardhat / Base)

```shell
# local dev
hardhat node
hardhat compile
hardhat test --network hardhat
REPORT_GAS=true hardhat test --network hardhat

# deploy & interact
hardhat run scripts/deploy.js --network basesepolia
hardhat run scripts/mint.js --network basesepolia
hardhat run scripts/burn.js --network basesepolia
```

### verify
```shell
npx hardhat verify --network base 0xC6850977170174141f09B7C5A2f188986a4f4c41

npx hardhat verify --network basesepolia --constructor-args scripts/verify/meh-faucet-v1-args.js 0xEf4C3545edf08563bbC112D5CEf0A10B396Ea12E

npx hardhat verify --network base --constructor-args scripts/verify/meh-store-v1-args.js 0xFD6aF32884C7E79Fd26b4D1e8017D5D79B9266D9
```

---

## Solana (Anchor)

### Prerequisites

```shell
# 1. Install Rust via rustup (https://rustup.rs)
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh

# The workspace pins Rust 1.89.0 via rust-toolchain.toml — rustup picks it up automatically.

# 2. Install the Solana CLI (Agave) — v3.x
sh -c "$(curl -sSfL https://release.anza.xyz/stable/install)"
# Restart shell or run:
export PATH="$HOME/.local/share/solana/install/active_release/bin:$PATH"

# 3. Install Anchor Version Manager then Anchor 0.32.1
cargo install --git https://github.com/coral-xyz/anchor avm --locked --force
avm install 0.32.1
avm use 0.32.1
```

### Wallet setup

```shell
# Generate a local keypair (skip if you already have ~/.config/solana/id.json)
solana-keygen new

# Point CLI at devnet
solana config set --url devnet

# Confirm active config
solana config get

# Airdrop SOL for rent/fees (devnet only)
solana airdrop 2
```

### Build & deploy

```shell
cd contracts-solana

# Install JS/TS deps
yarn install

# Build all three programs (kill_token, kill_game, kill_faucet)
anchor build

# After the first build, grab the auto-generated program IDs and
# update declare_id!() in each program's lib.rs if they differ:
anchor keys list

# Run the local test validator + tests
anchor test

# Deploy to devnet (wallet = ~/.config/solana/id.json, cluster = devnet)
anchor deploy --provider.cluster devnet

# Deploy a single program
anchor deploy --program-name kill_token --provider.cluster devnet
anchor deploy --program-name kill_game  --provider.cluster devnet
anchor deploy --program-name kill_faucet --provider.cluster devnet
```

### Deployed program IDs (devnet)

| Program | Address |
|---|---|
| kill_token | `3bcxaPX7ka8DgtJckaoJHVjaXqncBsa8EfGT2AfYaYSY` |
| kill_game | `2FbeFxvFH2b4KyAcwNToFr3pHzYK4ybYQWriXjjKEr5D` |
| kill_faucet | `761RUKWGgStRshdz3HJcS7dPodFSckDAcudLtU1CZ1b6` |

---

## GraphQL indexer

```shell
cd kill-testnet-subgraph/1.0.1
npm init -y
npm install @graphprotocol/graph-ts
npm install -g @graphprotocol/graph-cli

graph codegen
graph build

goldsky login
goldsky subgraph deploy kill-testnet-subgraph/1.0.1 --path ./build
```
