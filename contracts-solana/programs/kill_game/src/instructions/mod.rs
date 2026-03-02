pub mod admin;
pub mod initialize;
pub mod kill;
pub mod move_units;
pub mod spawn;

use crate::constants::*;
use crate::state::AgentStack;

// ── Shared helpers ─────────────────────────────────────────────────────────────

/// Returns true when two stack IDs are adjacent (Manhattan distance = 1) in the
/// 6×6×6 grid.  Equivalent to the EVM isAdjacent() check.
pub fn is_adjacent(a: u16, b: u16) -> bool {
    if a == b || a > MAX_STACK_ID || b > MAX_STACK_ID {
        return false;
    }
    let ax = (a % GRID_SIZE) as i16;
    let ay = ((a / GRID_SIZE) % GRID_SIZE) as i16;
    let az = (a / (GRID_SIZE * GRID_SIZE)) as i16;
    let bx = (b % GRID_SIZE) as i16;
    let by = ((b / GRID_SIZE) % GRID_SIZE) as i16;
    let bz = (b / (GRID_SIZE * GRID_SIZE)) as i16;
    (ax - bx).abs() + (ay - by).abs() + (az - bz).abs() == 1
}

/// Lanchester square-law combat resolution.
///
/// Reapers count as THERMAL_PARITY units each.  Defender receives a 10% power
/// bonus (×11 / 10 equivalent via integer ×11 vs ×10).
///
/// Returns `(attacker_won, surviving_units, surviving_reapers)`.
/// On a loss both survivors are 0; the attacker's stack should be cleared.
pub fn resolve_combat(
    def_units: u64,
    atk_units: u64,
    def_reapers: u64,
    atk_reapers: u64,
) -> (bool, u64, u64) {
    // Defender power with 10% bonus (×11 instead of ×10)
    let def_pow = def_units
        .saturating_add(def_reapers.saturating_mul(THERMAL_PARITY))
        .saturating_mul(11);
    let atk_pow = atk_units.saturating_add(atk_reapers.saturating_mul(THERMAL_PARITY));

    if atk_pow > def_pow {
        // Proportion of attacker power that remains after combat
        let surplus = atk_pow.saturating_sub(def_pow);
        let remain_pct = surplus.saturating_mul(100) / atk_pow;
        let rem_units = atk_units.saturating_mul(remain_pct) / 100;
        let rem_reapers = atk_reapers.saturating_mul(remain_pct) / 100;
        (true, rem_units, rem_reapers)
    } else {
        (false, 0, 0)
    }
}

/// Calculate the bounty owed for a defender stack based on its age in slots.
///
/// Bounty = units × THERMAL_PARITY × multiplier
/// where multiplier = clamp(age_slots / SLOTS_PER_MULTIPLIER, 1, MAX_MULTIPLIER)
pub fn get_pending_bounty(stack: &AgentStack, current_slot: u64) -> u64 {
    if stack.units == 0 {
        return 0;
    }
    let age_slots = current_slot.saturating_sub(stack.spawn_slot);
    let mult = (age_slots / SLOTS_PER_MULTIPLIER).clamp(1, MAX_MULTIPLIER);
    stack
        .units
        .saturating_mul(THERMAL_PARITY)
        .saturating_mul(mult)
}
