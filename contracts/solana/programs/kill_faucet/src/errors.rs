use anchor_lang::prelude::*;

#[error_code]
pub enum FaucetError {
    #[msg("You have already claimed from the faucet")]
    AlreadyClaimed,

    #[msg("Faucet vault is empty")]
    FaucetEmpty,

    #[msg("Unauthorized — admin only")]
    Unauthorized,
}
