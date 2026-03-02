use anchor_lang::prelude::*;
use anchor_spl::token::{self, Token, TokenAccount, Transfer};

use crate::errors::KillError;
use crate::state::GameConfig;

// ── Pause / Unpause ────────────────────────────────────────────────────────────

#[derive(Accounts)]
pub struct AdminConfig<'info> {
    #[account(
        mut,
        seeds = [b"game_config"],
        bump = game_config.bump,
        constraint = game_config.admin == admin.key() @ KillError::Unauthorized,
    )]
    pub game_config: Account<'info, GameConfig>,

    pub admin: Signer<'info>,
}

/// Pause or unpause the game.  While paused, spawn/move/kill revert.
pub fn set_paused(ctx: Context<AdminConfig>, paused: bool) -> Result<()> {
    ctx.accounts.game_config.paused = paused;
    Ok(())
}

// ── Emergency Vault Withdrawal ────────────────────────────────────────────────

#[derive(Accounts)]
pub struct AdminWithdraw<'info> {
    #[account(
        seeds = [b"game_config"],
        bump = game_config.bump,
        constraint = game_config.admin == admin.key() @ KillError::Unauthorized,
    )]
    pub game_config: Account<'info, GameConfig>,

    /// Game vault (source)
    #[account(
        mut,
        constraint = game_vault.key() == game_config.game_vault,
    )]
    pub game_vault: Account<'info, TokenAccount>,

    /// Admin's (or any other) destination token account
    #[account(mut)]
    pub destination: Account<'info, TokenAccount>,

    pub admin: Signer<'info>,

    pub token_program: Program<'info, Token>,
}

/// Emergency drain of the game vault — admin only.
pub fn withdraw(ctx: Context<AdminWithdraw>, amount: u64) -> Result<()> {
    let config_bump = ctx.accounts.game_config.bump;
    let signer_seeds: &[&[&[u8]]] = &[&[b"game_config", &[config_bump]]];

    token::transfer(
        CpiContext::new_with_signer(
            ctx.accounts.token_program.to_account_info(),
            Transfer {
                from: ctx.accounts.game_vault.to_account_info(),
                to: ctx.accounts.destination.to_account_info(),
                authority: ctx.accounts.game_config.to_account_info(),
            },
            signer_seeds,
        ),
        amount,
    )?;

    Ok(())
}
