use anchor_lang::prelude::*;

pub mod errors;
pub mod instructions;
pub mod state;

use instructions::claim::*;
use instructions::initialize::*;

// PLACEHOLDER — after first `anchor build`, run:
//   anchor keys list
// then replace this ID with the one shown for kill_faucet.
declare_id!("761RUKWGgStRshdz3HJcS7dPodFSckDAcudLtU1CZ1b6");

#[program]
pub mod kill_faucet {
    use super::*;

    /// One-time setup: creates the FaucetConfig PDA and vault token account.
    /// After calling this, transfer KILL tokens to the vault to fund the faucet.
    pub fn initialize_faucet(ctx: Context<InitializeFaucet>) -> Result<()> {
        instructions::initialize::handler(ctx)
    }

    /// Claim 10% of the current faucet vault balance.
    /// Callable once per wallet.  Claimer must hold ≥ 1 KILL already.
    pub fn claim(ctx: Context<Claim>) -> Result<()> {
        instructions::claim::handler(ctx)
    }
}
