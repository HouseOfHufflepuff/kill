use anchor_lang::prelude::*;

/// Singleton faucet configuration — PDA seeds: [b"faucet_config"]
///
/// Holds the mint address and the vault token account.  The PDA itself is the
/// vault authority so the program can sign transfers without a private key.
#[account]
pub struct FaucetConfig {
    /// SPL mint for the KILL token
    pub kill_mint: Pubkey,

    /// Faucet vault token account (PDA authority = this account)
    pub faucet_vault: Pubkey,

    /// Admin wallet (can top-up or reclaim vault funds)
    pub admin: Pubkey,

    /// Canonical bump for cheap PDA re-derivation
    pub bump: u8,
}

impl FaucetConfig {
    pub const SPACE: usize = 8 + 32 + 32 + 32 + 1;
}

/// One-per-wallet claim record — PDA seeds: [b"claim_record", claimer.key()]
///
/// The mere existence of this account proves a wallet has already claimed.
/// Because `init` is used (not `init_if_needed`), a second claim attempt will
/// fail with "account already in use" before our instruction logic even runs.
#[account]
pub struct ClaimRecord {
    /// Wallet that claimed
    pub claimer: Pubkey,

    /// Slot at which the claim occurred
    pub slot: u64,

    /// Canonical bump
    pub bump: u8,
}

impl ClaimRecord {
    pub const SPACE: usize = 8 + 32 + 8 + 1;
}
