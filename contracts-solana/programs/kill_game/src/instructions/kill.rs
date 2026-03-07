use anchor_lang::prelude::*;
use anchor_spl::token::{self, Burn, Mint, Token, TokenAccount, Transfer};

use crate::constants::*;
use crate::errors::KillError;
use crate::state::{AgentStack, GameConfig, KillEvent};

use super::{get_pending_bounty, resolve_combat};

/// Attack an enemy stack on the same grid position.
///
/// Equivalent to the EVM `kill()` function.  Uses a 10%-defender-bonus combat
/// check to determine the winner, then applies EVM-parity bidirectional bounty:
///
///   battlePool  = pending × min(totalPowerLost, THERMAL_PARITY) / THERMAL_PARITY
///   atkBounty   = battlePool × defPowerLost / totalPowerLost  → to attacker
///   defBounty   = battlePool × atkPowerLost / totalPowerLost  → to defender
///   burn        = BURN_BPS% of each bounty, subtracted before payout
///
/// Attacker wins → all defender forces destroyed; attacker keeps all sent forces.
/// Defender wins → attacker loses all sent forces; defender takes Lanchester partial loss.
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
    #[account(
        mut,
        seeds = [b"agent_stack", defender.key().as_ref(), &defender_stack_id.to_le_bytes()],
        bump = defender_stack.bump,
        constraint = (defender_stack.units > 0 || defender_stack.reapers > 0) @ KillError::EmptyDefender,
        constraint = defender_stack.agent != attacker.key() @ KillError::SelfAttack,
    )]
    pub defender_stack: Account<'info, AgentStack>,

    /// Attacker's KILL token account — receives the net bounty payout if attacker wins.
    #[account(
        mut,
        constraint = attacker_token_account.owner == attacker.key(),
        constraint = attacker_token_account.mint == game_config.kill_mint,
    )]
    pub attacker_token_account: Account<'info, TokenAccount>,

    /// Defender's KILL token account — receives the net bounty payout if defender wins.
    #[account(
        mut,
        constraint = defender_token_account.owner == defender.key(),
        constraint = defender_token_account.mint == game_config.kill_mint,
    )]
    pub defender_token_account: Account<'info, TokenAccount>,

    /// Game vault — source for bounty payouts and the burn.
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
    sent_units: u64,
    sent_reapers: u64,
) -> Result<()> {
    require!(
        attacker_stack_id == defender_stack_id,
        KillError::NotSameStack
    );
    require!(sent_units > 0 || sent_reapers > 0, KillError::EmptyAttacker);
    require!(
        sent_units <= ctx.accounts.attacker_stack.units
            && sent_reapers <= ctx.accounts.attacker_stack.reapers,
        KillError::InsufficientBalance
    );

    let current_slot = Clock::get()?.slot;

    // Snapshot defender before combat
    let def_units   = ctx.accounts.defender_stack.units;
    let def_reapers = ctx.accounts.defender_stack.reapers;

    // ── Combat ────────────────────────────────────────────────────────────────
    // Returns: (won, rem_atk_u, rem_atk_r, atk_u_lost, atk_r_lost, def_u_lost, def_r_lost)
    let (won, rem_units, rem_reapers, atk_u_lost, atk_r_lost, def_u_lost, def_r_lost) =
        resolve_combat(def_units, sent_units, def_reapers, sent_reapers);

    // ── Bounty calculation (EVM _applyRewards parity) ─────────────────────────
    // Power destroyed by each side
    let t_p_lost = def_u_lost.saturating_add(def_r_lost.saturating_mul(THERMAL_PARITY));
    let a_p_lost = atk_u_lost.saturating_add(atk_r_lost.saturating_mul(THERMAL_PARITY));
    let total_p_lost = t_p_lost.saturating_add(a_p_lost);

    let vault_amount = ctx.accounts.game_vault.amount;
    let pending = get_pending_bounty(&ctx.accounts.defender_stack, current_slot, vault_amount);

    // battlePool scales by how much total power was destroyed (EVM parity)
    let battle_pool = if total_p_lost == 0 {
        0u64
    } else if total_p_lost >= THERMAL_PARITY {
        pending
    } else {
        pending.saturating_mul(total_p_lost) / THERMAL_PARITY
    };

    // Split battlePool proportionally to power each side destroyed
    let atk_bounty = if total_p_lost == 0 || t_p_lost == 0 {
        0u64
    } else {
        battle_pool.saturating_mul(t_p_lost) / total_p_lost
    };
    let def_bounty = if total_p_lost == 0 || a_p_lost == 0 {
        0u64
    } else {
        battle_pool.saturating_mul(a_p_lost) / total_p_lost
    };

    // Apply BURN_BPS to each bounty
    let atk_burn   = atk_bounty.saturating_mul(BURN_BPS) / BPS_DENOM;
    let atk_payout = atk_bounty.saturating_sub(atk_burn);
    let def_burn   = def_bounty.saturating_mul(BURN_BPS) / BPS_DENOM;
    let def_payout = def_bounty.saturating_sub(def_burn);
    let total_burn = atk_burn.saturating_add(def_burn);

    // PDA signer seeds — the game_config PDA signs on behalf of the vault
    let config_bump = ctx.accounts.game_config.bump;
    let signer_seeds: &[&[&[u8]]] = &[&[b"game_config", &[config_bump]]];

    // ── Payout vault → attacker ────────────────────────────────────────────────
    if atk_payout > 0 {
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
            atk_payout,
        )?;
    }

    // ── Payout vault → defender ────────────────────────────────────────────────
    if def_payout > 0 {
        token::transfer(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.to_account_info(),
                Transfer {
                    from: ctx.accounts.game_vault.to_account_info(),
                    to: ctx.accounts.defender_token_account.to_account_info(),
                    authority: ctx.accounts.game_config.to_account_info(),
                },
                signer_seeds,
            ),
            def_payout,
        )?;
    }

    // ── Burn from vault ────────────────────────────────────────────────────────
    if total_burn > 0 {
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
            total_burn,
        )?;
    }

    // ── Update stacks ──────────────────────────────────────────────────────────
    // Defender: subtract Lanchester loss (all units if attacker won)
    let defender = &mut ctx.accounts.defender_stack;
    defender.units   = defender.units.saturating_sub(def_u_lost);
    defender.reapers = defender.reapers.saturating_sub(def_r_lost);

    // Attacker: subtract sent, add back survivors (rem = 0 if lost, = sent if won)
    let attacker = &mut ctx.accounts.attacker_stack;
    attacker.units   = attacker.units.saturating_sub(sent_units) + rem_units;
    attacker.reapers = attacker.reapers.saturating_sub(sent_reapers) + rem_reapers;

    if won {
        attacker.kill_slot = current_slot;
        // ── Global kill counter (attacker wins only) ───────────────────────────
        ctx.accounts.game_config.total_kills =
            ctx.accounts.game_config.total_kills.saturating_add(1);
    }

    emit!(KillEvent {
        attacker: ctx.accounts.attacker.key(),
        defender: ctx.accounts.defender.key(),
        attacker_stack: attacker_stack_id,
        defender_stack: defender_stack_id,
        attacker_bounty: atk_payout,
        defender_bounty: def_payout,
        total_burned: total_burn,
        remaining_units: rem_units,
        remaining_reapers: rem_reapers,
        slot: current_slot,
        attacker_units_sent: sent_units,
        attacker_reapers_sent: sent_reapers,
        attacker_units_lost: atk_u_lost,
        attacker_reapers_lost: atk_r_lost,
        defender_units: def_units,
        defender_reapers: def_reapers,
        defender_units_lost: def_u_lost,
        defender_reapers_lost: def_r_lost,
    });

    Ok(())
}
