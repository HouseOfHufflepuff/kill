/// 6.66% burn on every bounty payout (matches EVM BURN_BPS)
pub const BURN_BPS: u64 = 666;

/// Cost to spawn a stack — 20 KILL at 6 decimal places
pub const SPAWN_COST: u64 = 20_000_000;

/// Cost to move a stack — 100 KILL at 6 decimal places
pub const MOVE_COST: u64 = 100_000_000;

/// Base bounty earned per unit (matches EVM THERMAL_PARITY)
pub const THERMAL_PARITY: u64 = 666;

/// Maximum bounty multiplier (capped at 20×)
pub const MAX_MULTIPLIER: u64 = 20;

/// Slots between each multiplier step.
/// 32,400 slots × 0.4s/slot ≈ 3.6 hours — equivalent to 1,080 EVM blocks @ 12s.
pub const SLOTS_PER_MULTIPLIER: u64 = 32_400;

/// 3D grid side length (6 × 6 × 6 = 216 total stacks)
pub const GRID_SIZE: u16 = 6;

/// Highest valid stack ID (0–215)
pub const MAX_STACK_ID: u16 = 215;

/// Basis-points denominator (10,000 = 100%)
pub const BPS_DENOM: u64 = 10_000;
