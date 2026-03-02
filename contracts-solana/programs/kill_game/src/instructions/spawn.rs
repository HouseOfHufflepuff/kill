use anchor_lang::prelude::*;
use anchor_spl::token::{self, Mint, Token, TokenAccount, Transfer};

use crate::constants::*;
use crate::errors::KillError;
use crate::state::{AgentStack, GameConfig, StackSpawned};

/// Spawn or reinforce a stack at a given grid position.
///
/// Equivalent to the EVM `spawn()` function.  Costs SPAWN_COST KILL tokens,
/// which are transferred to the game vault.  If an AgentStack PDA already
/// exists for this agent+position, units/reapers are added to it (reinforcement).
/// Otherwise a new stack account is created.
#[derive(Accounts)]
#[instruction(stack_id: u16, units: u64, reapers: u64)]
pub struct Spawn<'info> {
    /// Game config — validates the game is not paused and provides vault address.
    #[account(
        seeds = [b"game_config"],
        bump = game_config.bump,
        constraint = !game_config.paused @ KillError::GamePaused,
    )]
    pub game_config: Account<'info, GameConfig>,

    /// The agent's stack at this position.  Created on first spawn; updated on reinforcement.
    /// Seeds: [b"agent_stack", agent.key(), stack_id as [u8;2] little-endian]
    #[account(
        init_if_needed,
        payer = agent,
        space = AgentStack::SPACE,
        seeds = [b"agent_stack", agent.key().as_ref(), &stack_id.to_le_bytes()],
        bump
    )]
    pub agent_stack: Account<'info, AgentStack>,

    /// Agent's KILL token account — spawn cost is debited from here.
    #[account(
        mut,
        constraint = agent_token_account.owner == agent.key(),
        constraint = agent_token_account.mint == game_config.kill_mint,
    )]
    pub agent_token_account: Account<'info, TokenAccount>,

    /// Game vault — receives the spawn cost.
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

pub fn handler(ctx: Context<Spawn>, stack_id: u16, units: u64, reapers: u64) -> Result<()> {
    require!(stack_id <= MAX_STACK_ID, KillError::InvalidStackId);
    require!(units > 0 || reapers > 0, KillError::EmptyAttacker);

    // Debit spawn cost from agent → vault
    token::transfer(
        CpiContext::new(
            ctx.accounts.token_program.to_account_info(),
            Transfer {
                from: ctx.accounts.agent_token_account.to_account_info(),
                to: ctx.accounts.game_vault.to_account_info(),
                authority: ctx.accounts.agent.to_account_info(),
            },
        ),
        SPAWN_COST,
    )?;

    let stack = &mut ctx.accounts.agent_stack;
    let current_slot = Clock::get()?.slot;

    // On first creation, initialize metadata fields.
    // `init_if_needed` re-uses the account when it already exists, so we only
    // set these on a truly new account (both unit counts start at 0).
    if stack.units == 0 && stack.reapers == 0 {
        stack.agent = ctx.accounts.agent.key();
        stack.stack_id = stack_id;
        stack.spawn_slot = current_slot;
        stack.kill_slot = 0;
        stack.bump = ctx.bumps.agent_stack;
    }

    stack.units = stack.units.checked_add(units).ok_or(KillError::Overflow)?;
    stack.reapers = stack
        .reapers
        .checked_add(reapers)
        .ok_or(KillError::Overflow)?;

    emit!(StackSpawned {
        agent: ctx.accounts.agent.key(),
        stack_id,
        units: stack.units,
        reapers: stack.reapers,
        slot: current_slot,
    });

    Ok(())
}
