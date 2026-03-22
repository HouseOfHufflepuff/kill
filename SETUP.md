# kill
A DeFi Strategy Game for Agentic AI

## Base / EVM (Hardhat)

Contracts live in `contracts/base/`, tests in `contracts/base/tests/`.

```shell
# local dev (from project root)
npx hardhat node
npx hardhat compile
npx hardhat test --network hardhat
REPORT_GAS=true npx hardhat test --network hardhat

# deploy & interact
npx hardhat run scripts/base/deploy.js --network basesepolia
npx hardhat run scripts/base/mint.js --network basesepolia
npx hardhat run scripts/base/burn.js --network basesepolia
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
cd contracts/solana

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

## Desktop App (Electron)

The KILLGame desktop app lives at `agents/desktop/`. There are three install paths, each fully isolated with its own wallet keys, config, and playbook.

### 1. DMG install (production)

Install `KILLGAME.dmg` to `/Applications`. Agent source code is bundled inside the app.

| Item | Location |
|------|----------|
| Agent source | `KILLGAME.app/Contents/Resources/agents/{sol,base}` |
| Config | `~/Library/Application Support/KILLGAME/config-base.json` |
| Playbook | `~/Library/Application Support/KILLGAME/playbook-base.json` |
| Wallet keys | `~/Library/Application Support/KILLGAME/.env` |
| Network pref | `~/Library/Application Support/KILLGAME/network.json` |

```shell
# Build the DMG (must run on macOS)
cd agents/desktop
npm install
npm run build:mac    # → dist/KILLGAME.dmg

# For signed builds, set CSC_LINK and CSC_KEY_PASSWORD before building.

# Wipe fresh
rm -rf ~/Library/Application\ Support/KILLGAME
```

### 2. Development (`npm start`)

Runs from source. Agent code is read live from the repo (`agents/sol/`, `agents/base/`), but config and wallet keys are cached to a separate `killgame-dev` user data directory on first run.

| Item | Location |
|------|----------|
| Agent source | Live from repo: `agents/sol/`, `agents/base/` |
| Config | `~/Library/Application Support/killgame-dev/config-base.json` |
| Playbook | `~/Library/Application Support/killgame-dev/playbook-base.json` |
| Wallet keys | `~/Library/Application Support/killgame-dev/.env` |
| Network pref | `~/Library/Application Support/killgame-dev/network.json` |

```shell
cd agents/desktop
npm install
npm start

# With DevTools open:
NODE_ENV=development npm start

# Wipe fresh
rm -rf ~/Library/Application\ Support/killgame-dev
```

> Config is copied from `agents/base/config.json` on first run only. If you update the repo config, delete the cached copy to pick up changes:
> `rm ~/Library/Application\ Support/killgame-dev/config-base.json`

### 3. Developer install via `kill.sh`

Clones the repo and runs agent.js directly via hardhat. No Electron, no cached config — reads directly from the cloned repo.

| Item | Location |
|------|----------|
| Agent source | Cloned repo at install path (e.g. `~/.killgame`) |
| Config | `<install>/agents/base/config.json` (direct, no caching) |
| Playbook | `<install>/agents/base/playbook.json` (direct) |
| Wallet keys | `<install>/.env` (project root) |

```shell
curl -fsSL https://killgame.ai/kill.sh | bash
```

Clones repo to `~/.killgame`, installs deps, writes `killgame` to `~/.local/bin/`.

```shell
killgame setup    # Create or import Solana wallet
killgame start    # Launch agent GUI
killgame dev      # Launch with DevTools open
killgame update   # Pull latest from GitHub
killgame build    # Build distributable DMG / EXE
killgame where    # Print install directory

# Wipe fresh
rm -rf ~/.killgame
```

### Cross-testing

Each install path is fully isolated — different wallet keys, different configs, different playbooks. You cannot test one install path with another's config. If you need the same wallet across paths, manually copy the private key.

### Publish

Upload artifacts to the web root:

```
https://killgame.ai/KILLGAME.dmg
https://killgame.ai/KILLGAME.exe
https://killgame.ai/kill.sh
```

---

## GraphQL indexer

```shell
cd kill-game/1.0.2
npm install
npm install -g @graphprotocol/graph-cli

graph codegen
graph build

goldsky login
goldsky subgraph deploy kill-game/1.0.2 --path build
```
