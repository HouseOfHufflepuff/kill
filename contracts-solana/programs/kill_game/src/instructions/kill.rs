use anchor_lang::prelude::*;
use anchor_spl::token::{self, Burn, Mint, Token, TokenAccount, Transfer};

use crate::constants::*;
use crate::errors::KillError;
use crate::state::{AgentStack, GameConfig, KillEvent};

use super::{get_pending_bounty, is_adjacent, resolve_combat};

/// Attack an adjacent enemy stack.
///
/// Equivalent to the EVM `kill()` function.  Uses Lanchester square-law combat
/// to determine the winner.  If the attacker wins:
///   1. Bounty is calculated from the defender's unit count × age multiplier.
///   2. BURN_BPS percent of the bounty is burned from the vault.
///   3. The remainder (payout) is transferred from vault → attacker.
///   4. Defender stack is zeroed; attacker stack is updated to survivors.
///
/// If the attacker loses, their stack is zeroed (pyrrhic loss) with no bounty.
#[derive(Accounts)]
#[instruction(attacker_stack_id: u16, defender_stack_id: u16)]
pub struct Kill<'info> {
    #[account(
        mut,
        seeds = [b"game_config"],
        bump = game_config.bump,
        constraint = !game_config.paused @ KillError::GamePaused,
    )]
    pub game_config: Account<'info, GameConfig>,

    /// Attacker's stack — must be owned by the signer and non-empty.
    #[account(
        mut,
        seeds = [b"agent_stack", attacker.key().as_ref(), &attacker_stack_id.to_le_bytes()],
        bump = attacker_stack.bump,
        constraint = attacker_stack.agent == attacker.key(),
        constraint = (attacker_stack.units > 0 || attacker_stack.reapers > 0) @ KillError::EmptyAttacker,
    )]
    pub attacker_stack: Account<'info, AgentStack>,

    /// Defender's stack — must be non-empty and owned by a different agent.
    /// The client must supply the correct defender_stack PDA address; Anchor
    /// validates it via the seeds + bump constraint.
    #[account(
        mut,
        seeds = [b"agent_stack", defender.key().as_ref(), &defender_stack_id.to_le_bytes()],
        bump = defender_stack.bump,
        constraint = (defender_stack.units > 0 || defender_stack.reapers > 0) @ KillError::EmptyDefender,
        constraint = defender_stack.agent != attacker.key() @ KillError::SelfAttack,
    )]
    pub defender_stack: Account<'info, AgentStack>,

    /// Attacker's KILL token account — receives the net bounty payout.
    #[account(
        mut,
        constraint = attacker_token_account.owner == attacker.key(),
        constraint = attacker_token_account.mint == game_config.kill_mint,
    )]
    pub attacker_token_account: Account<'info, TokenAccount>,

    /// Game vault — source for both the bounty payout and the burn.
    #[account(
        mut,
        constraint = game_vault.key() == game_config.game_vault,
    )]
    pub game_vault: Account<'info, TokenAccount>,

    /// KILL mint — needed by the token program's Burn CPI.
    #[account(
        mut,
        constraint = kill_mint.key() == game_config.kill_mint,
    )]
    pub kill_mint: Account<'info, Mint>,

    #[account(mut)]
    pub attacker: Signer<'info>,

    /// CHECK: Only used to derive the defender_stack PDA seed — not signed,
    /// not written to.  The stack's agent field is validated by the seeds.
    pub defender: UncheckedAccount<'info>,

    pub token_program: Program<'info, Token>,
}

pub fn handler(
    ctx: Context<Kill>,
    attacker_stack_id: u16,
    defender_stack_id: u16,
) -> Result<()> {
    require!(
        is_adjacent(attacker_stack_id, defender_stack_id),
        KillError::NotAdjacent
    );

    let current_slot = Clock::get()?.slot;

    // ── Combat ────────────────────────────────────────────────────────────────
    let (won, rem_units, rem_reapers) = resolve_combat(
        ctx.accounts.defender_stack.units,
        ctx.accounts.attacker_stack.units,
        ctx.accounts.defender_stack.reapers,
        ctx.accounts.attacker_stack.reapers,
    );

    if !won {
        // Attacker wiped out — clear their stack, no bounty, no burn
        ctx.accounts.attacker_stack.units = 0;
        ctx.accounts.attacker_stack.reapers = 0;
        return Ok(());
    }

    // ── Bounty calculation ────────────────────────────────────────────────────
    let bounty = get_pending_bounty(&ctx.accounts.defender_stack, current_slot);
    let burn_amount = bounty.saturating_mul(BURN_BPS) / BPS_DENOM;
    let payout = bounty.saturating_sub(burn_amount);

    // PDA signer seeds — the game_config PDA signs on behalf of the vault
    let config_bump = ctx.accounts.game_config.bump;
    let signer_seeds: &[&[&[u8]]] = &[&[b"game_config", &[config_bump]]];

    // ── Payout vault → attacker ────────────────────────────────────────────────
    if payout > 0 {
        token::transfer(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.to_account_info(),
                Transfer {
                    from: ctx.accounts.game_vault.to_account_info(),
                    to: ctx.accounts.attacker_token_account.to_account_info(),
                    authority: ctx.accounts.game_config.to_account_info(),
                },
                signer_seeds,
            ),
            payout,
        )?;
    }

    // ── Burn from vault ────────────────────────────────────────────────────────
    if burn_amount > 0 {
        token::burn(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.to_account_info(),
                Burn {
                    mint: ctx.accounts.kill_mint.to_account_info(),
                    from: ctx.accounts.game_vault.to_account_info(),
                    authority: ctx.accounts.game_config.to_account_info(),
                },
                signer_seeds,
            ),
            burn_amount,
        )?;
    }

    // ── Update stacks ──────────────────────────────────────────────────────────
    // Defender: zeroed (defeated)
    let defender = &mut ctx.accounts.defender_stack;
    defender.units = 0;
    defender.reapers = 0;

    // Attacker: updated to survivors
    let attacker = &mut ctx.accounts.attacker_stack;
    attacker.units = rem_units;
    attacker.reapers = rem_reapers;
    attacker.kill_slot = current_slot;

    // ── Global kill counter ────────────────────────────────────────────────────
    ctx.accounts.game_config.total_kills = ctx
        .accounts
        .game_config
        .total_kills
        .saturating_add(1);

    emit!(KillEvent {
        attacker: ctx.accounts.attacker.key(),
        defender: ctx.accounts.defender.key(),
        attacker_stack: attacker_stack_id,
        defender_stack: defender_stack_id,
        bounty,
        burned: burn_amount,
        remaining_units: rem_units,
        remaining_reapers: rem_reapers,
        slot: current_slot,
    });

    Ok(())
}
