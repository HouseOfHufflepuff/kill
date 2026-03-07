use anchor_lang::prelude::*;

/// Singleton game configuration — PDA seeds: [b"game_config"]
///
/// There is exactly one of these per deployment. It holds the mint address,
/// the vault token account, and global counters. The PDA itself acts as the
/// authority over the game vault so the program can sign transfers/burns
/// without a traditional private key.
#[account]
#[derive(Debug)]
pub struct GameConfig {
    /// SPL mint for the KILL token
    pub kill_mint: Pubkey,

    /// Game vault token account (PDA authority = this account)
    pub game_vault: Pubkey,

    /// Protocol admin wallet (can pause and emergency-withdraw)
    pub admin: Pubkey,

    /// Lifetime kill count across all agents
    pub total_kills: u64,

    /// If true, spawn/move/kill instructions are rejected
    pub paused: bool,

    /// Canonical bump used to re-derive this PDA cheaply
    pub bump: u8,
}

impl GameConfig {
    /// Account discriminator (8) + fields
    pub const SPACE: usize = 8 + 32 + 32 + 32 + 8 + 1 + 1;
}

/// Per-agent, per-position stack — PDA seeds: [b"agent_stack", agent.key(), stack_id as [u8;2] LE]
///
/// stack_id encodes a position in a 6×6×6 grid:
///   x = stack_id % 6
///   y = (stack_id / 6) % 6
///   z = stack_id / 36
/// Valid range: 0–215.
///
/// Each agent can own one stack per grid cell (up to 216 stacks per agent).
/// Stacks with units == 0 && reapers == 0 are considered empty/defeated.
#[account]
#[derive(Debug)]
pub struct AgentStack {
    /// Owner wallet
    pub agent: Pubkey,

    /// Grid index (0–215)
    pub stack_id: u16,

    /// Number of unit tokens deployed at this position
    pub units: u64,

    /// Number of reaper tokens deployed at this position
    pub reapers: u64,

    /// Slot when this stack was first spawned (used for bounty multiplier)
    pub spawn_slot: u64,

    /// Slot of the last successful kill (for UI / analytics)
    pub kill_slot: u64,

    /// Canonical bump stored for cheap PDA re-derivation
    pub bump: u8,
}

impl AgentStack {
    /// Account discriminator (8) + fields
    pub const SPACE: usize = 8 + 32 + 2 + 8 + 8 + 8 + 8 + 1;
}

// ── Events ────────────────────────────────────────────────────────────────────
// Anchor emits these as log messages that indexers / the viewer can subscribe to.

#[event]
pub struct StackSpawned {
    pub agent: Pubkey,
    pub stack_id: u16,
    pub units: u64,
    pub reapers: u64,
    pub slot: u64,
}

#[event]
pub struct StackMoved {
    pub agent: Pubkey,
    pub from_stack: u16,
    pub to_stack: u16,
    pub units: u64,
    pub reapers: u64,
    pub slot: u64,
}

#[event]
pub struct KillEvent {
    pub attacker: Pubkey,
    pub defender: Pubkey,
    pub attacker_stack: u16,
    pub defender_stack: u16,
    /// Payout to the attacker (after burn deduction)
    pub attacker_bounty: u64,
    /// Payout to the defender (after burn deduction; non-zero when attacker loses)
    pub defender_bounty: u64,
    /// Total amount burned from vault across both bounties
    pub total_burned: u64,
    /// Attacker units remaining after combat
    pub remaining_units: u64,
    /// Attacker reapers remaining after combat
    pub remaining_reapers: u64,
    pub slot: u64,
    /// Units attacker committed to this attack
    pub attacker_units_sent: u64,
    /// Reapers attacker committed to this attack
    pub attacker_reapers_sent: u64,
    /// Attacker units lost in combat
    pub attacker_units_lost: u64,
    /// Attacker reapers lost in combat
    pub attacker_reapers_lost: u64,
    /// Defender units before combat (snapshot)
    pub defender_units: u64,
    /// Defender reapers before combat (snapshot)
    pub defender_reapers: u64,
    /// Defender units lost in combat (Lanchester partial loss when defender wins)
    pub defender_units_lost: u64,
    /// Defender reapers lost in combat
    pub defender_reapers_lost: u64,
}
