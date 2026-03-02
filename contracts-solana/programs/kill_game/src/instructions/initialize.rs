use anchor_lang::prelude::*;
use anchor_spl::token::{Mint, Token, TokenAccount};

use crate::state::GameConfig;

/// Initializes the singleton GameConfig PDA and its associated vault token
/// account.  Must be called exactly once after deployment.
///
/// The `game_config` PDA becomes the authority over `game_vault`, so the
/// program can sign vault transfers/burns without a traditional private key.
#[derive(Accounts)]
pub struct InitializeGame<'info> {
    /// Singleton config — created here for the first and only time.
    /// Seeds: [b"game_config"]
    #[account(
        init,
        payer = admin,
        space = GameConfig::SPACE,
        seeds = [b"game_config"],
        bump
    )]
    pub game_config: Account<'info, GameConfig>,

    /// The KILL SPL mint (must already exist — deploy KillToken first).
    pub kill_mint: Account<'info, Mint>,

    /// The game vault.  A new token account whose authority is `game_config`.
    /// All spawn/move costs flow into this account; bounties flow out of it.
    #[account(
        init,
        payer = admin,
        token::mint = kill_mint,
        token::authority = game_config,
    )]
    pub game_vault: Account<'info, TokenAccount>,

    /// Payer and future admin of the game.
    #[account(mut)]
    pub admin: Signer<'info>,

    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
    pub rent: Sysvar<'info, Rent>,
}

pub fn handler(ctx: Context<InitializeGame>) -> Result<()> {
    let config = &mut ctx.accounts.game_config;
    config.kill_mint = ctx.accounts.kill_mint.key();
    config.game_vault = ctx.accounts.game_vault.key();
    config.admin = ctx.accounts.admin.key();
    config.total_kills = 0;
    config.paused = false;
    config.bump = ctx.bumps.game_config;
    Ok(())
}
