//! kill_token — Solana/Anchor port of KillToken.sol
//!
//! KillToken.sol is an ERC20Capped (66,666,666,666 KILL hard cap) with an
//! owner-only mint function.  On Solana, tokens are not contracts — the shared
//! SPL Token Program handles all transfers, burns, and balances.  What this
//! program provides is the cap-enforcement layer:
//!
//! * `initialize_token` — creates the SPL mint with this program's PDA as the
//!   mint authority, so nothing can mint outside this program.
//! * `mint_to` — admin-only mint that checks cumulative supply against the cap.
//! * `transfer_admin` — hand off admin rights to a new wallet.
//!
//! HARD_CAP: 66,666,666,666 KILL × 10^6 decimals = 66_666_666_666_000_000 raw.
//! (EVM uses 18 decimals; Solana tokens conventionally use 6, like USDC.)

use anchor_lang::prelude::*;
use anchor_spl::token::{self, Mint, MintTo, Token, TokenAccount};

// PLACEHOLDER — after first `anchor build`, run:
//   anchor keys list
// then replace this ID with the one shown for kill_token.
declare_id!("3bcxaPX7ka8DgtJckaoJHVjaXqncBsa8EfGT2AfYaYSY");

/// 66,666,666,666 KILL at 6 decimal places.
/// Matches the EVM HARD_CAP (same token quantity, different decimal representation).
pub const HARD_CAP: u64 = 66_666_666_666_000_000;

/// SPL token decimals — 6 (like USDC).  EVM KillToken used 18; 6 fits in u64.
pub const DECIMALS: u8 = 6;

// ── Account structs ───────────────────────────────────────────────────────────

/// Singleton token configuration — PDA seeds: [b"token_config"]
///
/// Tracks cumulative minted supply for cap enforcement.  The PDA is set as the
/// mint_authority on the SPL mint, so only this program can call mint_to.
#[account]
pub struct TokenConfig {
    /// The SPL mint address for KILL
    pub kill_mint: Pubkey,
    /// Admin wallet — only admin can mint (mirrors EVM `onlyOwner`)
    pub admin: Pubkey,
    /// Running total of raw tokens minted (used to check HARD_CAP)
    pub total_minted: u64,
    /// Hard cap in raw tokens (= HARD_CAP constant, stored for on-chain reads)
    pub cap: u64,
    /// Canonical PDA bump
    pub bump: u8,
}

impl TokenConfig {
    pub const SPACE: usize = 8 + 32 + 32 + 8 + 8 + 1;
}

// ── Error codes ───────────────────────────────────────────────────────────────

#[error_code]
pub enum TokenError {
    #[msg("Mint amount would exceed the hard cap of 66,666,666,666 KILL")]
    CapExceeded,
    #[msg("Unauthorized — admin only")]
    Unauthorized,
}

// ── Program ───────────────────────────────────────────────────────────────────

#[program]
pub mod kill_token {
    use super::*;

    /// One-time setup: creates the KILL SPL mint and the TokenConfig PDA.
    ///
    /// The mint is initialized with:
    ///   - decimals = 6
    ///   - mint_authority = token_config PDA  (so only this program can mint)
    ///   - freeze_authority = None            (no freeze capability)
    ///
    /// After this instruction you have a standard SPL mint that wallets, DEXes,
    /// and the KILL game can all interact with using normal SPL token tooling.
    pub fn initialize_token(ctx: Context<InitializeToken>) -> Result<()> {
        let config = &mut ctx.accounts.token_config;
        config.kill_mint = ctx.accounts.kill_mint.key();
        config.admin = ctx.accounts.admin.key();
        config.total_minted = 0;
        config.cap = HARD_CAP;
        config.bump = ctx.bumps.token_config;
        Ok(())
    }

    /// Mint KILL tokens to any SPL token account.
    ///
    /// Equivalent to EVM `mint(address to, uint256 amount) external onlyOwner`.
    /// Enforces the hard cap; reverts if `total_minted + amount > HARD_CAP`.
    pub fn mint_to(ctx: Context<MintTokens>, amount: u64) -> Result<()> {
        require!(
            ctx.accounts.token_config.admin == ctx.accounts.admin.key(),
            TokenError::Unauthorized
        );

        let new_total = ctx
            .accounts
            .token_config
            .total_minted
            .checked_add(amount)
            .ok_or(TokenError::CapExceeded)?;

        require!(new_total <= HARD_CAP, TokenError::CapExceeded);

        // PDA signs the mint CPI
        let bump = ctx.accounts.token_config.bump;
        let signer_seeds: &[&[&[u8]]] = &[&[b"token_config", &[bump]]];

        token::mint_to(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.to_account_info(),
                MintTo {
                    mint: ctx.accounts.kill_mint.to_account_info(),
                    to: ctx.accounts.destination.to_account_info(),
                    authority: ctx.accounts.token_config.to_account_info(),
                },
                signer_seeds,
            ),
            amount,
        )?;

        ctx.accounts.token_config.total_minted = new_total;
        Ok(())
    }

    /// Transfer admin rights to a new wallet.
    /// Equivalent to EVM `transferOwnership(address newOwner)`.
    pub fn transfer_admin(ctx: Context<TransferAdmin>, new_admin: Pubkey) -> Result<()> {
        require!(
            ctx.accounts.token_config.admin == ctx.accounts.admin.key(),
            TokenError::Unauthorized
        );
        ctx.accounts.token_config.admin = new_admin;
        Ok(())
    }
}

// ── Accounts contexts ─────────────────────────────────────────────────────────

#[derive(Accounts)]
pub struct InitializeToken<'info> {
    /// Singleton config PDA — seeds: [b"token_config"]
    #[account(
        init,
        payer = admin,
        space = TokenConfig::SPACE,
        seeds = [b"token_config"],
        bump
    )]
    pub token_config: Account<'info, TokenConfig>,

    /// The KILL SPL mint — created here with decimals=6 and
    /// mint_authority set to token_config (the PDA above).
    #[account(
        init,
        payer = admin,
        mint::decimals = DECIMALS,
        mint::authority = token_config,
        // freeze_authority left as None by Anchor when not specified
    )]
    pub kill_mint: Account<'info, Mint>,

    #[account(mut)]
    pub admin: Signer<'info>,

    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
    pub rent: Sysvar<'info, Rent>,
}

#[derive(Accounts)]
pub struct MintTokens<'info> {
    #[account(
        mut,
        seeds = [b"token_config"],
        bump = token_config.bump,
    )]
    pub token_config: Account<'info, TokenConfig>,

    /// The KILL mint — must match token_config.kill_mint
    #[account(
        mut,
        constraint = kill_mint.key() == token_config.kill_mint,
    )]
    pub kill_mint: Account<'info, Mint>,

    /// Destination token account to receive the minted KILL
    #[account(
        mut,
        constraint = destination.mint == token_config.kill_mint,
    )]
    pub destination: Account<'info, TokenAccount>,

    pub admin: Signer<'info>,

    pub token_program: Program<'info, Token>,
}

#[derive(Accounts)]
pub struct TransferAdmin<'info> {
    #[account(
        mut,
        seeds = [b"token_config"],
        bump = token_config.bump,
        constraint = token_config.admin == admin.key() @ TokenError::Unauthorized,
    )]
    pub token_config: Account<'info, TokenConfig>,

    pub admin: Signer<'info>,
}
