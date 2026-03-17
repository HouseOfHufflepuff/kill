use anchor_lang::prelude::*;
use anchor_spl::token::{Mint, Token, TokenAccount};

use crate::state::FaucetConfig;

/// Initializes the singleton FaucetConfig PDA and its vault token account.
/// Must be called once after deployment, before anyone can claim.
#[derive(Accounts)]
pub struct InitializeFaucet<'info> {
    /// Singleton config PDA — seeds: [b"faucet_config"]
    #[account(
        init,
        payer = admin,
        space = FaucetConfig::SPACE,
        seeds = [b"faucet_config"],
        bump
    )]
    pub faucet_config: Account<'info, FaucetConfig>,

    /// The KILL SPL mint (deploy KillToken first and pass its address here).
    pub kill_mint: Account<'info, Mint>,

    /// Faucet vault — a new token account whose authority is `faucet_config`.
    /// Top up this account to fund the faucet.
    #[account(
        init,
        payer = admin,
        token::mint = kill_mint,
        token::authority = faucet_config,
    )]
    pub faucet_vault: Account<'info, TokenAccount>,

    #[account(mut)]
    pub admin: Signer<'info>,

    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
    pub rent: Sysvar<'info, Rent>,
}

pub fn handler(ctx: Context<InitializeFaucet>) -> Result<()> {
    let config = &mut ctx.accounts.faucet_config;
    config.kill_mint = ctx.accounts.kill_mint.key();
    config.faucet_vault = ctx.accounts.faucet_vault.key();
    config.admin = ctx.accounts.admin.key();
    config.bump = ctx.bumps.faucet_config;
    Ok(())
}
