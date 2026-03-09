#!/bin/bash
# KILLGame Solana Agent Installer v1.0.0

BASE_URL="https://raw.githubusercontent.com/HouseOfHufflepuff/kill/main"
AGENTS="sniper fortress aftershock seed nuke"

# 1. Scaffold directories
echo "[1/5] Scaffolding directories..."
for ROLE in $AGENTS; do
  mkdir -p "agents/$ROLE"
done
mkdir -p "contracts-solana/target/idl"

# 2. Pull agent files from GitHub
echo "[2/5] Fetching agent files from GitHub..."
for ROLE in $AGENTS; do
  curl -f -s "$BASE_URL/agents-sol/$ROLE/capability.js" -o "agents/$ROLE/capability.js" || echo "  WARN: agents-sol/$ROLE/capability.js not on main yet"
  curl -f -s "$BASE_URL/agents-sol/$ROLE/config.json"   -o "agents/$ROLE/config.json"   || echo "  WARN: agents-sol/$ROLE/config.json not on main yet"
done
curl -f -s "$BASE_URL/agents-sol/agent.js"      -o "agents/agent.js"      || echo "  WARN: agent.js"
curl -f -s "$BASE_URL/agents-sol/common.js"     -o "agents/common.js"     || echo "  WARN: common.js"
curl -f -s "$BASE_URL/agents-sol/playbook.json" -o "agents/playbook.json" || echo "  WARN: playbook.json"
curl -f -s "$BASE_URL/agents-sol/config.json"   -o "agents/config.json"   || echo "  WARN: config.json"
curl -f -s "$BASE_URL/agents-sol/KillGame.json" -o "agents/KillGame.json" || echo "  WARN: KillGame.json"
cat <<'IDLEOF' > contracts-solana/target/idl/kill_game.json
{
  "address": "2FbeFxvFH2b4KyAcwNToFr3pHzYK4ybYQWriXjjKEr5D",
  "metadata": {
    "name": "kill_game",
    "version": "0.1.0",
    "spec": "0.1.0",
    "description": "KILL Game — Solana/Anchor port of KillGame.sol"
  },
  "instructions": [
    {
      "name": "admin_withdraw",
      "docs": ["Admin: emergency withdrawal from the game vault."],
      "discriminator": [160,166,147,222,46,220,75,224],
      "accounts": [
        {"name":"game_config","pda":{"seeds":[{"kind":"const","value":[103,97,109,101,95,99,111,110,102,105,103]}]}},
        {"name":"game_vault","docs":["Game vault (source)"],"writable":true},
        {"name":"destination","docs":["Admin's (or any other) destination token account"],"writable":true},
        {"name":"admin","signer":true},
        {"name":"token_program","address":"TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"}
      ],
      "args": [{"name":"amount","type":"u64"}]
    },
    {
      "name": "initialize_game",
      "docs": ["One-time setup: creates the GameConfig PDA and game vault.","Must be called by the deploying admin before any gameplay."],
      "discriminator": [44,62,102,247,126,208,130,215],
      "accounts": [
        {"name":"game_config","docs":["Singleton config — created here for the first and only time.","Seeds: [b\"game_config\"]"],"writable":true,"pda":{"seeds":[{"kind":"const","value":[103,97,109,101,95,99,111,110,102,105,103]}]}},
        {"name":"kill_mint","docs":["The KILL SPL mint (must already exist — deploy KillToken first)."]},
        {"name":"game_vault","docs":["The game vault.  A new token account whose authority is `game_config`.","All spawn/move costs flow into this account; bounties flow out of it."],"writable":true,"signer":true},
        {"name":"admin","docs":["Payer and future admin of the game."],"writable":true,"signer":true},
        {"name":"token_program","address":"TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"},
        {"name":"system_program","address":"11111111111111111111111111111111"},
        {"name":"rent","address":"SysvarRent111111111111111111111111111111111"}
      ],
      "args": []
    },
    {
      "name": "kill",
      "docs": ["Attack an adjacent enemy stack.","If the attacker wins, bounty is paid out and a portion burned.","If the attacker loses, their stack is cleared with no reward."],
      "discriminator": [46,229,132,89,87,194,20,217],
      "accounts": [
        {"name":"game_config","writable":true,"pda":{"seeds":[{"kind":"const","value":[103,97,109,101,95,99,111,110,102,105,103]}]}},
        {"name":"attacker_stack","docs":["Attacker's stack — must be owned by the signer and non-empty."],"writable":true,"pda":{"seeds":[{"kind":"const","value":[97,103,101,110,116,95,115,116,97,99,107]},{"kind":"account","path":"attacker"},{"kind":"arg","path":"attacker_stack_id"}]}},
        {"name":"defender_stack","docs":["Defender's stack — must be non-empty and owned by a different agent."],"writable":true,"pda":{"seeds":[{"kind":"const","value":[97,103,101,110,116,95,115,116,97,99,107]},{"kind":"account","path":"defender"},{"kind":"arg","path":"defender_stack_id"}]}},
        {"name":"attacker_token_account","docs":["Attacker's KILL token account — receives the net bounty payout if attacker wins."],"writable":true},
        {"name":"defender_token_account","docs":["Defender's KILL token account — receives the net bounty payout if defender wins."],"writable":true},
        {"name":"game_vault","docs":["Game vault — source for bounty payouts and the burn."],"writable":true},
        {"name":"kill_mint","docs":["KILL mint — needed by the token program's Burn CPI."],"writable":true},
        {"name":"attacker","writable":true,"signer":true},
        {"name":"defender","docs":["not written to.  The stack's agent field is validated by the seeds."]},
        {"name":"token_program","address":"TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"}
      ],
      "args": [
        {"name":"attacker_stack_id","type":"u16"},
        {"name":"defender_stack_id","type":"u16"},
        {"name":"sent_units","type":"u64"},
        {"name":"sent_reapers","type":"u64"}
      ]
    },
    {
      "name": "move_units",
      "docs": ["Move a specified number of units/reapers from one adjacent grid position to another.","Partial moves are supported (EVM parity).  Costs MOVE_COST KILL tokens → vault."],
      "discriminator": [73,208,25,242,174,26,226,155],
      "accounts": [
        {"name":"game_config","pda":{"seeds":[{"kind":"const","value":[103,97,109,101,95,99,111,110,102,105,103]}]}},
        {"name":"from_stack","docs":["Source stack — must be owned by the signer and non-empty."],"writable":true,"pda":{"seeds":[{"kind":"const","value":[97,103,101,110,116,95,115,116,97,99,107]},{"kind":"account","path":"agent"},{"kind":"arg","path":"from_stack_id"}]}},
        {"name":"to_stack","docs":["Destination stack — created if it does not yet exist for this agent at this position."],"writable":true,"pda":{"seeds":[{"kind":"const","value":[97,103,101,110,116,95,115,116,97,99,107]},{"kind":"account","path":"agent"},{"kind":"arg","path":"to_stack_id"}]}},
        {"name":"agent_token_account","docs":["Agent's KILL token account — move cost is debited from here."],"writable":true},
        {"name":"game_vault","docs":["Game vault — receives the move cost."],"writable":true},
        {"name":"kill_mint"},
        {"name":"agent","writable":true,"signer":true},
        {"name":"token_program","address":"TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"},
        {"name":"system_program","address":"11111111111111111111111111111111"}
      ],
      "args": [
        {"name":"from_stack_id","type":"u16"},
        {"name":"to_stack_id","type":"u16"},
        {"name":"units","type":"u64"},
        {"name":"reapers","type":"u64"}
      ]
    },
    {
      "name": "set_paused",
      "docs": ["Admin: pause or unpause all gameplay instructions."],
      "discriminator": [91,60,125,192,176,225,166,218],
      "accounts": [
        {"name":"game_config","writable":true,"pda":{"seeds":[{"kind":"const","value":[103,97,109,101,95,99,111,110,102,105,103]}]}},
        {"name":"admin","signer":true}
      ],
      "args": [{"name":"paused","type":"bool"}]
    },
    {
      "name": "spawn",
      "docs": ["Spawn or reinforce a stack at a grid position (0–215).","Costs SPAWN_COST KILL tokens per unit → vault.","One free Reaper is granted per 666 units spawned."],
      "discriminator": [17,105,240,101,4,95,45,171],
      "accounts": [
        {"name":"game_config","docs":["Game config — validates the game is not paused and provides vault address."],"pda":{"seeds":[{"kind":"const","value":[103,97,109,101,95,99,111,110,102,105,103]}]}},
        {"name":"agent_stack","docs":["The agent's stack at this position.  Created on first spawn; updated on reinforcement.","Seeds: [b\"agent_stack\", agent.key(), stack_id as [u8;2] little-endian]"],"writable":true,"pda":{"seeds":[{"kind":"const","value":[97,103,101,110,116,95,115,116,97,99,107]},{"kind":"account","path":"agent"},{"kind":"arg","path":"stack_id"}]}},
        {"name":"agent_token_account","docs":["Agent's KILL token account — spawn cost is debited from here."],"writable":true},
        {"name":"game_vault","docs":["Game vault — receives the spawn cost."],"writable":true},
        {"name":"kill_mint"},
        {"name":"agent","writable":true,"signer":true},
        {"name":"token_program","address":"TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"},
        {"name":"system_program","address":"11111111111111111111111111111111"}
      ],
      "args": [
        {"name":"stack_id","type":"u16"},
        {"name":"units","type":"u64"}
      ]
    }
  ],
  "accounts": [
    {"name":"AgentStack","discriminator":[89,104,56,175,19,37,100,211]},
    {"name":"GameConfig","discriminator":[45,146,146,33,170,69,96,133]}
  ],
  "events": [
    {"name":"KillEvent","discriminator":[89,236,104,94,142,191,62,138]},
    {"name":"StackMoved","discriminator":[78,213,63,208,104,231,129,219]},
    {"name":"StackSpawned","discriminator":[27,133,103,92,20,214,249,63]}
  ],
  "errors": [
    {"code":6000,"name":"NotAdjacent","msg":"Stack is not adjacent to target (Manhattan distance must be 1)"},
    {"code":6001,"name":"NotSameStack","msg":"Attacker and defender must be on the same stack"},
    {"code":6002,"name":"EmptyAttacker","msg":"Attacker stack is empty — deploy units first"},
    {"code":6003,"name":"EmptyDefender","msg":"Defender stack is empty — nothing to kill"},
    {"code":6004,"name":"SelfAttack","msg":"Cannot attack your own stack"},
    {"code":6005,"name":"InvalidStackId","msg":"Invalid stack ID — must be 0 to 215"},
    {"code":6006,"name":"GamePaused","msg":"Game is paused"},
    {"code":6007,"name":"Overflow","msg":"Arithmetic overflow"},
    {"code":6008,"name":"InsufficientBalance","msg":"Insufficient KILL token balance"},
    {"code":6009,"name":"Unauthorized","msg":"Unauthorized — admin only"}
  ],
  "types": [
    {
      "name": "AgentStack",
      "docs": ["Per-agent, per-position stack — PDA seeds: [b\"agent_stack\", agent.key(), stack_id as [u8;2] LE]","","stack_id encodes a position in a 6x6x6 grid:","x = stack_id % 6","y = (stack_id / 6) % 6","z = stack_id / 36","Valid range: 0-215.","","Each agent can own one stack per grid cell (up to 216 stacks per agent).","Stacks with units == 0 && reapers == 0 are considered empty/defeated."],
      "type": {
        "kind": "struct",
        "fields": [
          {"name":"agent","docs":["Owner wallet"],"type":"pubkey"},
          {"name":"stack_id","docs":["Grid index (0-215)"],"type":"u16"},
          {"name":"units","docs":["Number of unit tokens deployed at this position"],"type":"u64"},
          {"name":"reapers","docs":["Number of reaper tokens deployed at this position"],"type":"u64"},
          {"name":"spawn_slot","docs":["Slot when this stack was first spawned (used for bounty multiplier)"],"type":"u64"},
          {"name":"kill_slot","docs":["Slot of the last successful kill (for UI / analytics)"],"type":"u64"},
          {"name":"bump","docs":["Canonical bump stored for cheap PDA re-derivation"],"type":"u8"}
        ]
      }
    },
    {
      "name": "GameConfig",
      "docs": ["Singleton game configuration — PDA seeds: [b\"game_config\"]","","There is exactly one of these per deployment. It holds the mint address,","the vault token account, and global counters. The PDA itself acts as the","authority over the game vault so the program can sign transfers/burns","without a traditional private key."],
      "type": {
        "kind": "struct",
        "fields": [
          {"name":"kill_mint","docs":["SPL mint for the KILL token"],"type":"pubkey"},
          {"name":"game_vault","docs":["Game vault token account (PDA authority = this account)"],"type":"pubkey"},
          {"name":"admin","docs":["Protocol admin wallet (can pause and emergency-withdraw)"],"type":"pubkey"},
          {"name":"total_kills","docs":["Lifetime kill count across all agents"],"type":"u64"},
          {"name":"paused","docs":["If true, spawn/move/kill instructions are rejected"],"type":"bool"},
          {"name":"bump","docs":["Canonical bump used to re-derive this PDA cheaply"],"type":"u8"}
        ]
      }
    },
    {
      "name": "KillEvent",
      "type": {
        "kind": "struct",
        "fields": [
          {"name":"attacker","type":"pubkey"},
          {"name":"defender","type":"pubkey"},
          {"name":"attacker_stack","type":"u16"},
          {"name":"defender_stack","type":"u16"},
          {"name":"attacker_bounty","docs":["Payout to the attacker (after burn deduction)"],"type":"u64"},
          {"name":"defender_bounty","docs":["Payout to the defender (after burn deduction; non-zero when attacker loses)"],"type":"u64"},
          {"name":"total_burned","docs":["Total amount burned from vault across both bounties"],"type":"u64"},
          {"name":"remaining_units","docs":["Attacker units remaining after combat"],"type":"u64"},
          {"name":"remaining_reapers","docs":["Attacker reapers remaining after combat"],"type":"u64"},
          {"name":"slot","type":"u64"},
          {"name":"attacker_units_sent","docs":["Units attacker committed to this attack"],"type":"u64"},
          {"name":"attacker_reapers_sent","docs":["Reapers attacker committed to this attack"],"type":"u64"},
          {"name":"attacker_units_lost","docs":["Attacker units lost in combat"],"type":"u64"},
          {"name":"attacker_reapers_lost","docs":["Attacker reapers lost in combat"],"type":"u64"},
          {"name":"defender_units","docs":["Defender units before combat (snapshot)"],"type":"u64"},
          {"name":"defender_reapers","docs":["Defender reapers before combat (snapshot)"],"type":"u64"},
          {"name":"defender_units_lost","docs":["Defender units lost in combat (Lanchester partial loss when defender wins)"],"type":"u64"},
          {"name":"defender_reapers_lost","docs":["Defender reapers lost in combat"],"type":"u64"}
        ]
      }
    },
    {
      "name": "StackMoved",
      "type": {
        "kind": "struct",
        "fields": [
          {"name":"agent","type":"pubkey"},
          {"name":"from_stack","type":"u16"},
          {"name":"to_stack","type":"u16"},
          {"name":"units","type":"u64"},
          {"name":"reapers","type":"u64"},
          {"name":"slot","type":"u64"}
        ]
      }
    },
    {
      "name": "StackSpawned",
      "type": {
        "kind": "struct",
        "fields": [
          {"name":"agent","type":"pubkey"},
          {"name":"stack_id","type":"u16"},
          {"name":"units","type":"u64"},
          {"name":"reapers","type":"u64"},
          {"name":"slot","type":"u64"}
        ]
      }
    }
  ]
}
IDLEOF
cat <<'IDLEOF' > contracts-solana/target/idl/kill_faucet.json
{
  "address": "761RUKWGgStRshdz3HJcS7dPodFSckDAcudLtU1CZ1b6",
  "metadata": {
    "name": "kill_faucet",
    "version": "0.1.0",
    "spec": "0.1.0",
    "description": "KILL Faucet — Solana/Anchor port of KillFaucet.sol"
  },
  "instructions": [
    {
      "name": "claim",
      "docs": ["Claim 10% of the current faucet vault balance.","Callable once per wallet."],
      "discriminator": [62,198,214,193,213,159,108,210],
      "accounts": [
        {"name":"faucet_config","docs":["Faucet config — provides vault address and signs vault transfers."],"pda":{"seeds":[{"kind":"const","value":[102,97,117,99,101,116,95,99,111,110,102,105,103]}]}},
        {"name":"claim_record","docs":["Claim record — `init` fails if this account already exists, which is","how we enforce the one-claim-per-wallet rule with zero extra code.","Seeds: [b\"claim_record\", claimer.key()]"],"writable":true,"pda":{"seeds":[{"kind":"const","value":[99,108,97,105,109,95,114,101,99,111,114,100]},{"kind":"account","path":"claimer"}]}},
        {"name":"faucet_vault","docs":["Faucet vault — source of the claim transfer."],"writable":true},
        {"name":"claimer_token_account","docs":["Claimer's KILL token account — receives the faucet payout."],"writable":true},
        {"name":"kill_mint"},
        {"name":"claimer","writable":true,"signer":true},
        {"name":"token_program","address":"TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"},
        {"name":"system_program","address":"11111111111111111111111111111111"}
      ],
      "args": []
    },
    {
      "name": "initialize_faucet",
      "docs": ["One-time setup: creates the FaucetConfig PDA and vault token account.","After calling this, transfer KILL tokens to the vault to fund the faucet."],
      "discriminator": [159,109,237,214,69,231,14,60],
      "accounts": [
        {"name":"faucet_config","docs":["Singleton config PDA — seeds: [b\"faucet_config\"]"],"writable":true,"pda":{"seeds":[{"kind":"const","value":[102,97,117,99,101,116,95,99,111,110,102,105,103]}]}},
        {"name":"kill_mint","docs":["The KILL SPL mint (deploy KillToken first and pass its address here)."]},
        {"name":"faucet_vault","docs":["Faucet vault — a new token account whose authority is `faucet_config`.","Top up this account to fund the faucet."],"writable":true,"signer":true},
        {"name":"admin","writable":true,"signer":true},
        {"name":"token_program","address":"TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"},
        {"name":"system_program","address":"11111111111111111111111111111111"},
        {"name":"rent","address":"SysvarRent111111111111111111111111111111111"}
      ],
      "args": []
    }
  ],
  "accounts": [
    {"name":"ClaimRecord","discriminator":[57,229,0,9,65,62,96,7]},
    {"name":"FaucetConfig","discriminator":[216,31,49,154,106,125,143,142]}
  ],
  "errors": [
    {"code":6000,"name":"AlreadyClaimed","msg":"You have already claimed from the faucet"},
    {"code":6001,"name":"FaucetEmpty","msg":"Faucet vault is empty"},
    {"code":6002,"name":"Unauthorized","msg":"Unauthorized — admin only"}
  ],
  "types": [
    {
      "name": "ClaimRecord",
      "docs": ["One-per-wallet claim record — PDA seeds: [b\"claim_record\", claimer.key()]","","The mere existence of this account proves a wallet has already claimed.","Because `init` is used (not `init_if_needed`), a second claim attempt will","fail with \"account already in use\" before our instruction logic even runs."],
      "type": {
        "kind": "struct",
        "fields": [
          {"name":"claimer","docs":["Wallet that claimed"],"type":"pubkey"},
          {"name":"slot","docs":["Slot at which the claim occurred"],"type":"u64"},
          {"name":"bump","docs":["Canonical bump"],"type":"u8"}
        ]
      }
    },
    {
      "name": "FaucetConfig",
      "docs": ["Singleton faucet configuration — PDA seeds: [b\"faucet_config\"]","","Holds the mint address and the vault token account.  The PDA itself is the","vault authority so the program can sign transfers without a private key."],
      "type": {
        "kind": "struct",
        "fields": [
          {"name":"kill_mint","docs":["SPL mint for the KILL token"],"type":"pubkey"},
          {"name":"faucet_vault","docs":["Faucet vault token account (PDA authority = this account)"],"type":"pubkey"},
          {"name":"admin","docs":["Admin wallet (can top-up or reclaim vault funds)"],"type":"pubkey"},
          {"name":"bump","docs":["Canonical bump for cheap PDA re-derivation"],"type":"u8"}
        ]
      }
    }
  ]
}
IDLEOF

