use anchor_lang::prelude::*;

#[error_code]
pub enum KillError {
    #[msg("Stack is not adjacent to target (Manhattan distance must be 1)")]
    NotAdjacent,

    #[msg("Attacker stack is empty — deploy units first")]
    EmptyAttacker,

    #[msg("Defender stack is empty — nothing to kill")]
    EmptyDefender,

    #[msg("Cannot attack your own stack")]
    SelfAttack,

    #[msg("Invalid stack ID — must be 0 to 215")]
    InvalidStackId,

    #[msg("Game is paused")]
    GamePaused,

    #[msg("Arithmetic overflow")]
    Overflow,

    #[msg("Insufficient KILL token balance")]
    InsufficientBalance,

    #[msg("Unauthorized — admin only")]
    Unauthorized,
}
