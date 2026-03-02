use anchor_lang::prelude::*;
use anchor_spl::token::{self, Mint, Token, TokenAccount, Transfer};

use crate::constants::*;
use crate::errors::KillError;
use crate::state::{AgentStack, GameConfig, StackMoved};

use super::is_adjacent;

/// Move all units from one stack to an adjacent stack.
///
/// Equivalent to the EVM `move()` function.  Costs MOVE_COST KILL tokens.
/// The source stack is completely emptied; units merge with any existing
/// friendly forces at the destination.  Only adjacent moves are allowed
/// (Manhattan distance = 1 in the 6×6×6 grid).
#[derive(Accounts)]
#[instruction(from_stack_id: u16, to_stack_id: u16)]
pub struct MoveUnits<'info> {
    #[account(
        seeds = [b"game_config"],
        bump = game_config.bump,
        constraint = !game_config.paused @ KillError::GamePaused,
    )]
    pub game_config: Account<'info, GameConfig>,

    /// Source stack — must be owned by the signer and non-empty.
    #[account(
        mut,
        seeds = [b"agent_stack", agent.key().as_ref(), &from_stack_id.to_le_bytes()],
        bump = from_stack.bump,
        constraint = from_stack.agent == agent.key(),
        constraint = (from_stack.units > 0 || from_stack.reapers > 0) @ KillError::EmptyAttacker,
    )]
    pub from_stack: Account<'info, AgentStack>,

    /// Destination stack — created if it does not yet exist for this agent at this position.
    #[account(
        init_if_needed,
        payer = agent,
        space = AgentStack::SPACE,
        seeds = [b"agent_stack", agent.key().as_ref(), &to_stack_id.to_le_bytes()],
        bump
    )]
    pub to_stack: Account<'info, AgentStack>,

    /// Agent's KILL token account — move cost is debited from here.
    #[account(
        mut,
        constraint = agent_token_account.owner == agent.key(),
        constraint = agent_token_account.mint == game_config.kill_mint,
    )]
    pub agent_token_account: Account<'info, TokenAccount>,

    /// Game vault — receives the move cost.
    #[account(
        mut,
        constraint = game_vault.key() == game_config.game_vault,
    )]
    pub game_vault: Account<'info, TokenAccount>,

    pub kill_mint: Account<'info, Mint>,

    #[account(mut)]
    pub agent: Signer<'info>,

    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
}

pub fn handler(ctx: Context<MoveUnits>, from_stack_id: u16, to_stack_id: u16) -> Result<()> {
    require!(from_stack_id <= MAX_STACK_ID, KillError::InvalidStackId);
    require!(to_stack_id <= MAX_STACK_ID, KillError::InvalidStackId);
    require!(is_adjacent(from_stack_id, to_stack_id), KillError::NotAdjacent);

    // Pay move cost
    token::transfer(
        CpiContext::new(
            ctx.accounts.token_program.to_account_info(),
            Transfer {
                from: ctx.accounts.agent_token_account.to_account_info(),
                to: ctx.accounts.game_vault.to_account_info(),
                authority: ctx.accounts.agent.to_account_info(),
            },
        ),
        MOVE_COST,
    )?;

    let current_slot = Clock::get()?.slot;

    // Capture source values before mutably borrowing destination
    let units = ctx.accounts.from_stack.units;
    let reapers = ctx.accounts.from_stack.reapers;

    // Clear source stack
    let from = &mut ctx.accounts.from_stack;
    from.units = 0;
    from.reapers = 0;

    // Merge into destination — initialize metadata on first occupation
    let to = &mut ctx.accounts.to_stack;
    if to.units == 0 && to.reapers == 0 {
        to.agent = ctx.accounts.agent.key();
        to.stack_id = to_stack_id;
        to.spawn_slot = current_slot;
        to.kill_slot = 0;
        to.bump = ctx.bumps.to_stack;
    }
    to.units = to.units.checked_add(units).ok_or(KillError::Overflow)?;
    to.reapers = to
        .reapers
        .checked_add(reapers)
        .ok_or(KillError::Overflow)?;

    emit!(StackMoved {
        agent: ctx.accounts.agent.key(),
        from_stack: from_stack_id,
        to_stack: to_stack_id,
        units,
        reapers,
        slot: current_slot,
    });

    Ok(())
}