# 3. Write package.json
echo "[3/5] Writing package.json..."
cat <<'EOT' > package.json
{
  "name": "killsol",
  "version": "1.0.0",
  "bin": { "killsol": "./cli.js" },
  "dependencies": {
    "dotenv": "^16.4.5",
    "@coral-xyz/anchor": "^0.30.1",
    "@solana/web3.js": "^1.98.0",
    "@solana/spl-token": "^0.4.9"
  }
}
EOT

# 4. Write cli.js
echo "[4/5] Writing CLI..."
cat <<'CLIEOF' > cli.js
#!/usr/bin/env node
"use strict";
const fs        = require("fs");
const path      = require("path");
const { spawn } = require("child_process");
const readline  = require("readline");
const ROOT      = __dirname;
require("dotenv").config({ path: path.join(ROOT, ".env") });

const cmd = process.argv[2];

// ── Helpers ───────────────────────────────────────────────────────────────────
function saveKey(keyArray) {
  const envPath  = path.join(ROOT, ".env");
  const existing = fs.existsSync(envPath) ? fs.readFileSync(envPath, "utf8") : "";
  const lines    = existing.split("\n").filter(l => !l.startsWith("AGENT_PK=") && l.trim() !== "");
  lines.push(`AGENT_PK=${JSON.stringify(keyArray)}`);
  fs.writeFileSync(envPath, lines.join("\n") + "\n");
}

