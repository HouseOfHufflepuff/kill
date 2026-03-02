use anchor_lang::prelude::*;
use anchor_spl::token::{self, Mint, Token, TokenAccount, Transfer};

use crate::errors::FaucetError;
use crate::state::{ClaimRecord, FaucetConfig};

/// Minimum KILL balance required to claim — 1 KILL at 6 decimal places.
/// Mirrors the EVM `require(killToken.balanceOf(msg.sender) >= 1 ether)` check
/// (adjusted for 6-decimal SPL token instead of 18-decimal ERC20).
const MIN_KILL_BALANCE: u64 = 1_000_000;

/// Percentage of faucet vault to dispense — 10%, matching the EVM contract.
const CLAIM_PCT: u64 = 10;

/// Claim tokens from the faucet.
///
/// Equivalent to the EVM `pullKill()` function:
///   - One-time per wallet (enforced by `init` on ClaimRecord)
///   - Claimer must hold ≥ 1 KILL already
///   - Transfers 10% of current vault balance to the claimer
#[derive(Accounts)]
pub struct Claim<'info> {
    /// Faucet config — provides vault address and signs vault transfers.
    #[account(
        seeds = [b"faucet_config"],
        bump = faucet_config.bump,
    )]
    pub faucet_config: Account<'info, FaucetConfig>,

    /// Claim record — `init` fails if this account already exists, which is
    /// how we enforce the one-claim-per-wallet rule with zero extra code.
    /// Seeds: [b"claim_record", claimer.key()]
    #[account(
        init,
        payer = claimer,
        space = ClaimRecord::SPACE,
        seeds = [b"claim_record", claimer.key().as_ref()],
        bump
    )]
    pub claim_record: Account<'info, ClaimRecord>,

    /// Faucet vault — source of the claim transfer.
    #[account(
        mut,
        constraint = faucet_vault.key() == faucet_config.faucet_vault,
    )]
    pub faucet_vault: Account<'info, TokenAccount>,

    /// Claimer's KILL token account:
    ///   - Must hold ≥ MIN_KILL_BALANCE (1 KILL) before claiming
    ///   - Receives the faucet payout
    #[account(
        mut,
        constraint = claimer_token_account.owner == claimer.key(),
        constraint = claimer_token_account.mint == faucet_config.kill_mint,
        constraint = claimer_token_account.amount >= MIN_KILL_BALANCE @ FaucetError::InsufficientKillBalance,
    )]
    pub claimer_token_account: Account<'info, TokenAccount>,

    pub kill_mint: Account<'info, Mint>,

    #[account(mut)]
    pub claimer: Signer<'info>,

    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
}

pub fn handler(ctx: Context<Claim>) -> Result<()> {
    let vault_balance = ctx.accounts.faucet_vault.amount;
    require!(vault_balance > 0, FaucetError::FaucetEmpty);

    // 10% of current vault balance (integer division truncates — acceptable)
    let amount = vault_balance / CLAIM_PCT;
    require!(amount > 0, FaucetError::FaucetEmpty);

    // PDA signs the transfer
    let config_bump = ctx.accounts.faucet_config.bump;
    let signer_seeds: &[&[&[u8]]] = &[&[b"faucet_config", &[config_bump]]];

    token::transfer(
        CpiContext::new_with_signer(
            ctx.accounts.token_program.to_account_info(),
            Transfer {
                from: ctx.accounts.faucet_vault.to_account_info(),
                to: ctx.accounts.claimer_token_account.to_account_info(),
                authority: ctx.accounts.faucet_config.to_account_info(),
            },
            signer_seeds,
        ),
        amount,
    )?;

    // Record the claim — slot stored for analytics / UI
    let record = &mut ctx.accounts.claim_record;
    record.claimer = ctx.accounts.claimer.key();
    record.slot = Clock::get()?.slot;
    record.bump = ctx.bumps.claim_record;

    Ok(())
}
