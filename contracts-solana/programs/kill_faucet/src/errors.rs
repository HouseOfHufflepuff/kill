use anchor_lang::prelude::*;

#[error_code]
pub enum FaucetError {
    #[msg("You have already claimed from the faucet")]
    AlreadyClaimed,

    #[msg("You must hold at least 1 KILL token to use the faucet")]
    InsufficientKillBalance,

    #[msg("Faucet vault is empty")]
    FaucetEmpty,

    #[msg("Unauthorized — admin only")]
    Unauthorized,
}