async function airdrop(pubkey) {
  const { Connection, PublicKey, LAMPORTS_PER_SOL } = require("@solana/web3.js");
  const cfgPath = path.join(ROOT, "agents", "config.json");
  const rpc = fs.existsSync(cfgPath)
    ? JSON.parse(fs.readFileSync(cfgPath, "utf8")).network.rpc_url
    : "https://api.devnet.solana.com";
  const connection = new Connection(rpc, "confirmed");
  process.stdout.write("  Requesting devnet airdrop (2 SOL)... ");
  try {
    const sig = await connection.requestAirdrop(new PublicKey(pubkey), 2 * LAMPORTS_PER_SOL);
    await connection.confirmTransaction(sig, "confirmed");
    const bal = await connection.getBalance(new PublicKey(pubkey));
    console.log(`done. Balance: ${(bal / LAMPORTS_PER_SOL).toFixed(2)} SOL`);
  } catch (_) {
    console.log("rate-limited.");
    console.log("  Fund manually at: https://faucet.solana.com");
    console.log(`  Wallet: ${pubkey}`);
  }
}

// ── setup ─────────────────────────────────────────────────────────────────────
if (cmd === "setup") {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

  console.log("\nKILLSol Agent Setup");
  console.log("─────────────────────────────────────────");
  console.log("  1. Generate a new wallet (recommended)");
  console.log("  2. Import an existing keypair\n");

  rl.question("Choice [1/2]: ", async answer => {
    rl.close();
    const { Keypair } = require("@solana/web3.js");

    if (answer.trim() === "2") {
      // ── Import existing ──────────────────────────────────────────────────
      const rl2 = readline.createInterface({ input: process.stdin, output: process.stdout });
      console.log("\nPath to keypair file (e.g. ~/.config/solana/id.json)");
      console.log("or paste the raw 64-byte JSON array directly.\n");
      rl2.question("Keypair: ", async input => {
        rl2.close();
        input = input.trim();
        let keyArray;
        if (input.startsWith("[")) {
          try { keyArray = JSON.parse(input); }
          catch { console.error("\nInvalid JSON array."); process.exit(1); }
        } else {
          const resolved = input.replace(/^~/, process.env.HOME || "");
          if (!fs.existsSync(resolved)) { console.error(`\nFile not found: ${resolved}`); process.exit(1); }
          try { keyArray = JSON.parse(fs.readFileSync(resolved, "utf8")); }
          catch { console.error("\nCould not parse keypair file."); process.exit(1); }
        }
        if (!Array.isArray(keyArray) || keyArray.length !== 64) {
          console.error("\nInvalid keypair — must be a 64-byte array."); process.exit(1);
        }
        let kp;
        try { kp = Keypair.fromSecretKey(Uint8Array.from(keyArray)); }
        catch { console.error("\nFailed to load keypair."); process.exit(1); }
        saveKey(keyArray);
        console.log(`\nWallet imported.`);
        console.log(`Public key : ${kp.publicKey.toBase58()}`);
        console.log(`Key saved  : .env\n`);
        console.log('Run `killsol agent` to start.\n');
      });

    } else {
      // ── Generate new wallet ──────────────────────────────────────────────
      const kp       = Keypair.generate();
      const keyArray = Array.from(kp.secretKey);
      const pubkey   = kp.publicKey.toBase58();
      saveKey(keyArray);
      console.log("\nNew wallet generated.");
      console.log(`Public key : ${pubkey}`);
      console.log(`Key saved  : .env`);
      console.log(`\nIMPORTANT: Back up your private key before funding.`);
      console.log(`           cat .env\n`);
      await airdrop(pubkey);
      console.log('\nRun `killsol agent` to start.\n');
    }
  });

// ── agent ─────────────────────────────────────────────────────────────────────
} else if (cmd === "agent") {
  const agentPath = path.join(ROOT, "agents", "agent.js");
  if (!fs.existsSync(agentPath)) {
    console.error("agents/agent.js not found. Run the installer first.");
    process.exit(1);
  }
  if (!process.env.AGENT_PK) {
    console.error("AGENT_PK not set. Run `killsol setup` first.");
    process.exit(1);
  }
  spawn("node", ["agents/agent.js"], {
    cwd: ROOT, stdio: "inherit",
    env: { ...process.env, FORCE_COLOR: "1" }
  });

// ── help ──────────────────────────────────────────────────────────────────────
} else {
  console.log("\nUsage: killsol <command>\n");
  console.log("  setup   Create or import your Solana wallet");
  console.log("  agent   Start the agent\n");
}
CLIEOF

chmod +x cli.js

# 5. Install and link
echo "[5/5] Installing dependencies..."
npm install --quiet
npm link --force --quiet

echo ""
echo "================================================"
echo " KILLSol Agent installed at $(pwd)"
echo "================================================"
echo ""
echo "STEP 1 — Create your wallet"
echo ""
echo "  killsol setup"
echo ""
echo "  Generates a new Solana wallet and requests a"
echo "  devnet airdrop automatically. Or import an"
echo "  existing keypair."
echo ""
echo "------------------------------------------------"
echo ""
echo "STEP 2 — Configure your agents"
echo ""
echo "  Playbook  (which agents run and in what order):"
echo "  nano agents/playbook.json"
echo ""
echo "  Parameters  (settings, RPC, strategy):"
echo "  nano agents/config.json"
echo ""
echo "------------------------------------------------"
echo ""
echo "STEP 3 — Run your agent"
echo ""
echo "  killsol agent"
echo ""
echo "================================================"
