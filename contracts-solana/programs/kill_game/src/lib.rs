use anchor_lang::prelude::*;

pub mod constants;
pub mod errors;
pub mod instructions;
pub mod state;

use instructions::admin::*;
use instructions::initialize::*;
use instructions::kill::*;
use instructions::move_units::*;
use instructions::spawn::*;

// PLACEHOLDER — after first `anchor build`, run:
//   anchor keys list
// then replace this ID with the one shown for kill_game.
declare_id!("2FbeFxvFH2b4KyAcwNToFr3pHzYK4ybYQWriXjjKEr5D");

#[program]
pub mod kill_game {
    use super::*;

    /// One-time setup: creates the GameConfig PDA and game vault.
    /// Must be called by the deploying admin before any gameplay.
    pub fn initialize_game(ctx: Context<InitializeGame>) -> Result<()> {
        instructions::initialize::handler(ctx)
    }

    /// Spawn or reinforce a stack at a grid position (0–215).
    /// Costs SPAWN_COST KILL tokens → vault.
    pub fn spawn(ctx: Context<Spawn>, stack_id: u16, units: u64, reapers: u64) -> Result<()> {
        instructions::spawn::handler(ctx, stack_id, units, reapers)
    }

    /// Move all units from one adjacent grid position to another.
    /// Costs MOVE_COST KILL tokens → vault.
    pub fn move_units(
        ctx: Context<MoveUnits>,
        from_stack_id: u16,
        to_stack_id: u16,
    ) -> Result<()> {
        instructions::move_units::handler(ctx, from_stack_id, to_stack_id)
    }

    /// Attack an adjacent enemy stack.
    /// If the attacker wins, bounty is paid out and a portion burned.
    /// If the attacker loses, their stack is cleared with no reward.
    pub fn kill(
        ctx: Context<Kill>,
        attacker_stack_id: u16,
        defender_stack_id: u16,
    ) -> Result<()> {
        instructions::kill::handler(ctx, attacker_stack_id, defender_stack_id)
    }

    /// Admin: pause or unpause all gameplay instructions.
    pub fn set_paused(ctx: Context<AdminConfig>, paused: bool) -> Result<()> {
        instructions::admin::set_paused(ctx, paused)
    }

    /// Admin: emergency withdrawal from the game vault.
    pub fn admin_withdraw(ctx: Context<AdminWithdraw>, amount: u64) -> Result<()> {
        instructions::admin::withdraw(ctx, amount)
    }
}
